/**
 * The native bundles nobody has ever measured — and the reason the first
 * attempt to measure them failed.
 *
 * ## Why there was no number
 *
 * `npm run build` exports the WEB bundle, and every size check in this
 * repository reads `dist/`. `metro.config.js` is shared, so iOS and Android
 * take the same transformer and the same `ascii_only: false` — the 115 KiB that
 * change bought was bought on three platforms and measured on one. Four
 * suggestion lists in a row asked for a line on the other two, each time
 * pointing at the EAS preview build in CI, which cannot supply it: that job runs
 * `eas build --no-wait`, which QUEUES a build on Expo's infrastructure and
 * exits. It reports success for having queued something. Nothing in this
 * repository has ever bundled for a native platform.
 *
 * ## What that hid
 *
 * On 2026-09-19 the first `expo export --platform ios` in this tree failed —
 * not for a reason in this app's code, and not recently: a SECOND COPY of
 * react-native (0.86.0) sits at `node_modules/react-native/node_modules/
 * react-native`, auto-installed by npm to satisfy a `react-native: *` peer of
 * `@react-native/virtualized-lists`, which npm resolved to the newest published
 * version rather than to the 0.81.5 already at the root. Metro resolves a
 * private component out of that copy and the 0.81 codegen cannot parse it
 * (`Unable to determine event arguments for "onModeChange"`). Moving the nested
 * copy aside makes the export succeed — 7.83 MB of Hermes bytecode — and
 * putting it back makes it fail again.
 *
 * The web build never touches that file, so `npm run verify` is green, CI is
 * green, and the EAS job is green for having queued a build whose outcome
 * nothing here reads. That is the exact shape of failure a report is for.
 *
 * ## Why this is a report and not a gate step
 *
 * The gate has nine legs and `npm run verify` chains them fail-fast, so a tenth
 * that cannot pass today would make every commit red for a dependency-tree
 * problem no commit caused. `bundle:composition` is the precedent: it gates
 * nothing and is run when a question comes up. This is run when the question is
 * "how big is the native bundle", and today it answers "there isn't one, and
 * here is why".
 */

/** The platforms `expo export` can be asked for that this report covers. */
export const NATIVE_PLATFORMS = ["ios", "android"] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

/** One emitted bundle file. */
export interface NativeBundleFile {
  /** Path relative to the export directory. */
  readonly path: string;
  readonly bytes: number;
}

/** What one platform's export produced, or why it produced nothing. */
export interface NativeBundleResult {
  readonly platform: NativePlatform;
  readonly files: readonly NativeBundleFile[];
  /** Present when the export failed; the diagnosis, not the raw log. */
  readonly failure: string | null;
}

/**
 * The duplicate-react-native signature, recognised.
 *
 * A codegen parse error naming a file under a nested `react-native/node_modules/
 * react-native` is not a syntax error in this app and not a bug in either copy:
 * it is one version's babel plugin reading another version's source. The raw
 * message points at a component nobody here has heard of, which is how this
 * went unexamined — so the report says what it MEANS and where to look, rather
 * than forwarding a stack.
 *
 * Returns `null` for anything it does not recognise, because a diagnosis
 * offered for every failure is a diagnosis that will eventually be wrong about
 * one that mattered.
 */
export function diagnoseNativeExportFailure(output: string): string | null {
  const nested = /node_modules[\\/]react-native[\\/]node_modules[\\/]react-native[\\/]/.test(output);
  const codegen = /Unable to determine event arguments|codegenNativeComponent|SyntaxError/.test(output);
  if (!nested || !codegen) return null;
  return [
    "A second copy of react-native is installed at node_modules/react-native/node_modules/react-native, and Metro resolved a private component out of it.",
    "npm puts it there to satisfy @react-native/virtualized-lists' `react-native: *` peer, which it resolves to the newest published version instead of deduping to the 0.81.5 already at the root.",
    "The root copy's codegen cannot parse the nested copy's source, which is the error above. The web build never resolves that file, so every check in this repository stays green.",
    "Confirmed by moving the nested directory aside (the export succeeds) and putting it back (it fails again). `overrides` did not dislodge it; the fix is a dependency-tree decision, not a code change.",
  ].join("\n  ");
}

/** Bytes as the report prints them — KiB with one decimal, right-aligned by the caller. */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * The whole report.
 *
 * Every platform gets a section whether or not it produced anything: a platform
 * that failed is the finding, and leaving it out would make a broken export
 * look like a report about one platform.
 */
export function formatNativeBundleReport(results: readonly NativeBundleResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`${result.platform}:`);
    if (result.failure) {
      lines.push(`  export failed — ${result.failure}`);
      lines.push("");
      continue;
    }
    if (result.files.length === 0) {
      lines.push("  export succeeded and emitted no bundle, which should not happen.");
      lines.push("");
      continue;
    }
    const total = result.files.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of [...result.files].sort((a, b) => b.bytes - a.bytes)) {
      lines.push(`  ${formatBytes(file.bytes).padStart(12)}  ${file.path}`);
    }
    lines.push(`  ${formatBytes(total).padStart(12)}  total (${result.files.length} file(s))`);
    lines.push("");
  }
  const measured = results.filter((r) => !r.failure);
  lines.push(
    measured.length === results.length
      ? `bundle:native: ${measured.length} platform(s) measured.`
      : `bundle:native: ${measured.length} of ${results.length} platform(s) measured — see the failures above.`,
  );
  return lines.join("\n");
}

/** Non-zero when any platform could not be measured — a report that found a hole says so. */
export function nativeReportExitCode(results: readonly NativeBundleResult[]): 0 | 1 {
  if (results.length === 0) return 1;
  return results.every((r) => !r.failure && r.files.length > 0) ? 0 : 1;
}
