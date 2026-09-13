/**
 * What the bundle is made OF (pure logic — CLI wrapper in
 * `scripts/report-bundle-composition.ts`).
 *
 * `lib/bundle-size.ts` answers how big the bundle is and how fast it grew;
 * six rounds of suggestions asked the other question and nothing could
 * answer it. Five raises have argued about how much room to buy and none
 * about what spent it beyond one sentence per `BUDGET_HISTORY` row, so the
 * first round told to make the bundle SMALLER would have started with no data
 * at all — and the only reason anybody knows the currency-input adoption GAVE
 * 1.1 KiB back is that somebody measured it by hand, before and after.
 *
 * ## How the bytes are attributed
 *
 * From the export's own sourcemap, which is the only thing that knows which
 * module a minified byte came from. Each mapping segment claims the generated
 * text from its column up to the next segment's column (or the end of that
 * line), and those bytes are charged to the segment's source file. It is the
 * same arithmetic `source-map-explorer` does, written out here because the
 * whole of it is sixty lines and a dependency that ships nothing to users is
 * still a dependency to audit.
 *
 * **The measure is UTF-8 bytes of the generated text, not of the source.**
 * Six locales of translated copy are Cyrillic and Polish diacritics: counting
 * UTF-16 code units would under-report exactly the module the budget argues
 * about most. Sourcemap columns are UTF-16 offsets, so the slice is taken by
 * column and then encoded — the two units meet in the right order.
 *
 * **What is NOT attributed is reported rather than distributed.** A minifier
 * emits text no module claims: the runtime preamble, the module wrapper
 * boilerplate, and every newline between chunks of one logical line. Sharing
 * those bytes out pro-rata would make every number a little wrong and none of
 * them wrong enough to notice, so they are one named line instead. It is
 * typically a few percent, and if it ever is not, that is a finding about the
 * build rather than a rounding error to hide.
 *
 * ## What it can and cannot say
 *
 * It can say a package is 400 KiB of the entry chunk. It cannot say removing
 * that package would return 400 KiB: shared helpers, tree-shaken re-exports
 * and code a minifier hoisted out of one module into another all move bytes
 * across this boundary. The report says so where somebody reads it, because a
 * per-module number is exactly the shape people quote as a saving.
 *
 * Node-safe and pure: it takes the chunk text and the parsed map from a caller
 * that read them, the same split every other guard here uses.
 */

import { SOURCE_DIRS } from "@/lib/source-dirs";

/** The label bytes get when no mapping segment claims them. */
export const UNATTRIBUTED = "(unattributed)";

/** The label for Metro's generated modules — polyfills, shims, the prelude. */
export const GENERATED = "(generated)";

/** Only the two fields the attribution reads; a real map carries more. */
export type SourceMapLike = {
  readonly sources: readonly (string | null)[];
  readonly mappings: string;
  /** Prefixed onto every relative source, per the sourcemap spec. */
  readonly sourceRoot?: string;
};

/** One decoded mapping: where it starts, and which source it speaks for. */
export type MappingSegment = {
  readonly generatedColumn: number;
  /** `null` for a one-field segment, which claims text for no source. */
  readonly sourceIndex: number | null;
};

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_VALUE: ReadonlyMap<string, number> = new Map(
  [...BASE64_ALPHABET].map((char, index) => [char, index] as const),
);

/**
 * Base64 VLQ, the encoding a sourcemap's `mappings` field is written in: five
 * data bits per digit, low bit of the first digit is the sign, bit 32 says
 * another digit follows.
 *
 * Accumulated with `* 2 ** shift` rather than `<< shift` deliberately. A
 * bundle this size has generated columns past 2^31 on its single longest line,
 * and `<<` is a 32-bit operator: it wraps, silently, producing a column that
 * is negative or small and an attribution that charges a megabyte to whichever
 * module happens to sort next. The one shape of this bug that cannot be caught
 * by reading a small fixture.
 */
export function decodeVlq(field: string): readonly number[] {
  const values: number[] = [];
  let accumulated = 0;
  let shift = 0;
  let open = false;
  for (const char of field) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined) {
      throw new Error(`bundle-composition: "${char}" is not a base64 VLQ digit`);
    }
    accumulated += (digit & 31) * 2 ** shift;
    if ((digit & 32) === 0) {
      const negative = (accumulated & 1) === 1;
      const magnitude = Math.floor(accumulated / 2);
      values.push(negative ? -magnitude : magnitude);
      accumulated = 0;
      shift = 0;
      open = false;
      continue;
    }
    shift += 5;
    open = true;
  }
  if (open) {
    throw new Error(
      `bundle-composition: VLQ field "${field}" ends mid-number (a continuation bit with nothing after it)`,
    );
  }
  return values;
}

