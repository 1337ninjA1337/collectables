import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  SERVICE_ROLE_PLACEHOLDER,
  buildPowerbiConnection,
  extractSupabaseProjectRef,
  parseDotEnv,
  renderPowerbiConnSummary,
} from "../lib/powerbi-conn";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("parseDotEnv", () => {
  it("parses KEY=value lines, skipping comments and blanks", () => {
    const env = parseDotEnv(
      "# comment\n\nA=1\nB = spaced \nexport C=exported\nnot a pair\n",
    );
    assert.deepEqual(env, { A: "1", B: "spaced", C: "exported" });
  });

  it("strips matching single/double quotes around the value", () => {
    const env = parseDotEnv('A="quoted value"\nB=\'single\'\nC="unbalanced\n');
    assert.equal(env.A, "quoted value");
    assert.equal(env.B, "single");
    assert.equal(env.C, '"unbalanced');
  });

  it("ignores malformed keys and lines starting with =", () => {
    const env = parseDotEnv("=nokey\n1BAD=x\nGOOD=y\n");
    assert.deepEqual(env, { GOOD: "y" });
  });

  it("last assignment wins on duplicate keys", () => {
    assert.equal(parseDotEnv("A=1\nA=2\n").A, "2");
  });
});

describe("extractSupabaseProjectRef", () => {
  it("extracts the ref from a canonical project URL", () => {
    assert.equal(
      extractSupabaseProjectRef("https://skghgllzrsdlwcxyshzr.supabase.co"),
      "skghgllzrsdlwcxyshzr",
    );
  });

  it("tolerates trailing slash / path and upper case", () => {
    assert.equal(
      extractSupabaseProjectRef("https://ABCDEFGHIJKLMNOPQRST.supabase.co/"),
      "abcdefghijklmnopqrst",
    );
  });

  it("returns null for missing, non-supabase, or http URLs", () => {
    assert.equal(extractSupabaseProjectRef(undefined), null);
    assert.equal(extractSupabaseProjectRef(""), null);
    assert.equal(extractSupabaseProjectRef("https://example.com"), null);
    assert.equal(
      extractSupabaseProjectRef("http://abcdefghijklmnopqrst.supabase.co"),
      null,
    );
  });
});

describe("buildPowerbiConnection / renderPowerbiConnSummary", () => {
  const REF = "skghgllzrsdlwcxyshzr";
  const conn = buildPowerbiConnection({
    EXPO_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  });

  it("derives the pooler username from the project ref", () => {
    assert.equal(conn.projectRef, REF);
    assert.equal(conn.username, `postgres.${REF}`);
    assert.equal(conn.port, 5432);
    assert.equal(conn.database, "postgres");
  });

  it("keeps the password a dashboard placeholder — never a real value", () => {
    const withSecret = buildPowerbiConnection({
      EXPO_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: "super-secret-value",
    });
    assert.equal(withSecret.passwordPlaceholder, SERVICE_ROLE_PLACEHOLDER);
    const summary = renderPowerbiConnSummary(withSecret);
    assert.ok(!summary.includes("super-secret-value"));
  });

  it("renders the session-pooler values and the Postgres URI", () => {
    const summary = renderPowerbiConnSummary(conn);
    assert.ok(summary.includes(`postgres.${REF}`));
    assert.ok(summary.includes("aws-0-<region>.pooler.supabase.com:5432"));
    assert.ok(
      summary.includes(
        `postgresql://postgres.${REF}:<service-role-secret>@aws-0-<region>.pooler.supabase.com:5432/postgres`,
      ),
    );
  });

  it("falls back to <project-ref> placeholders when the URL is unset", () => {
    const empty = buildPowerbiConnection({});
    assert.equal(empty.projectRef, null);
    assert.equal(empty.username, "postgres.<project-ref>");
    const summary = renderPowerbiConnSummary(empty);
    assert.ok(summary.includes("EXPO_PUBLIC_SUPABASE_URL not set"));
  });
});

describe("script + wiring", () => {
  it("scripts/print-powerbi-conn.ts never reads a secret env var", () => {
    const src = read("scripts/print-powerbi-conn.ts");
    assert.ok(!/service_role|SERVICE_ROLE|PUBLISHABLE_KEY/i.test(src.replace(/service-role/g, "")));
  });

  it("package.json exposes npm run powerbi:conn", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(
      pkg.scripts["powerbi:conn"],
      "tsx scripts/print-powerbi-conn.ts",
    );
  });
});
