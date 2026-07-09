import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { readCloudinaryEnvFromProcess } from "../lib/cloudinary-config";
import {
  findWholeProcessEnvUsages,
  formatEnvInliningReport,
} from "../lib/env-inlining";

const ROOT = join(__dirname, "..");

describe("findWholeProcessEnvUsages", () => {
  it("flags `process.env as Record<...>` casts", () => {
    const src = `export const cfg = resolve(process.env as Record<string, string | undefined>);\n`;
    const matches = findWholeProcessEnvUsages("lib/x-config.ts", src);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 1);
    assert.match(matches[0].snippet, /process\.env as Record/);
  });

  it("flags bare `(process.env)` passed as an argument", () => {
    const src = `const cfg = resolve(process.env);\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 1);
  });

  it("flags dynamic key access `process.env[name]`", () => {
    const src = `const v = process.env[name];\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 1);
  });

  it("flags spread `...process.env`", () => {
    const src = `const env = { ...process.env };\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 1);
  });

  it("does not flag literal member accesses", () => {
    const src = `const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 0);
  });

  it("does not flag member accesses split across lines (babel inlines via AST)", () => {
    const src = `const v = process.env\n  .EXPO_PUBLIC_ALLOW_RUNTIME_SUPABASE_CONFIG;\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 0);
  });

  it("does not flag mentions inside line comments", () => {
    const src = `// never pass process.env whole into a resolver\nconst dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 0);
  });

  it("does not flag mentions inside block/doc comments", () => {
    const src = `/**\n * Passing \`process.env\` whole bypasses the transform.\n */\nexport const x = 1;\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 0);
  });

  it("still flags code after a comment, with the original line number", () => {
    const src = `/* process.env whole is bad */\nconst cfg = resolve(process.env);\n`;
    const matches = findWholeProcessEnvUsages("f.ts", src);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 2);
  });

  it("does not treat comment markers inside strings as comments", () => {
    const src = `const url = "https://x"; const cfg = resolve(process.env);\n`;
    assert.equal(findWholeProcessEnvUsages("f.ts", src).length, 1);
  });

  it("reports 1-indexed line and column", () => {
    const src = `// comment\nconst cfg = resolve(process.env);\n`;
    const [m] = findWholeProcessEnvUsages("f.ts", src);
    assert.equal(m.line, 2);
    assert.equal(m.column, 21);
  });
});

describe("formatEnvInliningReport", () => {
  it("returns empty string for no matches", () => {
    assert.equal(formatEnvInliningReport([]), "");
  });

  it("groups matches by file and mentions the fix", () => {
    const report = formatEnvInliningReport([
      { file: "lib/a-config.ts", line: 3, column: 5, snippet: "resolve(process.env)" },
      { file: "lib/a-config.ts", line: 9, column: 1, snippet: "process.env as Record" },
      { file: "lib/b-config.ts", line: 1, column: 1, snippet: "process.env[k]" },
    ]);
    assert.match(report, /3 whole-`process\.env` usage\(s\)/);
    assert.match(report, /lib\/a-config\.ts/);
    assert.match(report, /lib\/b-config\.ts/);
    assert.match(report, /readFooEnvFromProcess/);
    assert.match(report, /9:1/);
  });
});

describe("lib/*-config.ts resolvers (the CI guard, run in-process)", () => {
  it("no config module passes process.env whole", () => {
    const files = readdirSync(join(ROOT, "lib"))
      .filter((name) => /-config\.ts$/.test(name))
      .sort();
    assert.ok(files.length >= 4, `expected several lib/*-config.ts files, got ${files.length}`);
    for (const name of files) {
      const src = readFileSync(join(ROOT, "lib", name), "utf8");
      const matches = findWholeProcessEnvUsages(`lib/${name}`, src);
      assert.deepEqual(
        matches,
        [],
        `lib/${name} passes process.env whole:\n${formatEnvInliningReport(matches)}`,
      );
    }
  });
});

describe("cloudinary env-var inlining (Metro/babel)", () => {
  it("readCloudinaryEnvFromProcess reads each EXPO_PUBLIC_* var as a literal member access", () => {
    const src = readFileSync(join(ROOT, "lib/cloudinary-config.ts"), "utf8");
    for (const name of [
      "EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME",
      "EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET",
      "EXPO_PUBLIC_CLOUDINARY_URL",
    ]) {
      assert.match(
        src,
        new RegExp(`process\\.env\\.${name}\\b`),
        `lib/cloudinary-config.ts must reference process.env.${name} literally so Metro inlines it`,
      );
    }
  });

  it("readCloudinaryEnvFromProcess returns the three supported keys", () => {
    const keys = Object.keys(readCloudinaryEnvFromProcess()).sort();
    assert.deepStrictEqual(keys, [
      "EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME",
      "EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET",
      "EXPO_PUBLIC_CLOUDINARY_URL",
    ]);
  });
});
