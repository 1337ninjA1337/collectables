#!/usr/bin/env tsx
/**
 * How big the iOS and Android bundles are — the number four suggestion lists
 * asked for and nothing in this repository could supply.
 *
 * `npm run bundle:native`. A REPORT, not a gate step: it gates nothing and is
 * run when the question comes up, the same standing `bundle:composition` has.
 * The reasoning, and what the first run of it found, is in
 * `lib/native-bundle-report.ts`.
 *
 * It exports into a temporary directory rather than `dist/`, because `dist/` is
 * the web export that four post-build guards read and a native bundle sitting
 * in it would be read by all four.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  NATIVE_PLATFORMS,
  diagnoseNativeExportFailure,
  formatNativeBundleReport,
  nativeReportExitCode,
  type NativeBundleFile,
  type NativeBundleResult,
  type NativePlatform,
} from "../lib/native-bundle-report";
import { describeThrownReason } from "../lib/thrown-value";

const REPO_ROOT = path.join(__dirname, "..");

/** Every emitted file under an export directory, with its size. */
function emittedFiles(dir: string): NativeBundleFile[] {
  const found: NativeBundleFile[] = [];
  const walk = (relative: string): void => {
    const absolute = relative === "" ? dir : path.join(dir, relative);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      // The bundle and nothing else: metadata.json and the asset map are real
      // output and are not what "how big is the bundle" is asking.
      else if (entry.isFile() && /\.(hbc|js|bundle)$/.test(entry.name)) {
        found.push({ path: next, bytes: fs.statSync(path.join(dir, next)).size });
      }
    }
  };
  walk("");
  return found;
}

function exportOne(platform: NativePlatform): NativeBundleResult {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `native-${platform}-`));
  try {
    execFileSync(
      "npx",
      ["expo", "export", "--platform", platform, "--output-dir", outDir],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { platform, files: emittedFiles(outDir), failure: null };
  } catch (error) {
    // execFileSync attaches the child's streams to the thrown error; the
    // diagnosis is made from them rather than from the exit code, which says
    // only that Metro gave up.
    const shaped = error as { stdout?: string; stderr?: string };
    const output = `${shaped.stdout ?? ""}\n${shaped.stderr ?? ""}`;
    const diagnosis = diagnoseNativeExportFailure(output);
    return {
      platform,
      files: [],
      failure: diagnosis ?? `${describeThrownReason(error)}\n${output.trim().split("\n").slice(-6).join("\n  ")}`,
    };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function main(): void {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const platforms = (requested.length > 0 ? requested : NATIVE_PLATFORMS).filter(
    (name): name is NativePlatform => (NATIVE_PLATFORMS as readonly string[]).includes(name),
  );
  if (platforms.length === 0) {
    console.error(`bundle:native: no known platform in [${requested.join(", ")}] — pick from ${NATIVE_PLATFORMS.join(", ")}.`);
    process.exit(1);
  }
  const results = platforms.map(exportOne);
  const report = formatNativeBundleReport(results);
  const code = nativeReportExitCode(results);
  if (code === 0) console.log(report);
  else console.error(report);
  process.exit(code);
}

main();