/**
 * `mappings` as one array of segments per generated line.
 *
 * Only the generated column and the source index are kept — the source line
 * and column say where a byte CAME from, and this module only asks which file
 * it belongs to. The source index is cumulative across the whole map rather
 * than per line, which is the one piece of the format that cannot be inferred
 * by reading a single line of it.
 */
export function decodeMappings(
  mappings: string,
): readonly (readonly MappingSegment[])[] {
  let sourceIndex = 0;
  return mappings.split(";").map((line) => {
    let generatedColumn = 0;
    const segments: MappingSegment[] = [];
    for (const field of line.split(",")) {
      if (field === "") continue;
      const values = decodeVlq(field);
      generatedColumn += values[0];
      if (values.length === 1) {
        segments.push({ generatedColumn, sourceIndex: null });
        continue;
      }
      sourceIndex += values[1];
      segments.push({ generatedColumn, sourceIndex });
    }
    // Sorted rather than trusted: the attribution reads each segment's end off
    // the NEXT one's start, so one out-of-order column would hand a negative
    // range to `slice` and charge the rest of the line to the wrong module.
    return segments
      .slice()
      .sort((a, b) => a.generatedColumn - b.generatedColumn);
  });
}

/** The source a segment names, with `sourceRoot` applied, or `undefined`. */
function sourceAt(map: SourceMapLike, index: number): string | undefined {
  const source = map.sources[index];
  if (source === undefined || source === null) return undefined;
  const root = map.sourceRoot;
  if (root === undefined || root === "" || source.startsWith("/")) return source;
  return `${root.replace(/\/$/, "")}/${source}`;
}

/**
 * UTF-8 bytes of `code`, charged to the source each mapping segment names.
 *
 * Unclaimed text — everything before the first segment on a line, every line
 * no segment mentions, and the newlines themselves — lands under
 * {@link UNATTRIBUTED} rather than being dropped, so the returned map sums to
 * the chunk's own size and a caller can say so.
 */
export function attributeChunkBytes(
  code: string,
  map: SourceMapLike,
): ReadonlyMap<string, number> {
  const encoder = new TextEncoder();
  const bytes = new Map<string, number>();
  const charge = (label: string, text: string): void => {
    if (text === "") return;
    const size = encoder.encode(text).length;
    bytes.set(label, (bytes.get(label) ?? 0) + size);
  };

  const lines = code.split("\n");
  const mappingLines = decodeMappings(map.mappings);
  lines.forEach((line, index) => {
    const segments = mappingLines[index] ?? [];
    if (segments.length === 0) {
      charge(UNATTRIBUTED, line);
    } else {
      charge(UNATTRIBUTED, line.slice(0, segments[0].generatedColumn));
      segments.forEach((segment, position) => {
        const next = segments[position + 1];
        const end = next === undefined ? line.length : next.generatedColumn;
        const label =
          segment.sourceIndex === null
            ? UNATTRIBUTED
            : (sourceAt(map, segment.sourceIndex) ?? UNATTRIBUTED);
        charge(label, line.slice(segment.generatedColumn, end));
      });
    }
    // The newline this split consumed. One byte, and there are two thousand of
    // them in the entry chunk — small, and dropping them would make the parts
    // fail to add up to the whole, which is the one property that makes the
    // unattributed line checkable.
    if (index < lines.length - 1) charge(UNATTRIBUTED, "\n");
  });
  return bytes;
}

/** Where a module came from, as the report groups it. */
export type ModuleBucket = {
  /** `react-native-web`, `lib/`, `(generated)` — what the report prints. */
  readonly label: string;
  /** True for this repository's own source, false for anything installed. */
  readonly firstParty: boolean;
};

/**
 * Top-level directories that hold this repository's bytes but no scanned
 * TypeScript, so {@link SOURCE_DIRS} has no reason to name them.
 *
 * `assets/` is fonts and images, and a bundled asset is as much this project's
 * weight as a module is — the icon set and the font files land in the entry
 * chunk beside the screens that reference them. Charging them to the
 * dependencies would credit `expo-font` with bytes nobody installed.
 *
 * A list of its own rather than an edit to `lib/source-dirs.ts`: that one
 * answers "where does a repo-wide rule about application CODE look", and
 * adding `assets` there would point five guards at a directory of PNGs.
 */
export const NON_CODE_FIRST_PARTY_ROOTS: readonly string[] = ["assets"];

