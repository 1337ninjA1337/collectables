/**
 * The two platforms nothing in this repository had ever bundled.
 *
 * `npm run build` exports web and every size check reads `dist/`.
 * `metro.config.js` is shared, so the 115 KiB `ascii_only: false` bought was
 * bought on three platforms and measured on one — which four suggestion lists
 * in a row pointed out, each time at the EAS preview build, which cannot
 * supply the number: `eas build --no-wait` queues a build on Expo's
 * infrastructure and exits, and the job reports success for having queued
 * something.
 *
 * The first `expo export --platform ios` in this tree failed, and this suite is
 * mostly about that: the report's job is to turn a codegen error naming a
 * component nobody here has heard of into the sentence "there are two copies of
 * react-native installed". A raw stack forwarded to the reader is how this went
 * unexamined in the first place.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NATIVE_PLATFORMS,
  diagnoseNativeExportFailure,
  formatBytes,
  formatNativeBundleReport,
  nativeReportExitCode,
  type NativeBundleResult,
} from "@/lib/native-bundle-report";

import { readRepoFile } from "./helpers/repo-file";

/** The failure as Metro actually printed it on 2026-09-19. */
const REAL_FAILURE = [
  "iOS Bundling failed 20854ms node_modules/expo-router/entry.js (2720 modules)",
  'SyntaxError: node_modules/react-native/node_modules/react-native/src/private/components/virtualview/VirtualViewExperimentalNativeComponent.js: Unable to determine event arguments for "onModeChange"',
].join("\n");

const measured = (platform: "ios" | "android", bytes: number): NativeBundleResult => ({
  platform,
  files: [{ path: `_expo/static/js/${platform}/entry-abc.hbc`, bytes }],
  failure: null,
});

describe("diagnosing a failed export", () => {
  it("recognises the duplicate react-native and says what it means", () => {
    const diagnosis = diagnoseNativeExportFailure(REAL_FAILURE);
    assert.ok(diagnosis, "the real failure must be recognised");
    assert.match(diagnosis, /second copy of react-native/);
    assert.match(diagnosis, /virtualized-lists/);
    assert.match(diagnosis, /web build never resolves that file/);
  });

  it("needs BOTH halves of the signature, not either", () => {
    // A codegen error somewhere else is a different problem, and a nested path
    // mentioned in passing is not a diagnosis. Offering this sentence for every
    // failure is how it eventually gets attached to one it is wrong about.
    assert.equal(diagnoseNativeExportFailure("SyntaxError: app/index.tsx: unexpected token"), null);
    assert.equal(
      diagnoseNativeExportFailure("reading node_modules/react-native/node_modules/react-native/README.md"),
      null,
    );
  });

  it("says nothing about an empty or unrelated log", () => {
    assert.equal(diagnoseNativeExportFailure(""), null);
    assert.equal(diagnoseNativeExportFailure("Error: ENOSPC: no space left on device"), null);
  });
});

describe("the report", () => {
  it("lists a platform's files largest first, with a total", () => {
    const report = formatNativeBundleReport([
      {
        platform: "ios",
        files: [
          { path: "_expo/static/js/ios/small.hbc", bytes: 1024 },
          { path: "_expo/static/js/ios/entry.hbc", bytes: 7_826_432 },
        ],
        failure: null,
      },
    ]);
    const lines = report.split("\n").filter((line) => line.includes(".hbc"));
    assert.match(lines[0], /entry\.hbc/, "largest first");
    assert.match(lines[1], /small\.hbc/);
    assert.match(report, /total \(2 file\(s\)\)/);
  });

  it("gives a failed platform a section rather than leaving it out", () => {
    // A broken export omitted would read as a report about one platform, which
    // is the same silence this whole script exists to end.
    const report = formatNativeBundleReport([
      measured("android", 100),
      { platform: "ios", files: [], failure: "two copies of react-native" },
    ]);
    assert.match(report, /^ios:/m);
    assert.match(report, /export failed — two copies of react-native/);
    assert.match(report, /1 of 2 platform\(s\) measured/);
  });

  it("counts an export that emitted nothing as a failure, not as zero bytes", () => {
    const empty: NativeBundleResult = { platform: "ios", files: [], failure: null };
    assert.match(formatNativeBundleReport([empty]), /emitted no bundle/);
    assert.equal(nativeReportExitCode([empty]), 1);
  });

  it("succeeds only when every platform produced something", () => {
    assert.equal(nativeReportExitCode([measured("ios", 10), measured("android", 10)]), 0);
    assert.equal(nativeReportExitCode([measured("ios", 10), { platform: "android", files: [], failure: "x" }]), 1);
    // Nothing ran at all is not a pass: a report that measured nothing has not
    // established that there is nothing to measure.
    assert.equal(nativeReportExitCode([]), 1);
  });

  it("prints KiB, like every other size line in this repository", () => {
    assert.equal(formatBytes(1024), "1.0 KiB");
    assert.equal(formatBytes(7_826_432), "7643.0 KiB");
  });
});

describe("how it is wired", () => {
  it("covers both native platforms", () => {
    assert.deepEqual([...NATIVE_PLATFORMS], ["ios", "android"]);
  });

  it("exports somewhere other than dist/", () => {
    // Four post-build guards read dist/, and all four would read a native
    // bundle left in it.
    const src = readRepoFile("scripts/report-native-bundle.ts");
    assert.match(src, /mkdtempSync/);
    assert.doesNotMatch(src, /"--output-dir", *"dist/);
  });

  it("is a report rather than a gate leg", () => {
    // The gate chains nine steps fail-fast; a tenth that cannot pass today
    // would make every commit red for a dependency-tree problem no commit
    // caused. bundle:composition is the precedent.
    const pkg = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["bundle:native"], "tsx scripts/report-native-bundle.ts");
    assert.doesNotMatch(pkg.scripts.verify, /bundle:native/);
    assert.doesNotMatch(pkg.scripts["lint:ci"], /bundle:native/);
    assert.doesNotMatch(readRepoFile(".github/workflows/ci.yml"), /bundle:native/);
  });
});
