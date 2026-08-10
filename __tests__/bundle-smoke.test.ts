import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  BUNDLE_SMOKE_I18N_KEYS,
  BUNDLE_SMOKE_LANGUAGE_CODES,
  BUNDLE_SMOKE_PROVIDERS,
  BUNDLE_SMOKE_TOKENS,
  PRIVACY_PAGE_MARKER,
  PRIVACY_PAGE_RELATIVE_PATH,
  evaluateBundleSmoke,
  evaluatePrivacyPage,
  formatBundleSmokeReport,
  formatPrivacyPageFailure,
  type BundleSmokeToken,
  type PrivacyPageFailureCode,
} from "../lib/bundle-smoke";
import { LINT_ALL_EXEMPT } from "../lib/lint-guards";

/**
 * Pins the post-build smoke check that replaced ci.yml's and deploy.yml's
 * inline `grep` loops.
 *
 * The shell version had three problems this file exists to keep closed: it
 * searched only the FIRST chunk (`ls … | head -1`), it never asked whether
 * `dist/` was newer than the source tree, and its watched token lists lived in
 * YAML where nothing could check them against the app. The first two are
 * behaviour (asserted here and, for freshness, in `bundle-premise.test.ts`);
 * the third is the parity block at the bottom, which derives the language list
 * from `AppLanguage` and the provider list from `app/_layout.tsx`.
 */

const read = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const SCRIPT = read("scripts/check-bundle-smoke.ts");

/** Every watched token, concatenated — a bundle that would pass. */
const passingChunk = (): string =>
  BUNDLE_SMOKE_TOKENS.map((entry) => entry.token).join(";");

describe("evaluateBundleSmoke — token presence", () => {
  it("passes when one chunk contains every token", () => {
    const result = evaluateBundleSmoke([passingChunk()]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.chunkCount, 1);
  });

  it("passes when the tokens are SPREAD across chunks", () => {
    // The bug in the shell version: `head -1` searched chunk one only, so a
    // Metro chunking change that moved a key into chunk two failed a check
    // whose premise ("the bundle contains this key") was still true.
    const chunks = BUNDLE_SMOKE_TOKENS.map((entry) => entry.token);
    const result = evaluateBundleSmoke(chunks);
    assert.equal(result.ok, true);
    assert.equal(result.chunkCount, BUNDLE_SMOKE_TOKENS.length);
  });

  it("reports the token that is absent from every chunk", () => {
    const dropped = BUNDLE_SMOKE_TOKENS[0];
    const text = BUNDLE_SMOKE_TOKENS.slice(1)
      .map((entry) => entry.token)
      .join(";");
    const result = evaluateBundleSmoke([text, text]);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.missing.map((entry) => entry.token),
      [dropped.token],
    );
  });

  it("reports EVERY missing token, not just the first", () => {
    const result = evaluateBundleSmoke([""]);
    assert.equal(result.missing.length, BUNDLE_SMOKE_TOKENS.length);
  });

  it("fails over zero chunks rather than passing vacuously", () => {
    // The premise assertion upstream refuses to get this far, but a helper
    // that returned ok:true for an empty list would be the exact bug the
    // premise work was about.
    const result = evaluateBundleSmoke([]);
    assert.equal(result.ok, false);
    assert.equal(result.chunkCount, 0);
  });

  it("accepts an explicit token list (so a caller can narrow the check)", () => {
    const custom: BundleSmokeToken[] = [{ kind: "provider", token: "Zzz" }];
    assert.equal(evaluateBundleSmoke(["Zzz"], custom).ok, true);
    assert.equal(evaluateBundleSmoke(["Yyy"], custom).ok, false);
  });

  it("matches substrings literally, not as a regex", () => {
    const custom: BundleSmokeToken[] = [{ kind: "i18n-key", token: "a.c" }];
    assert.equal(evaluateBundleSmoke(["abc"], custom).ok, false);
    assert.equal(evaluateBundleSmoke(["a.c"], custom).ok, true);
  });

  it("does not mutate its inputs", () => {
    const tokens = [...BUNDLE_SMOKE_TOKENS];
    const chunks = [passingChunk()];
    evaluateBundleSmoke(chunks, tokens);
    assert.equal(chunks.length, 1);
    assert.equal(tokens.length, BUNDLE_SMOKE_TOKENS.length);
  });
});

