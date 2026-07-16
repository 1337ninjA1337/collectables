import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_SECRET_RULES,
  IGNORE_MARKER,
  decodeBase64Url,
  formatSecretReport,
  isPrivilegedSupabaseJwt,
  redact,
  scanForSecrets,
} from "../lib/secret-scan";
import { LINT_GUARDS } from "../lib/lint-guards";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const b64url = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");
const SIG = "c2lnbmF0dXJlc2lnbmF0dXJlc2ln";
const makeJwt = (payload: unknown) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.${SIG}`;

const SERVICE_ROLE_JWT = makeJwt({
  iss: "supabase",
  ref: "abcdefghijklmnop",
  role: "service_role",
  iat: 1700000000,
  exp: 2000000000,
});
const ANON_JWT = makeJwt({
  iss: "supabase",
  ref: "abcdefghijklmnop",
  role: "anon",
  iat: 1700000000,
  exp: 2000000000,
});

describe("decodeBase64Url", () => {
  it("decodes a base64url-encoded JSON segment", () => {
    const seg = b64url({ role: "service_role" });
    assert.equal(decodeBase64Url(seg), '{"role":"service_role"}');
  });

  it("never throws on malformed input", () => {
    assert.doesNotThrow(() => decodeBase64Url("!!!not base64!!!"));
  });
});

describe("isPrivilegedSupabaseJwt", () => {
  it("is true for a service_role JWT", () => {
    assert.equal(isPrivilegedSupabaseJwt(SERVICE_ROLE_JWT), true);
  });

  it("is false for the public anon JWT (must ship in the client)", () => {
    assert.equal(isPrivilegedSupabaseJwt(ANON_JWT), false);
  });

  it("is false for a non-JWT string", () => {
    assert.equal(isPrivilegedSupabaseJwt("not.a.jwt"), false);
    assert.equal(isPrivilegedSupabaseJwt("eyJonly-one-segment"), false);
  });
});

describe("scanForSecrets — Supabase JWT discrimination", () => {
  it("flags a service_role JWT", () => {
    const m = scanForSecrets("f.js", `const k = "${SERVICE_ROLE_JWT}";`);
    assert.equal(m.length, 1);
    assert.equal(m[0].ruleId, "supabase-service-role-jwt");
  });

  it("does NOT flag the anon/publishable JWT", () => {
    const m = scanForSecrets("f.js", `const k = "${ANON_JWT}";`);
    assert.deepEqual(m, []);
  });

  it("does NOT flag the `eyJ…` placeholder", () => {
    assert.deepEqual(scanForSecrets("f.tsx", `placeholder: "eyJ…"`), []);
  });
});

describe("scanForSecrets — other rules", () => {
  // Samples are assembled from fragments at runtime so no full vendor token
  // ever appears as a contiguous literal in this file — that keeps GitHub's
  // push-protection scanner (and our own source scan) from flagging the test
  // fixtures, while `scanForSecrets` still sees the joined string.
  const join = (...parts: string[]) => parts.join("");
  const cases: [string, string][] = [
    ["aws-access-key-id", join("AK", "IA", "IOSFODNN7", "EXAMPLE")],
    ["google-api-key", join("AI", "za", "Sy", "A1234567890abcdefghijklmnopqrstuv")],
    ["github-token", join("gh", "p_", "0123456789abcdefghijklmnopqrstuvwxyz12")],
    ["slack-token", join("xo", "xb", "-1234567890-abcdefghijklmnop")],
    ["cloudinary-url", join("cloud", "inary://", "123456789012345:", "abcdefXYZsecret", "@mycloud")],
    ["posthog-personal-key", join("ph", "x_", "0123456789abcdefghijklmnopqrstuvwxyzABCD")],
  ];
  for (const [ruleId, sample] of cases) {
    it(`flags ${ruleId}`, () => {
      const m = scanForSecrets("f.ts", `const v = "${sample}";`);
      assert.equal(m.length, 1, `expected ${ruleId} to match`);
      assert.equal(m[0].ruleId, ruleId);
    });
  }

  it("flags a PEM private key block", () => {
    const m = scanForSecrets(
      "key.pem",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
    );
    assert.equal(m.length, 1);
    assert.equal(m[0].ruleId, "private-key-block");
  });
});

describe("scanForSecrets — no false positives", () => {
  it("does NOT flag the public PostHog ingest key (phc_…)", () => {
    assert.deepEqual(
      scanForSecrets("f.ts", `apiKey: "phc_0123456789abcdefghijklmnopqrstuvwxyz"`),
      [],
    );
  });

  it("does NOT flag the bare word `service_role` in SQL comments", () => {
    assert.deepEqual(
      scanForSecrets("m.sql", "-- writes are service_role-only"),
      [],
    );
  });

  it("does NOT flag the env var name SUPABASE_SERVICE_ROLE_KEY", () => {
    assert.deepEqual(
      scanForSecrets("fn.ts", "const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')"),
      [],
    );
  });
});

describe("scanForSecrets — reporting & ignore marker", () => {
  it("reports 1-indexed line and column", () => {
    const src = `line one\nconst k = "${SERVICE_ROLE_JWT}";`;
    const m = scanForSecrets("f.js", src);
    assert.equal(m[0].line, 2);
    assert.equal(m[0].column, src.split("\n")[1].indexOf("eyJ") + 1);
  });

  it("skips a line carrying the ignore marker", () => {
    const src = `const k = "${SERVICE_ROLE_JWT}"; // ${IGNORE_MARKER}`;
    assert.deepEqual(scanForSecrets("f.js", src), []);
  });

  it("redacts the secret in the preview (never prints it whole)", () => {
    const m = scanForSecrets("f.js", `const k = "${SERVICE_ROLE_JWT}";`);
    assert.ok(!m[0].preview.includes(SERVICE_ROLE_JWT));
    assert.match(m[0].preview, /^eyJh…\(\d+ chars\)$/);
  });
});

