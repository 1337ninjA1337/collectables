import { annotation } from "./github-annotations";
import { stripComments } from "./strip-comments";

/**
 * The assignment `useLatestRef` exists to stop anybody writing again.
 *
 * WHAT IT REPLACED. `const xRef = useRef(x); xRef.current = x;` was in eight
 * files, eleven times, for three different reasons — a `PanResponder` built
 * once inside `useRef(...).current`, a callback whose identity changes every
 * render and must not restart a timer, and render state read by a handler that
 * outlives the render. One hook now does it, and one file
 * (`lib/reduced-motion.ts`) had already reached that conclusion on its own.
 *
 * WHY IT IS A RULE RATHER THAN A HEADER. The second line reads as bookkeeping
 * and sits below the declaration it belongs to, which is exactly the shape of
 * thing that gets copied without being read and omitted without being noticed.
 * When it IS omitted nothing crashes: the ref keeps the first render's value
 * and the component behaves correctly until that value changes — a language
 * switch, a second toast, a reorder, none of which the first render can see.
 * That is a bug that ships, and the twelfth copy is how it comes back.
 *
 * THE MATCH IS DELIBERATELY NARROW, and the narrowness is the whole design.
 *
 * The name on both sides must be the SAME identifier: `fooRef.current = foo`
 * is the idiom, `fooRef.current = null` is a reset, `timerRef.current =
 * setTimeout(...)` is a handle being stored, and `mountedRef.current = false`
 * is a lifecycle flag. All three of those are ordinary ref usage and none of
 * them is what this rule is about — `app/chat/[id].tsx` alone has six.
 *
 * It must be at the TOP LEVEL of a component or hook body, which here means
 * exactly two spaces of indentation. Four or more means it is inside an effect,
 * a handler or a branch, where an assignment is a statement somebody chose to
 * run rather than a per-render sync — `use-transition-event` writes its
 * `prevRef` from inside its effect, correctly, and a rule that caught that
 * would be arguing with the code.
 *
 * Indentation is a weak signal and it is the honest one available: deciding
 * "is this statement in the component body" properly means parsing the
 * function, and this repository has written down what it thinks of hand-rolled
 * parsers that are almost right. A two-space rule under-matches — a component
 * nested in another function is missed — and under-matching is the direction a
 * style rule should fail in.
 *
 * WHAT THIS RULE DOES NOT TRY TO SAY. The other half of `useLatestRef`'s
 * contract is that the ref must not be READ during render, which is a genuine
 * React violation rather than a style preference — and the hook makes it one
 * line shorter to write. Deciding whether a `.current` read is in render or in
 * a callback is a question about scope, not about text, and the shapes that
 * separate them (an arrow in a prop, a function declared and called later, a
 * `useMemo` body) are indistinguishable to a scan. So it is not attempted here.
 * A rule that caught nine of those ten would be worse than none, because the
 * tenth would be read as cleared.
 *
 * COMMENTS ARE BLANKED FIRST: this module's own header writes the offending
 * line out four times, and so does `lib/use-latest-ref.ts`.
 *
 * NO SUBJECT FLOOR, unlike `check-reduced-motion`, because this rule's
 * healthy state is zero findings and there is nothing in the tree for it to
 * count. What would otherwise go unnoticed — the pattern silently ceasing to
 * match, after a formatter change or a rename — is checked in
 * `__tests__/check-latest-ref.test.ts` against fixtures instead, which is the
 * only place a negative rule can demonstrate that it still recognises its
 * subject.
 */

/** The hook every one of these belongs in. */
export const LATEST_REF_OWNER = "@/lib/use-latest-ref";

/** One hand-written per-render ref sync. */
export interface LatestRefFinding {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** 1-indexed line number. */
  readonly line: number;
  /** The ref variable, e.g. `fireRef`. */
  readonly ref: string;
  /** The value it is being synced from, e.g. `fire`. */
  readonly value: string;
}

/**
 * `  fooRef.current = foo;` at exactly two spaces, with the same name either
 * side modulo the `Ref` suffix.
 *
 * The backreference is what makes the name match a rule rather than a
 * convention: `\1` is the bare name and the ref is `\1Ref`, so a file that
 * spells its ref `fooReference` is not matched — which is correct, because the
 * hook's value is that one shape is recognisable at a glance.
 */
const RENDER_BODY_SYNC = /^ {2}([A-Za-z_$][\w$]*)Ref\.current = \1;$/gm;

/** 1-indexed line of an offset. */
function lineOf(source: string, at: number): number {
  return source.slice(0, at).split("\n").length;
}

/** Every hand-written per-render ref sync in one file. */
export function findLatestRefSyncs(file: string, source: string): LatestRefFinding[] {
  const code = stripComments(source);
  const found: LatestRefFinding[] = [];
  for (const match of code.matchAll(RENDER_BODY_SYNC)) {
    found.push({
      file,
      line: lineOf(code, match.index),
      ref: `${match[1]}Ref`,
      value: match[1],
    });
  }
  return found;
}

/** Human-readable failure report; empty string when there is nothing to say. */
export function formatLatestRefReport(findings: readonly LatestRefFinding[]): string {
  if (findings.length === 0) return "";
  const lines = [
    `Found ${findings.length} hand-written per-render ref sync(s).`,
    `Use \`const x = useLatestRef(value)\` from ${LATEST_REF_OWNER} instead — the assignment is the line that gets forgotten, and when it is the ref silently keeps the first render's value.`,
  ];
  for (const f of findings) {
    lines.push(`  ${f.file}:${f.line}  const ${f.ref} = useLatestRef(${f.value});`);
  }
  return lines.join("\n");
}

/** The same findings as GitHub Actions annotations. */
export function latestRefAnnotations(findings: readonly LatestRefFinding[]): string[] {
  return findings.map((f) =>
    annotation(
      "error",
      `${f.ref} is synced by hand — use const ${f.ref} = useLatestRef(${f.value}) from ${LATEST_REF_OWNER}.`,
      { file: f.file, line: f.line, title: "Hand-written per-render ref sync" },
    ),
  );
}
