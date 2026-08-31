/**
 * The failing-case trailer `npm test` prints after the tap stream.
 *
 * ## Why a trailer rather than a different reporter
 *
 * A case failed once in CI and could not be named. `npm test` runs 7000-odd
 * cases through node's `tap` reporter, which prints `not ok 3 - <name>` at the
 * moment the case fails and never repeats it: the trailer at the end of a tap
 * stream is counts only (`# fail 1`). A green run is ~150 seconds of output, so
 * the one line naming the failure sits tens of thousands of lines above the end
 * — past any tail a log reader returns, and the run that produced it passed on
 * re-run, so the name was gone for good.
 *
 * Swapping tap for `spec` would name it and print a line per PASSING case too,
 * which makes the log longer for the same reason it was unreadable. So the tap
 * stream is kept exactly as it was — CI's output is unchanged byte for byte —
 * and a second reporter writes a failures-only list to the same stdout, after
 * it. Node supports several `--test-reporter`s at once, each with its own
 * destination; this one stays silent until the stream ends, so nothing
 * interleaves.
 *
 * ## Why the ancestry is reconstructed, and how it refuses to guess
 *
 * A `test:fail` event carries the case's own name and nothing about the
 * `describe`s around it, and leaf names in this repo are written to read under
 * their suite ("is idempotent", "is declared") — a name that identifies nothing
 * on its own. The ancestry is therefore rebuilt from the `test:start` events,
 * which carry a `nesting` depth: per file, the name at each depth is the last
 * one started there.
 *
 * That reconstruction is only sound while cases in a file run one at a time,
 * which is node's default and what every suite here does. Rather than depend
 * on that quietly, the collector CHECKS it: the failing case must be the one
 * the stack has at its own depth, and when it is not — a concurrent suite
 * interleaved its starts — the bare name is reported instead of an ancestry
 * that might belong to a different case. `file:line` is printed either way and
 * is the exact address; the ancestry is the part a person reads.
 */

/** The slice of node:test's reporter events this reads. */
export interface TestRunnerEvent {
  readonly type: string;
  readonly data?: {
    readonly name?: unknown;
    readonly file?: unknown;
    readonly line?: unknown;
    readonly nesting?: unknown;
    readonly details?: { readonly error?: unknown };
  };
}

/** One failing case, as the trailer reports it. */
export interface FailingCase {
  /** `outer › inner › the case`, or the bare name when the ancestry is unsound. */
  readonly name: string;
  /** Repo-relative where it can be made so, absolute otherwise. */
  readonly file: string;
  /** 1-based line of the failing assertion — see {@link lineFromStack}. */
  readonly line: number | undefined;
  /** First line of the assertion message, truncated. */
  readonly message: string;
}

/** Ancestry separator — the chevron this app's UI uses for the same job. */
const ANCESTRY = " › ";

/** Long enough for an assertion's first sentence, short enough to stay one line. */
const MESSAGE_LIMIT = 200;

/**
 * `subtestsFailed` is the aggregate a `describe` emits because something
 * INSIDE it failed. Reporting those would name every ancestor of every failure
 * as a failure of its own — three entries for one broken assertion, only one of
 * which has a line worth opening.
 */
const AGGREGATE_FAILURE = "subtestsFailed";

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** One property off an unknown, without pretending to know the shape. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * The failing line, read out of the error's own stack.
 *
 * The event's `line` field is the case's DECLARATION, taken from the runner's
 * view of the file — which under `tsx` is the esbuild output, so every case in
 * every suite here reports `2` (one long line, a five-digit column). The error
 * stack is source-mapped by tsx and points at the assertion that actually
 * failed, which is both correct and the more useful of the two. The event's
 * field is still the fallback: run under plain node, with no transform, it is
 * right and there is no stack frame in the test file for a timeout.
 */
export function lineFromStack(stack: unknown, file: string): number | undefined {
  if (typeof stack !== "string" || file === "") return undefined;
  const needle = `${file}:`;
  const at = stack.indexOf(needle);
  if (at < 0) return undefined;
  const digits = /^\d+/.exec(stack.slice(at + needle.length));
  if (digits === null) return undefined;
  const line = Number(digits[0]);
  return Number.isSafeInteger(line) && line > 0 ? line : undefined;
}

/** The assertion's first line, trimmed and bounded. */
export function failureMessage(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  const first = raw.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  if (first.length === 0) return "(no message)";
  return first.length > MESSAGE_LIMIT ? `${first.slice(0, MESSAGE_LIMIT)}…` : first;
}

/** `1 failing case` / `2 failing cases` — read by a person, not matched. */
function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export interface FailureCollector {
  /** Feed one reporter event. */
  observe: (event: TestRunnerEvent) => void;
  /** The failures seen so far, in the order they failed. */
  failures: () => readonly FailingCase[];
}

