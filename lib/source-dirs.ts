/**
 * Which top-level directories hold application source, said once.
 *
 * Every repo-wide scan here needs this list and, until now, every one of them
 * wrote its own: five guards under `scripts/` (spelled `SCANNED_DIRS`,
 * `SCAN_ROOTS` and `SCAN_DIRS` between them) and the suite-side walk in
 * `__tests__/helpers/source-files.ts`. They did not agree, and the
 * disagreements were invisible at the point where they mattered — the reader
 * of a green guard run cannot tell "no offenders" from "did not look there".
 *
 * The list is a fact about the repository, so it is pure and lives in `lib/`
 * beside `scanned-floor.ts` and `guard-root.ts`, where both the guard wrappers
 * and the suites can take it. `scripts/guard-io.ts` owns the WALK, because that
 * touches disk.
 *
 * A literal, not derived, and the reason is worth stating because it is the
 * first thing anybody tries: `tsconfig.json`'s `include` is every `.ts` and
 * `.tsx` in the tree, which says nothing about which directories are app code.
 * What replaces derivation is a check —
 * `__tests__/source-files-helper.test.ts` walks the repository root and fails
 * on a top-level directory of TypeScript in neither list, and on an entry here
 * that no longer holds any. So the list is a memory that gets audited rather
 * than a memory that gets trusted.
 */

/**
 * The directories a repo-wide rule about application code should reach.
 *
 * Alphabetical, so a new entry lands where it is looked for.
 *
 * A scan may narrow this — a rule about rendered markup has no business in
 * `scripts/`, and `check-clarity-input-mask` is right to walk only `app/` and
 * `components/`. What it may not do is narrow it by accident, which is why
 * `__tests__/guard-scan-dirs.test.ts` asserts every guard's list is a subset
 * of this one and carries a reason for what it leaves out.
 */
export const SOURCE_DIRS: readonly string[] = ["app", "components", "data", "lib", "scripts"];

/**
 * The suite tree, named once.
 *
 * It is the one non-app root a guard has any business walking — a rule about
 * PROSE reaches it, since the suites hold more doc comments than everything
 * else here put together — so the name is worth having beside
 * {@link SOURCE_DIRS} rather than being recovered from position 0 of the list
 * below. `__tests__/helpers/suite-files.ts` exports the same string as
 * `SUITES_REL` for the suites' own side of the split, which cannot import from
 * `lib/` guards' constants without inverting the dependency the two halves
 * were separated to keep.
 */
export const SUITES_DIR = "__tests__";

/**
 * Top-level directories that hold `.ts` and are deliberately NOT app source.
 *
 * `__tests__` is walked by `__tests__/helpers/suite-files.ts`, which knows
 * things about the suite tree (one level deep, `*.test.ts` versus every `.ts`)
 * that do not generalise. `supabase/functions` is Deno code, excluded from
 * `tsconfig.json` and from every scan here. `types` is ambient declarations
 * with no statements to scan.
 *
 * Listed rather than left implicit so the partition check is a statement about
 * the whole tree instead of about the half somebody remembered.
 */
export const NON_APP_TS_DIRS: readonly string[] = [SUITES_DIR, "supabase", "types"];

/**
 * The two extension sets a scan can want, named for what they mean.
 *
 * The guards had these inline as `/\.tsx?$/` and `.endsWith(".tsx")`, which
 * reads as a detail of the walk and is actually the rule's subject: a markup
 * rule that also walked `.ts` would report findings in files that render
 * nothing, and a code rule that walked only `.tsx` would miss every helper.
 */
export const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/** Markup only — the files that can render an element. */
export const MARKUP_EXTENSIONS: readonly string[] = [".tsx"];

