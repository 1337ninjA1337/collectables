import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  WATCHED_PACKAGE_PREFIXES,
  classifyExpoCheck,
  formatExpoInstallReport,
  isWatchedPackage,
  parseExpoInstallDrifts,
  splitWatchedDrifts,
} from "../lib/check-expo-install";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const DRIFT_OUTPUT = [
  "The following packages should be updated for best compatibility with the installed expo version:",
  "  posthog-react-native@4.44.4 - expected version: 4.47.0",
  "  @sentry/react-native@7.5.0 - expected version: 7.6.1",
  "  expo-constants@15.4.0 - expected version: 15.4.5",
  "Your project may not work correctly until you install the expected versions of the packages.",
].join("\n");

describe("parseExpoInstallDrifts", () => {
  it("parses plain and scoped package drift lines", () => {
    const drifts = parseExpoInstallDrifts(DRIFT_OUTPUT);
    assert.deepEqual(drifts, [
      { pkg: "posthog-react-native", installed: "4.44.4", expected: "4.47.0" },
      { pkg: "@sentry/react-native", installed: "7.5.0", expected: "7.6.1" },
      { pkg: "expo-constants", installed: "15.4.0", expected: "15.4.5" },
    ]);
  });

  it("returns empty for up-to-date and unrelated output", () => {
    assert.deepEqual(parseExpoInstallDrifts("Dependencies are up to date"), []);
    assert.deepEqual(
      parseExpoInstallDrifts("npm error network request to https://registry failed"),
      [],
    );
    assert.deepEqual(parseExpoInstallDrifts(""), []);
  });

  it("does not match prose mentioning an @version without the drift shape", () => {
    const drifts = parseExpoInstallDrifts(
      "Installing posthog-js@1.372.10 from the registry",
    );
    assert.deepEqual(drifts, []);
  });
});

describe("classifyExpoCheck", () => {
  it("exit 0 is clean regardless of output noise", () => {
    assert.deepEqual(classifyExpoCheck(0, DRIFT_OUTPUT), { status: "clean", drifts: [] });
    assert.deepEqual(classifyExpoCheck(0, ""), { status: "clean", drifts: [] });
  });

  it("non-zero exit with parseable drift lines is drift", () => {
    const result = classifyExpoCheck(1, DRIFT_OUTPUT);
    assert.equal(result.status, "drift");
    assert.equal(result.drifts.length, 3);
  });

  it("non-zero exit without drift lines is unreachable (soft skip)", () => {
    const result = classifyExpoCheck(1, "npm error ETIMEDOUT registry.npmjs.org");
    assert.deepEqual(result, { status: "unreachable", drifts: [] });
  });
});

describe("watched-package split", () => {
  it("posthog-* is watched; expo/sentry packages are advisory", () => {
    assert.equal(isWatchedPackage("posthog-react-native"), true);
    assert.equal(isWatchedPackage("posthog-js"), true);
    assert.equal(isWatchedPackage("expo-constants"), false);
    assert.equal(isWatchedPackage("@sentry/react-native"), false);
  });

  it("splitWatchedDrifts partitions in order", () => {
    const { watched, advisory } = splitWatchedDrifts(parseExpoInstallDrifts(DRIFT_OUTPUT));
    assert.deepEqual(watched.map((d) => d.pkg), ["posthog-react-native"]);
    assert.deepEqual(advisory.map((d) => d.pkg), ["@sentry/react-native", "expo-constants"]);
  });

  it("the watched prefixes cover every posthog dependency actually shipped", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    const posthogDeps = Object.keys(pkg.dependencies).filter((name) =>
      name.includes("posthog"),
    );
    assert.ok(posthogDeps.length >= 2, "expected posthog-js + posthog-react-native");
    for (const dep of posthogDeps) {
      assert.equal(isWatchedPackage(dep), true, `${dep} must be watched`);
    }
    assert.deepEqual([...WATCHED_PACKAGE_PREFIXES], ["posthog-"]);
  });
});

describe("formatExpoInstallReport", () => {
  it("returns empty string when nothing watched drifted", () => {
    assert.equal(formatExpoInstallReport([]), "");
    assert.equal(
      formatExpoInstallReport([], [{ pkg: "expo-constants", installed: "1", expected: "2" }]),
      "",
    );
  });

  it("names each watched drift and appends advisory drift as non-blocking", () => {
    const report = formatExpoInstallReport(
      [{ pkg: "posthog-js", installed: "1.372.10", expected: "1.400.0" }],
      [{ pkg: "expo-constants", installed: "15.4.0", expected: "15.4.5" }],
    );
    assert.match(report, /1 watched package\(s\)/);
    assert.match(report, /posthog-js@1\.372\.10 -> expected 1\.400\.0/);
    assert.match(report, /npx expo install/);
    assert.match(report, /non-blocking.*1 other package\(s\)/);
    assert.match(report, /expo-constants@15\.4\.0 -> expected 15\.4\.5/);
  });
});

describe("CI wiring", () => {
  it("package.json exposes lint:expo-install and keeps the advisory postinstall", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["lint:expo-install"], "tsx scripts/check-expo-install.ts");
    // The non-failing postinstall stays: it surfaces drift on every local
    // install; the new script is the CI-enforcing half.
    assert.equal(pkg.scripts.postinstall, "npx expo install --check || true");
  });

  it("ci.yml runs the expo-install step without continue-on-error", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /npm run lint:expo-install/);
    const step = ci.split("npm run lint:expo-install")[0].split("- name:").pop() ?? "";
    assert.ok(
      !step.includes("continue-on-error"),
      "watched drift must block, not warn",
    );
  });

  it("the script wrapper delegates to the pure classifier and exits 1 on watched drift", () => {
    const script = read("scripts/check-expo-install.ts");
    assert.match(script, /from "\.\.\/lib\/check-expo-install"/);
    assert.match(script, /expo", "install", "--check/);
    assert.match(script, /classifyExpoCheck/);
    assert.match(script, /splitWatchedDrifts/);
    assert.match(script, /process\.exit\(1\)/);
  });
});
