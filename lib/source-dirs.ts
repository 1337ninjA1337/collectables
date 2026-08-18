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
export const NON_APP_TS_DIRS: readonly string[] = ["__tests__", "supabase", "types"];

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
 * Directory names no scan of source ever descends into.
 *
 * None of these can appear under a source directory in a healthy checkout,
 * which is exactly why they are worth naming: a stray `npm install` inside
 * `components/` turns a 64-file scan into a several-thousand-file one, and the
 * guard then reports findings in vendored code. The two walks — the guards' in
 * `scripts/guard-io.ts` and the suites' in `__tests__/helpers/source-files.ts`
 * — took this list separately, which is the drift the shared module removes:
 * `guard-io-walk.test.ts` asserts the two answer the same over one tree, and
 * that case could only hold by luck while each had its own list.
 */
export const NEVER_WALKED: readonly string[] = ["node_modules", "dist", ".expo"];