/**
 * Every extension a file of module code can carry, whether or not a scan reads
 * it.
 *
 * The two sets above say what a scan LOOKS at; this says what there is to look
 * at, and the gap between them is the thing no set can state on its own. A
 * count floor measured over `.ts` and `.tsx` is a floor over the files that
 * carry those extensions today: the day a directory gains `.mts`, the walk
 * still returns a healthy number from the files it does match, the floor still
 * clears, and the guard silently stopped reading part of its own subject.
 * `checkWalkPremise` in `lib/floor-walks.ts` takes this as the universe to
 * subtract a walk's own list from, so an extension arriving in a scan root is
 * a decision — counted, or excused by name — rather than an absence.
 *
 * Wider than anything this repository holds on purpose. `.jsx`, `.cjs`,
 * `.mts` and `.cts` appear in no file here, and listing them is what makes the
 * first one to arrive land in a check instead of in nothing. Lower case, like
 * every set handed to {@link import("../scripts/guard-io").listFilesUnder} —
 * it folds case before testing membership.
 */
export const MODULE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

/**
 * Directory names no scan of source ever descends into, one reason each.
 *
 * The list shipped as three names under one sentence, which left the question
 * its next reader asks unanswered: only `node_modules` realistically turns up
 * UNDER a source directory, so does this mean "never inside source" (one
 * entry) or "never in any scan" (three)? It means the second, and the reason
 * is {@link import("../__tests__/helpers/source-files").assertSourceDirsCoverTheTree}
 * — that walk starts at the repository ROOT, where `dist/` is a minified copy
 * of every source file and `.expo/` is a per-checkout cache. Narrowed to
 * `node_modules`, it would walk the whole build output on every run and then
 * report `dist` as a top-level directory of TypeScript nobody had accounted
 * for.
 *
 * A reason per entry rather than one sentence for all three, because the three
 * are here for different reasons and a fourth would otherwise arrive with
 * none — which is how a skip list stops being reviewable.
 */
export const NEVER_WALKED_REASONS: Readonly<Record<string, string>> = {
  node_modules:
    "installed dependencies — the one name that realistically appears under a source directory, one stray `npm install` away, and the one that turns a 64-file scan into a several-thousand-file one",
  dist: "the exported web build: a minified copy of every source file, so a rule matched there is matched twice and reported against generated code",
  ".expo": "Expo's per-checkout cache, rewritten by every dev server run and in no commit",
};

/**
 * The same as a list, derived rather than restated.
 *
 * Two structures spelling one membership rule is the pair a later hand-edit
 * drifts — the lesson `lib/js-tokens.ts` already paid for with its keyword
 * `Set`. There is one authority here, so there is nothing to keep in step: an
 * entry added to {@link NEVER_WALKED_REASONS} is skipped by both walks, and an
 * entry cannot be added without saying why.
 *
 * The two walks — the guards' in `scripts/guard-io.ts` and the suites' in
 * `__tests__/helpers/source-files.ts` — take this rather than each carrying a
 * copy, which is what lets `guard-io-walk.test.ts` assert the two answer the
 * same over one tree: while each had its own list that case could only hold by
 * luck.
 */
export const NEVER_WALKED: readonly string[] = Object.keys(NEVER_WALKED_REASONS);

/**
 * Whether a directory found at the REPOSITORY ROOT is outside the source tree.
 *
 * Two mechanisms had grown for one question and only one of them had a name:
 * the root walk skipped {@link NEVER_WALKED} and, inline and unnamed, anything
 * whose name starts with a dot. So `.expo` was excluded twice, `.github` and
 * `.tasks` by a rule nothing pointed at, and a directory that stopped being
 * hidden would have moved between the two silently.
 *
 * They are not the same rule and both are kept, which is why this states them
 * together instead of merging the lists. {@link NEVER_WALKED} is about
 * generated and vendored trees WHEREVER they appear, so the source walks take
 * it at every level. The dot rule is about tooling directories at the root
 * (`.git`, `.github`, `.vscode`, `.tasks`) and deliberately does NOT apply
 * inside a source directory: a dot-named directory under `app/` is unusual
 * enough that a scan should report what is in it rather than skip it.
 */
export function outsideSourceTree(name: string): boolean {
  return name.startsWith(".") || NEVER_WALKED.includes(name);
}