describe("the watched token list", () => {
  it("quotes the language codes", () => {
    // An unquoted "de" matches half the identifiers in any minified bundle,
    // so the check would pass no matter what shipped.
    for (const code of BUNDLE_SMOKE_LANGUAGE_CODES) {
      const entry = BUNDLE_SMOKE_TOKENS.find(
        (candidate) => candidate.kind === "language" && candidate.token.includes(code),
      );
      assert.ok(entry, `language ${code} watched`);
      assert.equal(entry?.token, `"${code}"`);
    }
  });

  it("has no duplicate tokens", () => {
    const seen = new Set(BUNDLE_SMOKE_TOKENS.map((entry) => entry.token));
    assert.equal(seen.size, BUNDLE_SMOKE_TOKENS.length);
  });

  it("covers all three kinds", () => {
    const kinds = new Set(BUNDLE_SMOKE_TOKENS.map((entry) => entry.kind));
    assert.deepEqual([...kinds].sort(), ["i18n-key", "language", "provider"]);
  });

  it("is the union of the three declared lists", () => {
    assert.equal(
      BUNDLE_SMOKE_TOKENS.length,
      BUNDLE_SMOKE_I18N_KEYS.length +
        BUNDLE_SMOKE_PROVIDERS.length +
        BUNDLE_SMOKE_LANGUAGE_CODES.length,
    );
  });
});

describe("formatBundleSmokeReport", () => {
  it("names the check and the chunk count on success", () => {
    const message = formatBundleSmokeReport(
      "check-bundle-smoke",
      evaluateBundleSmoke([passingChunk(), passingChunk()]),
    );
    assert.match(message, /^check-bundle-smoke:/);
    assert.match(message, /2 chunk\(s\)/);
  });

  it("names each missing token and its kind", () => {
    const result = evaluateBundleSmoke([""], [
      { kind: "language", token: '"de"' },
      { kind: "provider", token: "AuthProvider" },
    ]);
    const message = formatBundleSmokeReport("check-bundle-smoke", result);
    assert.match(message, /i18n language code/);
    assert.match(message, /provider/);
    // JSON.stringify keeps the quotes the token carries visible (escaped) —
    // the log must show `"\"de\""`, not a bare `de` the reader would mistake
    // for an unquoted search.
    assert.ok(message.includes(JSON.stringify('"de"')));
    assert.match(message, /AuthProvider/);
    assert.equal(message.split("\n").length, 2);
  });

  it("says ERROR on failure and does not on success", () => {
    assert.match(
      formatBundleSmokeReport("c", evaluateBundleSmoke([""])),
      /ERROR/,
    );
    assert.doesNotMatch(
      formatBundleSmokeReport("c", evaluateBundleSmoke([passingChunk()])),
      /ERROR/,
    );
  });
});

describe("evaluatePrivacyPage", () => {
  it("passes on a rendered page carrying the marker", () => {
    const verdict = evaluatePrivacyPage({
      exists: true,
      text: `<title>Collectables — ${PRIVACY_PAGE_MARKER}</title>`,
    });
    assert.equal(verdict.ok, true);
  });

  it("fails when the file is absent", () => {
    const verdict = evaluatePrivacyPage({ exists: false, text: null });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.code, "missing_file");
  });

  it("reports an unreadable file as missing_file — same fix, one message", () => {
    const verdict = evaluatePrivacyPage({ exists: true, text: null });
    assert.equal(verdict.ok === false && verdict.code, "missing_file");
  });

  it("fails when the page rendered empty", () => {
    const verdict = evaluatePrivacyPage({ exists: true, text: "<html></html>" });
    assert.equal(verdict.ok === false && verdict.code, "missing_marker");
  });

  it("has a distinct message per failure code", () => {
    const codes: PrivacyPageFailureCode[] = ["missing_file", "missing_marker"];
    const messages = codes.map((code) => formatPrivacyPageFailure("c", code));
    assert.equal(new Set(messages).size, codes.length);
    for (const message of messages) {
      assert.match(message, /^c: ERROR — /);
      assert.ok(message.includes(PRIVACY_PAGE_RELATIVE_PATH));
    }
  });
});

