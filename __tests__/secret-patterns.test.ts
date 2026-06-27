import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  SECRET_RULES,
  PLACEHOLDER_MARKERS,
  scanContentForSecrets,
  containsServiceRoleJwt,
  formatSecretReport,
} from "../lib/secret-patterns";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Build credential-shaped fixtures by concatenation so the literal strings do
// NOT appear in this file (the repo self-scan skips this file anyway, but this
// keeps the fixtures honest regardless).
const AKIA = "AKIA" + "ABCDEFGHIJKLMNOP"; // 16 upper-alnum after AKIA
const GHP = "ghp_" + "a".repeat(36);
const PRIV = "-----BEGIN RSA PRIVATE KEY-----";
const CLOUDINARY = "cloudinary://" + "123456" + ":" + "abcdefghijkl0" + "@democloud";

// A JWT with payload {"role":"service_role"} (signature is irrelevant).
function makeJwt(role: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return [b64({ alg: "HS256", typ: "JWT" }), b64({ role }), "sig" + "nature"].join(
    ".",
  );
}

describe("secret-patterns — rule shape", () => {
  it("every rule has a unique id, description and a RegExp pattern", () => {
    const ids = new Set<string>();
    for (const rule of SECRET_RULES) {
      assert.ok(rule.id && typeof rule.id === "string");
      assert.ok(rule.description && typeof rule.description === "string");
      assert.ok(rule.pattern instanceof RegExp);
      assert.equal(ids.has(rule.id), false, `duplicate rule id ${rule.id}`);
      ids.add(rule.id);
    }
    assert.ok(SECRET_RULES.length >= 8);
  });
});

describe("secret-patterns — detects real credential shapes", () => {
  it("flags AWS access key ids", () => {
    const f = scanContentForSecrets(`const k = "${AKIA}";`);
    assert.equal(f.some((x) => x.ruleId === "aws-access-key-id"), true);
  });

  it("flags GitHub PATs", () => {
    const f = scanContentForSecrets(`token=${GHP}`);
    assert.equal(f.some((x) => x.ruleId === "github-pat-classic"), true);
  });

  it("flags PEM private key blocks", () => {
    const f = scanContentForSecrets(`${PRIV}\nMIIE...`);
    assert.equal(f.some((x) => x.ruleId === "private-key-block"), true);
  });

  it("flags a Cloudinary URL carrying an api_secret", () => {
    const f = scanContentForSecrets(`CLOUDINARY_URL=${CLOUDINARY}`);
    assert.equal(
      f.some((x) => x.ruleId === "cloudinary-url-with-secret"),
      true,
    );
  });

  it("flags a Supabase service_role JWT", () => {
    const jwt = makeJwt("service_role");
    assert.equal(containsServiceRoleJwt(`KEY=${jwt}`), true);
    const f = scanContentForSecrets(`KEY=${jwt}`);
    assert.equal(
      f.some((x) => x.ruleId === "supabase-service-role-jwt"),
      true,
    );
  });

  it("reports the line number of a finding", () => {
    const f = scanContentForSecrets(`line one\nline two\nkey=${AKIA}\n`);
    const hit = f.find((x) => x.ruleId === "aws-access-key-id");
    assert.equal(hit?.line, 3);
  });
});

describe("secret-patterns — does not flag safe content", () => {
  it("ignores an anon/authenticated JWT (legit client key)", () => {
    assert.equal(containsServiceRoleJwt(`KEY=${makeJwt("anon")}`), false);
    assert.equal(
      containsServiceRoleJwt(`KEY=${makeJwt("authenticated")}`),
      false,
    );
    const f = scanContentForSecrets(`KEY=${makeJwt("anon")}`);
    assert.deepStrictEqual(f, []);
  });

  it("ignores documentation words like service_role / SUPABASE_SERVICE_ROLE_KEY", () => {
    const doc =
      "Set SUPABASE_SERVICE_ROLE_KEY in the dashboard; the service_role bypasses RLS.";
    assert.deepStrictEqual(scanContentForSecrets(doc), []);
  });

  it("skips placeholder/example lines", () => {
    for (const marker of PLACEHOLDER_MARKERS) {
      const line = `SOME_KEY=${AKIA} # ${marker}`;
      assert.deepStrictEqual(
        scanContentForSecrets(line),
        [],
        `placeholder marker "${marker}" should suppress the finding`,
      );
    }
  });

  it("ignores the .env.example placeholders shipped in the repo", () => {
    assert.deepStrictEqual(scanContentForSecrets(read(".env.example")), []);
  });
});

describe("secret-patterns — report", () => {
  it("formats a clean result", () => {
    assert.match(formatSecretReport([]), /no secrets detected/);
  });
  it("formats findings with file:line", () => {
    const report = formatSecretReport([
      {
        file: "foo.ts",
        findings: [
          {
            ruleId: "aws-access-key-id",
            description: "AWS access key id",
            match: AKIA,
            line: 7,
          },
        ],
      },
    ]);
    assert.match(report, /foo\.ts:7 \[aws-access-key-id\]/);
  });
});

describe("SEC-14 — wiring + repo self-scan", () => {
  it("lint:secrets is wired into package.json and lint:ci", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["lint:secrets"], "tsx scripts/check-secrets.ts");
    assert.match(
      pkg.scripts["lint:ci"],
      /lint:secrets/,
      "lint:ci must run lint:secrets",
    );
  });

  it("ci.yml runs the secret scan on source and on the built bundle", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /Secret scan \(committed source\)/);
    assert.match(ci, /Secret scan \(built bundle\)/);
    const occurrences = (ci.match(/npm run lint:secrets/g) ?? []).length;
    assert.ok(occurrences >= 2, "expected a pre-test and a post-build scan");
  });

  it("the committed tree contains no detectable secrets (executes the real script)", () => {
    // Runs scripts/check-secrets.ts; exit 0 == clean. Throws on a non-zero exit.
    const out = execFileSync("npx", ["tsx", "scripts/check-secrets.ts"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.match(out, /no secrets detected/);
  });
});
