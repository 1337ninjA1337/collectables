import {
  BARE_IDENTIFIER,
  declarations,
  firstArgumentSpanAt,
  scannableCode,
} from "./declaration-scan";
import { annotation } from "./github-annotations";

/**
 * `useChunkedList`'s one contract, which was prose in six places and checked
 * in none.
 *
 * WHAT THE HOOK PROMISES AND WHAT IT ASKS FOR. The window resets to page one
 * when the IDENTITY of `items` changes, because a filter that narrows 200 rows
 * to 3 must not leave the user looking at "show 200" worth of empty slots.
 * That reset is right, and it is the reason the hook asks callers for a stable
 * reference: a caller that rebuilds the array every render resets the window
 * every render, so `count` never grows and `loadMore()` does nothing.
 *
 * WHY IT IS A RULE RATHER THAN A HEADER. The failure is silent in the way that
 * outlives a review. Nothing throws, nothing logs, no state is corrupt — the
 * first page renders correctly and "Load more" is a button that responds to
 * the press and changes nothing on screen. It cannot be caught by the types
 * (`T[]` is `T[]` however it was built), it cannot be caught by the hook
 * (React hands it an array, not the expression that made one), and it cannot
 * be caught by a rendering test unless somebody thought to write the one that
 * presses Load more twice. The hook's header has said "callers MUST memoize"
 * since it was written; four of the five call sites then restated it in their
 * own words, which is what a contract looks like when nothing enforces it.
 *
 * WHAT COUNTS AS STABLE, and why the list is short. Three binding forms are
 * accepted, each because React itself guarantees the identity:
 *
 *   - `const x = useMemo(() => …, deps)` — the memo IS the guarantee, and the
 *     deps are the caller's statement of when a reset is wanted.
 *   - `const { x } = useSomething()` — a provider- or hook-held array. The
 *     provider memoizes it; `lib/collections-context.tsx` says so for
 *     `archivedItems` and `wishlistItems` by name.
 *   - `const [x] = useState(…)` — state, which changes identity only when
 *     something sets it.
 *
 * Everything else is a finding, including the two shapes that read as obvious
 * and are the whole subject: an inline expression (`useChunkedList(
 * items.filter(f), …)`) and a plain `const` bound to a fresh array
 * (`const rows = items.filter(f)` one line above the call). Both are one
 * keystroke from correct and neither announces itself.
 *
 * THE MATCH IS ON THE ARGUMENT, NOT ON THE HOOK BODY. A call is found by
 * scanning for `useChunkedList(` and reading its first argument with a
 * depth-aware scan rather than a regex — `items.filter((c) => c.role ===
 * "owner")` contains both a comma and a close paren before the argument ends,
 * and a pattern wildcarding to the first one of either reports the wrong text
 * (see `lint:jsx-walk` for what this tree thinks of that shape). The hook's
 * own declaration is skipped by name: `export function useChunkedList<T>(` is
 * a definition, not a call.
 *
 * AN IDENTIFIER THIS FILE DOES NOT BIND IS A FINDING, not a pass. A list
 * arriving as a prop or a destructured parameter may well be memoized by its
 * parent, and this rule cannot see that — but "cannot see" is the state the
 * rule exists to end, and the fix is one `useMemo` at the call site, which is
 * free when the reference was already stable. The report says which of the
 * three forms to reach for.
 *
 * COMMENTS AND STRING BODIES ARE BLANKED FIRST, and the second half of that
 * is not defensive tidiness — it is this rule's own findings. The registry
 * line in `lib/lint-guards.ts` describes the guard by writing
 * `useChunkedList(items)` inside a string, and the floor note in
 * `lib/scanned-floor.ts` writes the bare call the same way. Both were reported
 * on the first run. A rule about a call has to be able to tell a call from a
 * sentence about one, and this tree writes a lot of the latter.
 */

/** The hook whose `items` argument this rule is about. */
export const CHUNKED_LIST_HOOK = "useChunkedList";

/** How a first argument failed to prove itself stable. */
export type ChunkedItemsKind =
  /** The argument is an expression, so it is a fresh value every render. */
  | "inline-expression"
  /** A bare identifier bound in this file to something that is not one of the three stable forms. */
  | "unstable-binding"
  /** A bare identifier this file does not bind — a prop, a parameter, an import. */
  | "unresolved-binding";

/** One `useChunkedList` call whose `items` argument is not provably stable. */
export interface ChunkedItemsFinding {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** 1-indexed line of the call. */
  readonly line: number;
  /** The first argument as written, collapsed to one line. */
  readonly argument: string;
  readonly kind: ChunkedItemsKind;
  /** What was found instead of a stable form, for the report. */
  readonly detail: string;
}

/** A binding form React guarantees the identity of, or `null` for anything else. */
export type StableBindingForm = "useMemo" | "hook-result" | "useState";