describe("scripts/check-bundle-smoke.ts", () => {
  it("asserts the shared premise before reading anything", () => {
    assert.match(SCRIPT, /assertBundlePremise\(CHECK_NAME\)/);
    const premise = SCRIPT.indexOf("assertBundlePremise(CHECK_NAME)");
    const readChunks = SCRIPT.indexOf("readFileSync");
    assert.ok(premise !== -1 && readChunks !== -1);
    assert.ok(
      premise < SCRIPT.slice(premise).indexOf("chunkTexts") + premise + 1,
      "premise precedes the chunk read",
    );
  });

  it("takes its chunk list from the premise, not its own readdir", () => {
    // Three hand-written copies of the glob is how one of them ends up
    // matching a different set — the reason assertBundlePremise returns the
    // paths at all.
    assert.doesNotMatch(SCRIPT, /readdirSync/);
    assert.doesNotMatch(SCRIPT, /_expo/);
  });

  it("reads every chunk, not just the first", () => {
    assert.match(SCRIPT, /bundlePaths\.map\(/);
    assert.doesNotMatch(SCRIPT, /bundlePaths\[0\]/);
  });

  it("reports both halves before exiting", () => {
    const exit = SCRIPT.indexOf("process.exit(1)");
    const privacyReport = SCRIPT.indexOf("formatPrivacyPageFailure");
    assert.ok(privacyReport !== -1 && exit !== -1);
    assert.ok(
      privacyReport < exit,
      "a fail-fast chain would hide the privacy failure behind a token failure",
    );
  });

  it("exits non-zero when either half fails", () => {
    assert.match(SCRIPT, /if \(!smoke\.ok \|\| !privacy\.ok\) process\.exit\(1\)/);
  });
});

describe("wiring", () => {
  it("is an npm script", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(
      pkg.scripts["lint:bundle-smoke"],
      "tsx scripts/check-bundle-smoke.ts",
    );
  });

  it("is exempt from lint:all with a reason naming the build output", () => {
    // lint:all runs on the working tree alone; this guard needs dist/, so it
    // must be declared exempt or the registry parity test fails.
    const reason = LINT_ALL_EXEMPT["lint:bundle-smoke"];
    assert.ok(reason, "declared in LINT_ALL_EXEMPT");
    assert.match(reason, /dist\//);
  });

  it("runs in ci.yml after the web build", () => {
    const ci = read(".github/workflows/ci.yml");
    const build = ci.indexOf("- name: Web build");
    const smoke = ci.indexOf("npm run lint:bundle-smoke");
    assert.ok(build !== -1 && smoke !== -1);
    assert.ok(smoke > build);
  });

  it("runs in deploy.yml too, so the shipped artifact is the checked one", () => {
    const deploy = read(".github/workflows/deploy.yml");
    assert.ok(deploy.includes("npm run lint:bundle-smoke"));
  });

  it("runs in release.yml, which carried a DRIFTED copy of the same check", () => {
    // release.yml's inline version never grew the six-language loop ci.yml
    // has, so a dropped translation map failed CI and passed the release
    // gate. Three copies of a check is three chances to be one behind.
    const release = read(".github/workflows/release.yml");
    const build = release.indexOf("- name: Web build");
    const smoke = release.indexOf("npm run lint:bundle-smoke");
    assert.ok(build !== -1 && smoke !== -1);
    assert.ok(smoke > build);
  });

  it("leaves no workflow grepping the bundle for a watched token by hand", () => {
    const dir = path.join(process.cwd(), ".github", "workflows");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const body = read(path.join(".github", "workflows", file));
      for (const provider of BUNDLE_SMOKE_PROVIDERS) {
        assert.ok(
          !body.includes(`for PROVIDER in ${provider}`),
          `${file} still hand-rolls the provider grep`,
        );
      }
      assert.ok(
        !body.includes(`for KEY in ${BUNDLE_SMOKE_I18N_KEYS[0]}`),
        `${file} still hand-rolls the i18n key grep`,
      );
    }
  });
});

describe("token parity with the app", () => {
  it("watches exactly the languages AppLanguage declares", () => {
    // lib/i18n-context.tsx imports react-native, so it cannot be imported
    // here — parse the union instead. A seventh language added to the app
    // and not to the watch list would otherwise never be smoke-checked.
    const source = read("lib/i18n-context.tsx");
    const match = source.match(/export type AppLanguage =([^;]+);/);
    assert.ok(match, "AppLanguage union found");
    const declared = [...(match?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map(
      (hit) => hit[1],
    );
    assert.deepEqual(
      [...declared].sort(),
      [...BUNDLE_SMOKE_LANGUAGE_CODES].sort(),
    );
  });

  it("watches only providers the root layout actually mounts", () => {
    const layout = read("app/_layout.tsx");
    for (const provider of BUNDLE_SMOKE_PROVIDERS) {
      assert.ok(
        layout.includes(`<${provider}`),
        `${provider} is watched but not mounted in app/_layout.tsx`,
      );
    }
  });

  it("watches only i18n keys the translation table declares", () => {
    const source = read("lib/i18n-context.tsx");
    for (const key of BUNDLE_SMOKE_I18N_KEYS) {
      assert.ok(
        source.includes(`${key}:`),
        `${key} is watched but no longer exists — the check would fail for the wrong reason`,
      );
    }
  });
});
