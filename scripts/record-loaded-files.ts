/**
 * A module-customization hook that prints every file node loads.
 *
 * `scripts/check-reporter-graph.ts` registers this, then imports the test
 * reporter, and reads the lines back: the result is the reporter's module
 * graph as node ACTUALLY resolved it, rather than as a regex over the source
 * guessed it. The guard needs both — the text walk names every broken import
 * at once where node's loader stops at the first, and this names the files the
 * text walk's shapes do not cover.
 *
 * THREE THINGS THIS FILE MUST NOT DO, each for its own reason:
 *
 *  - **Import anything.** A hook module is loaded on the loader thread before
 *    the graph it is watching, and anything it pulls in would be loaded too —
 *    appearing in its own measurement as a member of the graph it is supposed
 *    to be outside of. That is why `LOADED_FILE_MARKER` is spelled out here
 *    instead of imported from `lib/check-reporter-graph.ts`, with
 *    `check-reporter-graph.test.ts` asserting the two copies agree.
 *  - **Write to stdout.** stdout belongs to whatever the loaded modules print;
 *    stderr is where a tool's own bookkeeping goes, and the marker prefix is
 *    distinctive enough to be told apart from node's warnings on it.
 *  - **Change what loads.** `next` is called with exactly what arrived and its
 *    result returned untouched. A hook that transformed anything would make
 *    the guard's verdict about a graph nobody else ever runs.
 *
 * It is a `.ts` file rather than the `.mjs` a loader hook is usually written
 * as, and deliberately: `tsconfig.json`'s `include` covers every `.ts` in the
 * tree and nothing else, so this way the recorder is typechecked like the rest
 * of the repository instead of being the one untyped corner of the mechanism.
 * (The glob is not written out here: it ends in the two characters that close
 * a block comment, which silently turned this paragraph into code once.)
 * It is loaded by node's own loader, so it
 * lives by the same two rules as the graph it measures — no extensions to
 * infer (it imports nothing) and nothing here that strip-only mode cannot
 * erase.
 */

/** Must equal `LOADED_FILE_MARKER` in `lib/check-reporter-graph.ts`. */
const MARKER = "__reporter-graph-loaded__";

/** The half of node's loader contract this hook uses; not imported, see above. */
type LoadContext = Record<string, unknown>;
type NextLoad = (url: string, context: LoadContext) => Promise<unknown>;

export async function load(
  url: string,
  context: LoadContext,
  next: NextLoad,
): Promise<unknown> {
  // `file:` only. node loads its own internals through `node:` and the
  // entry point of a `-e` run is a `data:` URL; neither is a repo file and
  // neither is under the rules the guard enforces.
  if (url.startsWith("file:")) {
    process.stderr.write(`${MARKER} ${decodeURIComponent(url.slice("file://".length))}\n`);
  }
  return next(url, context);
}