describe("redact", () => {
  it("keeps the first 4 chars and the length", () => {
    assert.equal(redact("AKIAIOSFODNN7EXAMPLE"), "AKIA…(20 chars)");
  });
});

describe("formatSecretReport", () => {
  it("is empty when there are no matches", () => {
    assert.equal(formatSecretReport([]), "");
  });

  it("groups by file and names the rule", () => {
    const m = scanForSecrets("secrets.ts", `const k = "${SERVICE_ROLE_JWT}";`);
    const report = formatSecretReport(m);
    assert.match(report, /secrets\.ts/);
    assert.match(report, /supabase-service-role-jwt/);
    assert.match(report, /CLAUDE\.md/);
  });
});

describe("rule set integrity", () => {
  it("every rule has a unique id and a global pattern", () => {
    const ids = new Set<string>();
    for (const rule of DEFAULT_SECRET_RULES) {
      assert.ok(!ids.has(rule.id), `duplicate rule id: ${rule.id}`);
      ids.add(rule.id);
      assert.ok(rule.pattern.global, `${rule.id} pattern must be global`);
    }
  });
});

describe("SEC-14 wiring (structural)", () => {
  it("ships the source and bundle scanner scripts + the pure matcher", () => {
    read("lib/secret-scan.ts");
    read("scripts/check-secrets.ts");
    read("scripts/check-bundle-secrets.ts");
  });

  it("registers the npm scripts and the source scan in the lint:all registry", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["lint:secrets"], "tsx scripts/check-secrets.ts");
    assert.equal(
      pkg.scripts["lint:secrets:bundle"],
      "tsx scripts/check-bundle-secrets.ts",
    );
    // Registry membership means lint:ci and the ci.yml "Code-style guards"
    // step both run the source scan via the lint:all aggregator (wiring
    // pinned in lint-guards.test.ts).
    assert.ok(LINT_GUARDS.some((g) => g.npmScript === "lint:secrets"));
  });

  it("wires the bundle scan + a gitleaks job into CI", () => {
    const ci = read(".github/workflows/ci.yml");
    // The bundle scan needs dist/ so it stays its own post-build step.
    assert.match(ci, /npm run lint:secrets:bundle/);
    assert.match(ci, /gitleaks\/gitleaks-action/);
  });
});