/**
 * `use` + an uppercase letter, then an optional type argument, then the call —
 * a hook call, whose result React owns.
 *
 * The generic is not decoration: `useState<Item[]>([])` is how four of this
 * tree's list states are written, and a pattern going straight from the name to
 * `(` calls all of them unstable.
 */
const HOOK_CALL = /^(use[A-Z][\w$]*)\s*(?:<[^;()]*>)?\s*\(/;

/** The hook `rhs` calls, or `null` when it is not a hook call. */
function hookCalled(rhs: string): string | null {
  const match = HOOK_CALL.exec(rhs);
  return match ? match[1] : null;
}

/** 1-indexed line of an offset. */
function lineOf(source: string, at: number): number {
  return source.slice(0, at).split("\n").length;
}

/**
 * Which of the three stable forms binds `name` in this file, or `null` when
 * nothing here does — including when the binding exists and is a plain
 * expression, which is what {@link classifyItemsArgument} reports separately
 * from a name it never found at all.
 */
export function stableBindingFor(code: string, name: string): StableBindingForm | null {
  for (const declaration of declarations(code)) {
    if (!declaration.names.includes(name)) continue;
    const hook = hookCalled(declaration.rhs);
    if (hook === "useMemo") return "useMemo";
    if (hook === "useState") return "useState";
    if (hook) return "hook-result";
  }
  return null;
}

/** The head of whatever `name` IS bound to here, for the report's `detail`. */
function bindingHead(code: string, name: string): string | null {
  for (const declaration of declarations(code)) {
    if (declaration.names.includes(name)) return declaration.rhs;
  }
  return null;
}

/**
 * The verdict on one first argument: `null` when it is provably stable, a
 * `kind` plus a `detail` sentence when it is not.
 */
export function classifyItemsArgument(
  code: string,
  argument: string,
): { kind: ChunkedItemsKind; detail: string } | null {
  if (!BARE_IDENTIFIER.test(argument)) {
    return {
      kind: "inline-expression",
      detail: "an expression, so a new array on every render",
    };
  }
  if (stableBindingFor(code, argument)) return null;
  const head = bindingHead(code, argument);
  if (head === null) {
    return {
      kind: "unresolved-binding",
      detail: `\`${argument}\` is not bound in this file, so its identity cannot be read here`,
    };
  }
  return {
    kind: "unstable-binding",
    detail: `bound to \`${head}\`, which React does not hold stable`,
  };
}

/** Every `useChunkedList` CALL in one file, as `[line, firstArgument]`. */
export function chunkedListCalls(source: string): { line: number; argument: string }[] {
  const code = scannableCode(source);
  const calls: { line: number; argument: string }[] = [];
  const pattern = new RegExp(`\\b${CHUNKED_LIST_HOOK}\\s*(?:<[^<>()]*>)?\\s*\\(`, "g");
  for (const match of code.matchAll(pattern)) {
    const before = code.slice(0, match.index);
    if (/\bfunction\s*$/.test(before)) continue;
    const open = match.index + match[0].length - 1;
    const span = firstArgumentSpanAt(code, open);
    if (span === null) continue;
    calls.push({
      line: lineOf(code, match.index),
      argument: source.slice(span.start, span.end).trim().replace(/\s+/g, " "),
    });
  }
  return calls;
}

/** Every call in one file whose `items` argument is not provably stable. */
export function findChunkedItemsRisks(file: string, source: string): ChunkedItemsFinding[] {
  const code = scannableCode(source);
  const found: ChunkedItemsFinding[] = [];
  for (const call of chunkedListCalls(source)) {
    const verdict = classifyItemsArgument(code, call.argument);
    if (!verdict) continue;
    found.push({ file, line: call.line, argument: call.argument, ...verdict });
  }
  return found;
}

/** Human-readable failure report; empty string when there is nothing to say. */
export function formatChunkedItemsReport(findings: readonly ChunkedItemsFinding[]): string {
  if (findings.length === 0) return "";
  const lines = [
    `Found ${findings.length} ${CHUNKED_LIST_HOOK} call(s) whose \`items\` argument is not provably stable.`,
    `The window resets when the array's IDENTITY changes, so a reference rebuilt every render pins the list to page one and \`loadMore()\` does nothing — silently, with no error anywhere.`,
    `Pass a \`useMemo\` result, a provider-held array destructured from a \`use*()\` hook, or a \`useState\` value.`,
  ];
  for (const f of findings) {
    lines.push(`  ${f.file}:${f.line}  ${CHUNKED_LIST_HOOK}(${f.argument}, …) — ${f.detail}`);
  }
  return lines.join("\n");
}

/** The same findings as GitHub Actions annotations. */
export function chunkedItemsAnnotations(findings: readonly ChunkedItemsFinding[]): string[] {
  return findings.map((f) =>
    annotation("error", `${CHUNKED_LIST_HOOK}(${f.argument}, …) — ${f.detail}. Memoize it, or the window resets every render and Load more does nothing.`, {
      file: f.file,
      line: f.line,
      title: "Unstable useChunkedList items reference",
    }),
  );
}