/**
 * Accumulates failing cases from a reporter event stream.
 *
 * `root` is the directory file paths are reported relative to; a path outside
 * it is reported absolute rather than as a pile of `../`.
 */
export function createFailureCollector(root: string = process.cwd()): FailureCollector {
  const found: FailingCase[] = [];
  /** Per FILE, because node runs files in parallel and their events interleave. */
  const openNames = new Map<string, string[]>();

  const relative = (file: string): string => {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    return file.startsWith(prefix) ? file.slice(prefix.length) : file;
  };

  const nameFor = (file: string, nesting: number, name: string): string => {
    const open = openNames.get(file);
    // The stack must agree that this is the case it last started at this depth.
    // When it does not, the events interleaved and the ancestors above are
    // some other case's — so report the name we were actually given.
    if (!open || open[nesting] !== name) return name;
    return [...open.slice(0, nesting), name].join(ANCESTRY);
  };

  return {
    observe(event) {
      const data = event.data ?? {};
      const file = stringOr(data.file, "");
      const name = stringOr(data.name, "(unnamed case)");
      const nesting = typeof data.nesting === "number" ? data.nesting : 0;

      if (event.type === "test:start") {
        const open = openNames.get(file) ?? [];
        open[nesting] = name;
        open.length = nesting + 1;
        openNames.set(file, open);
        return;
      }
      if (event.type !== "test:fail") return;

      const error = data.details?.error;
      if (field(error, "failureType") === AGGREGATE_FAILURE) return;

      // The event's error is node's ERR_TEST_FAILURE wrapper, and its stack
      // has no frames — the assertion that failed is in `cause`, whose stack
      // tsx has source-mapped. `failureType` is the wrapper's, though, so the
      // aggregate check above reads the wrapper and this reads through it.
      const reported = field(error, "cause") ?? error;
      const stackLine = lineFromStack(field(reported, "stack"), file);
      found.push({
        name: nameFor(file, nesting, name),
        file: file === "" ? "(unknown file)" : relative(file),
        line: stackLine ?? (typeof data.line === "number" ? data.line : undefined),
        message: failureMessage(reported),
      });
    },
    failures: () => found,
  };
}

/**
 * The block printed after the tap stream.
 *
 * Says something on a green run too: a trailer that is only ever visible when
 * something is broken is a trailer nobody can tell is still wired up, and this
 * one exists precisely because a signal that was assumed present was not.
 */
export function formatFailureTrailer(failures: readonly FailingCase[]): string {
  if (failures.length === 0) return "\ntest-failures: none.\n";
  const lines = [
    "",
    `test-failures: ${plural(failures.length, "failing case", "failing cases")} — named here because the tap stream above reports each one where it happened, thousands of lines from the end:`,
  ];
  failures.forEach((failure, index) => {
    const at = failure.line === undefined ? failure.file : `${failure.file}:${String(failure.line)}`;
    lines.push(`  ${String(index + 1)}) ${failure.name}`);
    lines.push(`     ${at}`);
    lines.push(`     ${failure.message}`);
  });
  return `${lines.join("\n")}\n`;
}

/**
 * The reporter itself: consumes the event stream, emits the trailer at the end.
 *
 * One parameter, deliberately. Node runs this through a stream `compose`,
 * which calls it as `fn(source, { signal })` — so a second parameter defaulting
 * to the repo root would silently receive an options object instead
 * (`root.endsWith is not a function`, thrown from inside the reporter, killing
 * the run it was added to explain). The root is read here; everything the
 * suites drive takes it as an argument.
 */
export async function* failureTrailerReporter(
  source: AsyncIterable<TestRunnerEvent>,
): AsyncGenerator<string> {
  const collector = createFailureCollector(process.cwd());
  for await (const event of source) collector.observe(event);
  yield formatFailureTrailer(collector.failures());
}

/**
 * A default export, in a module tree that otherwise has none, and this file
 * has no imports for the same reason.
 *
 * `--test-reporter=<path>` loads the module and calls its DEFAULT export, so
 * the name is node's to choose rather than ours. It loads it through node's
 * OWN loader too, not through tsx's — the reporter is resolved before the test
 * runner's child processes exist — which means node's type stripping is what
 * parses this file: extensionless TypeScript specifiers do not resolve there
 * (`ERR_MODULE_NOT_FOUND` on `../lib/test-failure-trailer`), and a thin
 * `scripts/` entry point importing this one is exactly the shape that fails.
 * Keeping the reporter and its logic in one import-free module is what makes
 * both loaders agree, and everything above stays a named export the suites
 * drive directly.
 */
export default failureTrailerReporter;
