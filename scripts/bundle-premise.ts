/**
 * Filesystem half of the post-build premise check (pure logic in
 * `lib/bundle-premise.ts`, which explains WHY this exists).
 *
 * Not a CLI: this module has no top-level `main()` and is imported by the
 * three post-build guards — `check-bundle-secrets`, `check-bundle-size` and
 * `verify-bundle-inlining` — so all three agree on what "there is a bundle to
 * check" means. Every entry point takes an explicit `root` (defaulting to the
 * repo) so the suite can point it at a fixture directory and exercise the
 * real stat/walk rather than a re-implementation of it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  BUNDLE_SOURCE_PATHS,
  WEB_BUNDLE_DIR,
  WEB_BUNDLE_DIR_SEGMENTS,
  evaluateBundlePremise,
  evaluateScannedFiles,
  formatBundlePremiseFailure,
  type BundlePremiseInput,
} from "../lib/bundle-premise";

export const REPO_ROOT = path.join(__dirname, "..");

export type CollectedPremise = BundlePremiseInput & {
  /** Absolute paths of the exported `*.js` chunks, sorted. */
  readonly jsBundlePaths: readonly string[];
};

type Newest = { ms: number | null; rel: string | null };

/** Directories that are never part of the bundle input and are expensive to walk. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git", ".expo"]);

function walkNewest(root: string, target: string, acc: Newest): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    // A listed source path that does not exist is skipped, not an error —
    // BUNDLE_SOURCE_PATHS deliberately names optional config files.
    return;
  }
  if (stat.isDirectory()) {
    if (SKIPPED_DIRS.has(path.basename(target))) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      walkNewest(root, path.join(target, entry.name), acc);
    }
    return;
  }
  if (acc.ms === null || stat.mtimeMs > acc.ms) {
    acc.ms = stat.mtimeMs;
    acc.rel = path.relative(root, target) || path.basename(target);
  }
}

/**
 * Reads the state the premise is evaluated against. Kept separate from the
 * assertion so a caller (or a test) can inspect the raw numbers.
 */
export function collectBundlePremise(root: string = REPO_ROOT): CollectedPremise {
  const distDir = path.join(root, WEB_BUNDLE_DIR_SEGMENTS[0]);
  const bundleDir = path.join(root, ...WEB_BUNDLE_DIR_SEGMENTS);

  const distExists = fs.existsSync(distDir);
  const bundleDirExists = distExists && fs.existsSync(bundleDir);

  const jsBundlePaths: string[] = [];
  const bundleNewest: Newest = { ms: null, rel: null };
  if (bundleDirExists) {
    let entries: string[];
    try {
      entries = fs.readdirSync(bundleDir);
    } catch {
      entries = [];
    }
    for (const name of entries.sort()) {
      if (!name.endsWith(".js")) continue;
      const full = path.join(bundleDir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      jsBundlePaths.push(full);
      if (bundleNewest.ms === null || stat.mtimeMs > bundleNewest.ms) {
        bundleNewest.ms = stat.mtimeMs;
        bundleNewest.rel = path.relative(root, full);
      }
    }
  }

  const sourceNewest: Newest = { ms: null, rel: null };
  for (const rel of BUNDLE_SOURCE_PATHS) {
    walkNewest(root, path.join(root, rel), sourceNewest);
  }

  return {
    distExists,
    bundleDirExists,
    jsBundleCount: jsBundlePaths.length,
    newestBundleMtimeMs: bundleNewest.ms,
    newestSourceMtimeMs: sourceNewest.ms,
    newestSourcePath: sourceNewest.rel,
    jsBundlePaths,
  };
}

/**
 * Asserts there is a current bundle to check, exiting 1 with a named message
 * when there is not, and hands back the chunk list so callers do not each
 * re-`readdir` the same directory (three copies of that glob is how one of
 * them ends up matching something the others do not).
 */
export function assertBundlePremise(
  checkName: string,
  root: string = REPO_ROOT,
): readonly string[] {
  const collected = collectBundlePremise(root);
  const verdict = evaluateBundlePremise(collected);
  if (!verdict.ok) {
    console.error(formatBundlePremiseFailure(checkName, verdict.failure));
    process.exit(1);
  }
  return collected.jsBundlePaths;
}

/**
 * Asserts a caller's own file list is non-empty. `check-bundle-secrets` walks
 * every artifact extension under `dist/`, not just the `*.js` chunks
 * {@link assertBundlePremise} counts, so its "did I read anything?" question
 * is a different one.
 */
export function assertScannedFiles(
  checkName: string,
  count: number,
  scannedLabel: string,
): void {
  const verdict = evaluateScannedFiles(count, scannedLabel);
  if (!verdict.ok) {
    console.error(formatBundlePremiseFailure(checkName, verdict.failure));
    process.exit(1);
  }
}

export { WEB_BUNDLE_DIR };