/**
 * Source paths this repository's own code lives under.
 *
 * Derived from {@link SOURCE_DIRS} rather than restated: the question "which
 * top-level directories are ours" is already answered once, and a second
 * hand-written copy is the pair that drifts — a new source directory would
 * otherwise be silently reported as a dependency, which is the one direction
 * nobody checks.
 *
 * It is NOT "whatever is not `node_modules`": the map also carries Metro's
 * virtual modules and its `\0shim:` wrappers around dependency files, and
 * calling those first-party would credit the app with bytes it did not write.
 */
export const FIRST_PARTY_ROOTS: readonly string[] = [
  ...SOURCE_DIRS,
  ...NON_CODE_FIRST_PARTY_ROOTS,
];

const NODE_MODULES = "node_modules/";

/**
 * The bucket a sourcemap source belongs to.
 *
 * `repoRoot` is stripped when the map records absolute paths; Metro's web
 * export writes them repo-relative with a leading slash, so the default
 * handles today's build and the parameter handles a bundler that does not.
 */
export function moduleBucket(
  sourcePath: string,
  repoRoot = "",
): ModuleBucket {
  if (sourcePath === UNATTRIBUTED) {
    return { label: UNATTRIBUTED, firstParty: false };
  }
  // Metro's own modules: `__prelude__`, `\0polyfill:…`, `\0shim:…`. The shims
  // name a dependency file and are generated glue around it, so they are not
  // that dependency's bytes and must not be added to its total.
  if (sourcePath.startsWith("\0") || /^__[\w-]+__$/.test(sourcePath)) {
    return { label: GENERATED, firstParty: false };
  }

  let path = sourcePath.replace(/\\/g, "/");
  if (repoRoot !== "" && path.startsWith(`${repoRoot.replace(/\/$/, "")}/`)) {
    path = path.slice(repoRoot.replace(/\/$/, "").length + 1);
  }
  // `require.context` modules arrive as `/app?ctx=<hash>`; the query is the
  // context's identity and not part of the path.
  path = path.replace(/[?#].*$/, "");
  path = path.replace(/^\.?\//, "").replace(/^(?:\.\.\/)+/, "");

  const lastPackageRoot = path.lastIndexOf(NODE_MODULES);
  if (lastPackageRoot !== -1) {
    const rest = path.slice(lastPackageRoot + NODE_MODULES.length);
    const segments = rest.split("/");
    // A scoped package is two segments; `@sentry/react-native` and
    // `@sentry/browser` are different installs and bucketing both as "@sentry"
    // would hide which one is in the bundle.
    const name = segments[0].startsWith("@")
      ? segments.slice(0, 2).join("/")
      : segments[0];
    return { label: name === "" ? GENERATED : name, firstParty: false };
  }

  const segments = path.split("/");
  // Not `segments.length > 1`: expo-router's route table is the whole
  // directory, so it arrives as `/app?ctx=<hash>` and reduces to `app` with no
  // file after it. Read as a root FILE it made a second bucket named `app`
  // beside `app/`, splitting one directory's bytes across two rows of the
  // report — which is the sort of thing a reader notices only if they add the
  // rows up.
  if (FIRST_PARTY_ROOTS.includes(segments[0])) {
    return { label: `${segments[0]}/`, firstParty: true };
  }
  // A file at the repo root (`app.config.ts`) is its own bucket: there is no
  // directory to group it under and there are only ever a handful.
  return { label: path === "" ? GENERATED : path, firstParty: segments.length === 1 };
}

export type CompositionEntry = {
  readonly label: string;
  readonly firstParty: boolean;
  readonly bytes: number;
  /** Of the chunk total, 0..1. */
  readonly share: number;
};

export type Composition = {
  /** The chunk's own size on disk — the denominator every share uses. */
  readonly totalBytes: number;
  readonly attributedBytes: number;
  readonly unattributedBytes: number;
  readonly firstPartyBytes: number;
  readonly dependencyBytes: number;
  /** Buckets, heaviest first. */
  readonly buckets: readonly CompositionEntry[];
  /** Individual source files, heaviest first. */
  readonly modules: readonly CompositionEntry[];
};

function entriesFrom(
  bytes: ReadonlyMap<string, number>,
  totalBytes: number,
  bucketOf: (label: string) => ModuleBucket,
): readonly CompositionEntry[] {
  return [...bytes]
    .map(([label, size]) => ({
      label,
      firstParty: bucketOf(label).firstParty,
      bytes: size,
      share: totalBytes === 0 ? 0 : size / totalBytes,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label));
}

/**
 * Per-source bytes, grouped and totalled.
 *
 * The total is the map's own sum rather than the file's size on disk: they are
 * equal by construction (every byte of the chunk is charged to something) and
 * taking it from here means a share is always a share OF what was measured,
 * even when a caller hands in one chunk of two.
 */
export function summarizeComposition(
  perSource: ReadonlyMap<string, number>,
  repoRoot = "",
): Composition {
  const totalBytes = [...perSource.values()].reduce((sum, n) => sum + n, 0);
  const bucketOf = (label: string): ModuleBucket => moduleBucket(label, repoRoot);

  const byBucket = new Map<string, number>();
  let firstPartyBytes = 0;
  let dependencyBytes = 0;
  let unattributedBytes = 0;
  for (const [source, size] of perSource) {
    const bucket = bucketOf(source);
    byBucket.set(bucket.label, (byBucket.get(bucket.label) ?? 0) + size);
    if (source === UNATTRIBUTED) unattributedBytes += size;
    else if (bucket.firstParty) firstPartyBytes += size;
    else dependencyBytes += size;
  }

  return {
    totalBytes,
    attributedBytes: totalBytes - unattributedBytes,
    unattributedBytes,
    firstPartyBytes,
    dependencyBytes,
    buckets: entriesFrom(byBucket, totalBytes, bucketOf),
    modules: entriesFrom(perSource, totalBytes, bucketOf),
  };
}

/**
 * What a bucket weighed at some earlier build — the baseline a drift is
 * measured from.
 *
 * Bytes per bucket and nothing else: a snapshot of the per-MODULE numbers
 * would be a thousand rows that churn on every dependency bump, and the
 * question a raise asks is "what grew", which is a question about packages
 * and directories.
 */
export type CompositionBaseline = {
  /** ISO date the measurement was taken — a rate needs the date. */
  readonly takenOn: string;
  /** The whole bundle, in bytes, at that measurement. */
  readonly totalBytes: number;
  /** Bucket label → bytes. */
  readonly buckets: Readonly<Record<string, number>>;
};

/**
 * The smallest bucket a baseline records, in bytes.
 *
 * Below about a kibibyte the list is a long tail of one-file packages that
 * churn on every dependency bump — thirty rows that say nothing, in a file
 * somebody has to re-take by hand. So a baseline stops here, and
 * {@link compositionDelta} ignores the same tail on both sides: without that,
 * every omitted bucket would read as `(new)` on the next run, which is the
 * first thing this reported and the fastest way to make a drift report
 * worthless.
 *
 * The tail is still inside the baseline's `totalBytes`, so the drift's total
 * line stays honest and the unlisted moves show up as the gap between it and
 * the sum of the rows.
 */
export const BASELINE_BUCKET_FLOOR_BYTES = 1024;

export type CompositionDelta = {
  readonly label: string;
  /** Bytes now, 0 for a bucket that has left the bundle. */
  readonly bytes: number;
  /** Bytes then, 0 for a bucket that is new. */
  readonly baselineBytes: number;
  readonly deltaBytes: number;
};

/**
 * Every bucket that moved between `baseline` and `composition`, biggest move
 * first.
 *
 * Both directions, and arrivals and departures too: a bucket that is new is a
 * dependency somebody added, and one that is gone is the only evidence a
 * removal ever worked. Reporting growth alone would make the one round that
 * gave bytes back invisible, which is the failure the copy-drift line already
 * had to fix once.
 *
 * Unmoved buckets are left out — on an ordinary build that is nearly all of
 * them, and a list of two hundred zeroes hides the four rows worth reading.
 */
export function compositionDelta(
  composition: Composition,
  baseline: CompositionBaseline,
  floorBytes: number = BASELINE_BUCKET_FLOOR_BYTES,
): readonly CompositionDelta[] {
  const now = new Map(composition.buckets.map((entry) => [entry.label, entry.bytes]));
  const labels = new Set([...now.keys(), ...Object.keys(baseline.buckets)]);
  const deltas: CompositionDelta[] = [];
  for (const label of labels) {
    const bytes = now.get(label) ?? 0;
    const baselineBytes = baseline.buckets[label] ?? 0;
    if (bytes === baselineBytes) continue;
    // The tail the baseline does not record. A bucket under the floor on both
    // sides is absent from the baseline for a reason, and reporting it as an
    // arrival would fill the report with packages that have been there for
    // months.
    if (Math.max(bytes, baselineBytes) < floorBytes) continue;
    deltas.push({ label, bytes, baselineBytes, deltaBytes: bytes - baselineBytes });
  }
  return deltas.sort(
    (a, b) =>
      Math.abs(b.deltaBytes) - Math.abs(a.deltaBytes) || a.label.localeCompare(b.label),
  );
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function formatRow(entry: CompositionEntry): string {
  return `  ${formatKiB(entry.bytes).padStart(10)}  ${formatShare(entry.share).padStart(6)}  ${entry.label}`;
}

/**
 * The report a raise is argued from.
 *
 * Buckets first because that is the question ("what is in here?"), then the
 * heaviest individual modules because that is the follow-up ("which file?"),
 * then the caveat — a per-module number is exactly the shape somebody quotes
 * as a saving, and it is not one.
 */
export function formatCompositionReport(
  chunkLabel: string,
  composition: Composition,
  options: { readonly topBuckets?: number; readonly topModules?: number } = {},
): string {
  const topBuckets = options.topBuckets ?? 20;
  const topModules = options.topModules ?? 15;
  const lines = [
    `${chunkLabel} — ${formatKiB(composition.totalBytes)} across ${String(composition.modules.length)} sources`,
    `  ${formatKiB(composition.firstPartyBytes).padStart(10)}  ${formatShare(composition.totalBytes === 0 ? 0 : composition.firstPartyBytes / composition.totalBytes).padStart(6)}  this repository's own source`,
    `  ${formatKiB(composition.dependencyBytes).padStart(10)}  ${formatShare(composition.totalBytes === 0 ? 0 : composition.dependencyBytes / composition.totalBytes).padStart(6)}  installed packages and generated modules`,
    `  ${formatKiB(composition.unattributedBytes).padStart(10)}  ${formatShare(composition.totalBytes === 0 ? 0 : composition.unattributedBytes / composition.totalBytes).padStart(6)}  ${UNATTRIBUTED} — runtime preamble, wrappers, newlines`,
    "",
    `  by bucket (top ${String(topBuckets)}):`,
    ...composition.buckets.slice(0, topBuckets).map(formatRow),
    "",
    `  by module (top ${String(topModules)}):`,
    ...composition.modules.slice(0, topModules).map(formatRow),
    "",
    "  A bucket's bytes are what it contributed, not what removing it would return:",
    "  shared helpers, tree-shaken re-exports and code the minifier hoisted across",
    "  module boundaries all move bytes over this line.",
  ];
  return lines.join("\n");
}

/** Signed KiB, the spelling the drift lines in `check-bundle-size` use. */
function formatSignedKiB(bytes: number): string {
  const sign = bytes < 0 ? "-" : "+";
  return `${sign}${(Math.abs(bytes) / 1024).toFixed(1)} KiB`;
}

/**
 * "since 2026-09-13: +6.3 KiB, of which lib/ is +4.1" — what a budget raise
 * has wanted five times and never had.
 *
 * The budget's own report can say the bundle grew and by how much; only this
 * can say what grew. Rows are the buckets that MOVED, biggest first, so an
 * ordinary build prints three or four lines and a dependency bump prints the
 * one row that explains itself.
 *
 * Returns `null` when nothing moved at all, because a build identical to the
 * baseline has nothing to report and a heading over an empty list reads as a
 * measurement that failed.
 */
export function formatCompositionDriftReport(
  composition: Composition,
  baseline: CompositionBaseline,
  options: { readonly topRows?: number } = {},
): string | null {
  const deltas = compositionDelta(composition, baseline);
  if (deltas.length === 0) return null;
  const topRows = options.topRows ?? 12;
  const total = composition.totalBytes - baseline.totalBytes;
  const lines = [
    `since the ${baseline.takenOn} measurement: ${formatSignedKiB(total)} (${formatKiB(baseline.totalBytes)} → ${formatKiB(composition.totalBytes)})`,
    ...deltas.slice(0, topRows).map((delta) => {
      // An arrival and a departure are the two rows a reader most wants
      // named: one is a dependency somebody added, the other is the only
      // evidence a removal worked.
      const note =
        delta.baselineBytes === 0
          ? " (new)"
          : delta.bytes === 0
            ? " (gone)"
            : "";
      return `  ${formatSignedKiB(delta.deltaBytes).padStart(11)}  ${delta.label}${note}`;
    }),
  ];
  if (deltas.length > topRows) {
    const rest = deltas.slice(topRows).reduce((sum, d) => sum + d.deltaBytes, 0);
    lines.push(
      `  ${formatSignedKiB(rest).padStart(11)}  ${String(deltas.length - topRows)} smaller moves`,
    );
  }
  return lines.join("\n");
}
