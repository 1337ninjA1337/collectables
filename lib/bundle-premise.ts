/**
 * Shared "the input exists and is fresh" premise for the post-build guards
 * (pure logic — the filesystem half lives in `scripts/bundle-premise.ts`).
 *
 * Every check that runs after `npm run build` proves a NEGATIVE over `dist/`:
 * no secret leaked into the bundle, no size budget exceeded, no watched
 * `EXPO_PUBLIC_*` var left un-inlined. A guard that proves a negative is only
 * as good as its input, and two different ways of having no input both read
 * as success:
 *
 *   1. The glob matched nothing. `check-bundle-secrets` walked `dist/`, found
 *      zero files and printed `scanned 0 bundle file(s), no secrets leaked` —
 *      a green report over zero bytes.
 *   2. `dist/` is STALE: a bundle exported before the change being checked
 *      existed. The scan finds nothing because the code it would have found
 *      was never exported. Locally this is one forgotten `npm run build`
 *      away, and nothing in the output says which build was inspected.
 *
 * This is the same vacuous-green shape as the `sentry-sdk-absent` job's
 * `rm -rf` (which exited 0 whether or not there was anything to delete) and
 * as the Node 20 outage (coverage evaporated while the report stayed small
 * and green). Asserting the premise is what separates "checked and found
 * nothing" from "did not check".
 */

import { checkError } from "./check-error";

/** `dist/_expo/static/js/web`, split so callers can `path.join` it. */
export const WEB_BUNDLE_DIR_SEGMENTS = [
  "dist",
  "_expo",
  "static",
  "js",
  "web",
] as const;

/** Display form of {@link WEB_BUNDLE_DIR_SEGMENTS}. */
export const WEB_BUNDLE_DIR = WEB_BUNDLE_DIR_SEGMENTS.join("/");

/**
 * Repo-relative paths whose contents end up in the exported web bundle. A
 * change under any of them invalidates `dist/`.
 *
 * `__tests__/` and `scripts/` are deliberately absent — neither is bundled by
 * Metro, so editing a test or a lint guard must not make a perfectly current
 * bundle look stale (that false positive is how a freshness check gets turned
 * off). `dist/` itself is absent for the obvious reason: it is the output.
 * Entries that do not exist in the tree are skipped by the collector rather
 * than treated as an error, so this list can name optional config files.
 */
export const BUNDLE_SOURCE_PATHS = [
  "app",
  "components",
  "lib",
  "assets",
  "app.json",
  "package.json",
  "babel.config.js",
  "metro.config.js",
] as const;

export type BundlePremiseFailureCode =
  | "missing_dist"
  | "missing_bundle_dir"
  | "no_js_bundles"
  | "no_scanned_files"
  | "stale_bundle";

export type BundlePremiseInput = {
  readonly distExists: boolean;
  readonly bundleDirExists: boolean;
  /** Number of `*.js` chunks under {@link WEB_BUNDLE_DIR}. */
  readonly jsBundleCount: number;
  /** Newest mtime across the exported bundle, or null when there is none. */
  readonly newestBundleMtimeMs: number | null;
  /** Newest mtime across {@link BUNDLE_SOURCE_PATHS}, or null when unknown. */
  readonly newestSourceMtimeMs: number | null;
  /** Which source file carries {@link newestSourceMtimeMs}. */
  readonly newestSourcePath: string | null;
};

export type BundlePremiseFailure = {
  readonly code: BundlePremiseFailureCode;
  /** Set for `stale_bundle`: the source file newer than the bundle. */
  readonly sourcePath?: string;
  /** Set for `stale_bundle`: how far ahead of the bundle that file is. */
  readonly staleByMs?: number;
  /** Set for `no_scanned_files`: what the caller was going to read. */
  readonly scannedLabel?: string;
};

export type BundlePremiseVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: BundlePremiseFailure };

const OK: BundlePremiseVerdict = { ok: true };

/**
 * Gate order is cheapest-and-most-specific first: a missing `dist/` explains
 * every other symptom, so reporting "stale" for a tree that was never built
 * would send the reader looking for the wrong fix.
 *
 * Staleness is skipped when either mtime is unknown (`null`) rather than
 * assumed — a collector that cannot stat the tree must not be able to fail
 * the build with a comparison it did not actually make.
 */
export function evaluateBundlePremise(
  input: BundlePremiseInput,
): BundlePremiseVerdict {
  if (!input.distExists) return { ok: false, failure: { code: "missing_dist" } };
  if (!input.bundleDirExists) {
    return { ok: false, failure: { code: "missing_bundle_dir" } };
  }
  if (input.jsBundleCount <= 0) {
    return { ok: false, failure: { code: "no_js_bundles" } };
  }
  const { newestBundleMtimeMs: bundleMs, newestSourceMtimeMs: sourceMs } = input;
  if (bundleMs !== null && sourceMs !== null && sourceMs > bundleMs) {
    return {
      ok: false,
      failure: {
        code: "stale_bundle",
        sourcePath: input.newestSourcePath ?? undefined,
        staleByMs: sourceMs - bundleMs,
      },
    };
  }
  return OK;
}

/**
 * A caller that collected its own file list (the secret scan walks every
 * artifact extension, not just `*.js`) asserts separately that the list is
 * non-empty. Kept as its own entry point rather than folded into
 * {@link evaluateBundlePremise} because only the caller knows what it was
 * about to read.
 */
export function evaluateScannedFiles(
  count: number,
  scannedLabel: string,
): BundlePremiseVerdict {
  if (count > 0) return OK;
  return { ok: false, failure: { code: "no_scanned_files", scannedLabel } };
}

const REBUILD_HINT = "Run `npm run build` first.";

/**
 * Exhaustive over {@link BundlePremiseFailureCode}, so a new code cannot ship
 * without a message — the same shape the filter-sheet error records use.
 */
const FAILURE_MESSAGE: Record<
  BundlePremiseFailureCode,
  (failure: BundlePremiseFailure) => string
> = {
  missing_dist: () => `dist/ not found. ${REBUILD_HINT}`,
  missing_bundle_dir: () => `${WEB_BUNDLE_DIR}/ not found. ${REBUILD_HINT}`,
  no_js_bundles: () =>
    `no .js chunks in ${WEB_BUNDLE_DIR}/ — there is nothing to check, so a pass here would prove nothing. ${REBUILD_HINT}`,
  no_scanned_files: (failure) =>
    `matched 0 ${failure.scannedLabel ?? "file"}(s) — a pass over zero files is not a pass. ${REBUILD_HINT}`,
  stale_bundle: (failure) => {
    const where = failure.sourcePath ? ` (${failure.sourcePath})` : "";
    const seconds = Math.round((failure.staleByMs ?? 0) / 1000);
    return `dist/ is older than the source tree${where} by ${seconds}s — this would check a bundle that predates the change. ${REBUILD_HINT}`;
  },
};

/** One-line, prefixed with the guard's own name so the log says who failed. */
export function formatBundlePremiseFailure(
  checkName: string,
  failure: BundlePremiseFailure,
): string {
  return checkError(checkName, FAILURE_MESSAGE[failure.code](failure));
}
