import assert from "node:assert/strict";

import { balancedInner, endOfString, QUOTES } from "@/lib/balanced-source";
import type { StorageFailureReason } from "@/lib/report-storage-failure";

import { declaredSource } from "./declared-shape";

/**
 * The inputs `classifyStorageError` is documented to read, in one place, DERIVED
 * from the classifier rather than copied beside it.
 *
 * ## The failure this closes
 *
 * Two suites each wrote their own list of eleven-ish errors —
 * `report-storage-failure.test.ts` and `storage-notice.test.ts` — and the lists
 * differed by a quota spelling nobody chose. Both were hand-made samples of the
 * classifier's input space with no edge back to the classifier, so a FIFTH
 * signal added to `classifyStorageError` got an input in neither list and both
 * suites stayed green over the branch nothing exercised. Three cases were built
 * on those samples ("agrees for every input the classifier reads", "picks the
 * sentence for the reason the report carries"), each stating a property over an
 * input space and each sampling a space that had moved on.
 *
 * ## Why the edge is a SOURCE read and not an import
 *
 * The samples cannot be exported from `lib/report-storage-failure.ts`: that
 * module ships, and a fixture table beside the classifier is bytes in every
 * user's bundle for a rule only the suites read. Nor can this helper import the
 * classifier for its value — `@/lib/report-storage-failure` reaches
 * `@/lib/sentry`, and a helper that evaluates it loads the real wrapper before
 * any suite's shim registers (see `helper-lib-imports.test.ts`). So the edge is
 * {@link classifierSignals}, which reads the signals out of the classifier's
 * own body; `assertSamplesCoverClassifier` is what makes an unsampled signal
 * red.
 *
 * `import type` above is erased, which is the exemption that rule states.
 */

/** The classifier module, by the repo-relative path both readers here use. */
const CLASSIFIER_REL = "lib/report-storage-failure.ts";

/**
 * One input per thing the classifier reads, labelled by the SIGNAL it carries.
 *
 * The label is not decoration: it is what {@link assertSamplesCoverClassifier}
 * matches against the classifier's source, so a sample renamed away from the
 * signal it covers stops counting for it. The last four are the values a
 * `catch` binds when nothing threw an `Error` at all — no signal to match, and
 * the shapes that made the classifier's `typeof error === "object"` guards
 * necessary in the first place.
 */
export const STORAGE_ERROR_SAMPLES: readonly {
  readonly signal: string;
  readonly error: unknown;
  readonly reason: StorageFailureReason;
}[] = [
  {
    signal: "quota",
    error: Object.assign(new Error("The quota has been exceeded."), {
      name: "QuotaExceededError",
    }),
    reason: "full",
  },
  {
    signal: "quota",
    // Firefox's name carries the word itself, so this is a `quota` hit through
    // the NAME half of the haystack while the message says nothing.
    error: Object.assign(new Error("persistent storage maximum size reached"), {
      name: "NS_ERROR_DOM_QUOTA_REACHED",
    }),
    reason: "full",
  },
  { signal: "22", error: Object.assign(new Error("persistence failed"), { code: 22 }), reason: "full" },
  {
    signal: "1014",
    error: Object.assign(new Error("something failed"), { code: 1014 }),
    reason: "full",
  },
  { signal: "no space left", error: new Error("Errno 28: No space left on device"), reason: "full" },
  // SQLite's own wording, which reaches the `disk is full` signal because it
  // contains it — the reason the separate longer clause was dead code.
  { signal: "disk is full", error: new Error("SQLITE_FULL: database or disk is full"), reason: "full" },
  {
    signal: "none — a blocked store",
    error: Object.assign(new Error("localStorage is not available"), { name: "SecurityError" }),
    reason: "unavailable",
  },
  { signal: "none — an error that says nothing", error: new Error("write failed"), reason: "unavailable" },
  { signal: "none — null", error: null, reason: "unavailable" },
  { signal: "none — undefined", error: undefined, reason: "unavailable" },
  { signal: "quota", error: "quota exceeded", reason: "full" },
  { signal: "22", error: { code: 22 }, reason: "full" },
];

/** Just the errors, for a case that only wants to sweep the space. */
export const STORAGE_ERROR_INPUTS: readonly unknown[] = STORAGE_ERROR_SAMPLES.map(
  (sample) => sample.error,
);

/**
 * The two kinds of signal the classifier tests, kept apart.
 *
 * Apart rather than in one list, because the two are compared differently and a
 * caller that flattens them has to tell them apart again: the substring rule
 * applies to `phrases` and is nonsense over `codes` (`"22"` occurs inside
 * `"1022"`, which means nothing). The first draft flattened and filtered with a
 * `/^\d+$/`, which is a second place that had to know a code renders as a bare
 * number.
 */
export type ClassifierSignals = {
  /** `code === N` — compared, never searched. */
  readonly codes: readonly string[];
  /** `haystack.includes("…")` — searched, so one may contain another. */
  readonly phrases: readonly string[];
};

/** Every signal in one list, for the coverage loop that does not care which. */
export function allSignals(signals: ClassifierSignals): readonly string[] {
  return [...signals.codes, ...signals.phrases];
}

/**
 * The declaration shapes {@link signalsInSource} follows, in the order it tries.
 *
 * `arrow` is not decoration: it decides where the body starts. A `function`
 * declaration's brace is the first one after the parameter list, past whatever
 * return-type annotation sits between; an arrow's is the first one after `=>`,
 * AND it has to be the very next thing there, because an expression-bodied
 * arrow has no body span at all and `indexOf("{")` would happily return a
 * neighbouring function's brace and read ITS signals as the classifier's.
 */
const DECLARATION_FORMS: readonly { readonly opener: string; readonly arrow: boolean }[] = [
  { opener: "function classifyStorageError(", arrow: false },
  { opener: "const classifyStorageError = (", arrow: true },
];

/**
 * The first `token` at bracket depth zero from `from`, or -1.
 *
 * Depth over `(`, `[` and `{`, string literals skipped with the same set
 * `balancedInner` uses. Angle brackets are NOT counted: `>` is the second
 * character of `=>`, so a counter that tracked them would go negative on the
 * very token this is usually looking for. That costs nothing here because a
 * generic argument cannot contain a top-level `=>` or `{` without also opening
 * one of the three brackets that ARE counted.
 *
 * Depth is what tells a return type apart from a body. `: (e: unknown) =>
 * StorageFailureReason => {` has two arrows, and the one that ends the
 * signature is the second — the first is inside the annotation's parens, at
 * depth 1, which is exactly the distinction an `indexOf` cannot make.
 */
function atDepthZero(source: string, from: number, token: string): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (QUOTES.has(char)) {
      i = endOfString(source, i) - 1;
      continue;
    }
    if (depth === 0 && source.startsWith(token, i)) return i;
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (depth < 0) return -1;
  }
  return -1;
}

/**
 * What may legally sit just before a `function` body's brace.
 *
 * `)` for a signature with no return type, and the last character of a type
 * name (`StorageFailureReason`, `Promise<Reason>`, `Reason[]`) for one with.
 * Anything else means the brace belongs to the ANNOTATION rather than to the
 * body — `: { reason: string }` is the shape that makes this necessary, and
 * `Promise<{ reason: string }>` the one that makes a `:` check insufficient.
 */
const BEFORE_A_BODY = /[)\w$>\]]/;

/**
 * The index of the body's opening brace, refusing anything it cannot place.
 *
 * `from` is just past the parameter list's `)`. Every refusal here is a case
 * where scanning on would produce a WRONG answer rather than none: the span it
 * would read belongs to a return-type annotation or to the next declaration
 * down the file, and its signals would be reported as this classifier's.
 */
function bodyBrace(source: string, from: number, form: (typeof DECLARATION_FORMS)[number]): number {
  let start = from;
  if (form.arrow) {
    const arrow = atDepthZero(source, from, "=>");
    assert.ok(
      arrow >= 0,
      "storage-error-samples: `const classifyStorageError = (…)` with no `=>` after the parameters — this is not an arrow function, and whatever it is this reader cannot follow it",
    );
    start = arrow + 2;
    assert.ok(
      source.slice(start).trimStart().startsWith("{"),
      "storage-error-samples: classifyStorageError is an expression-bodied arrow (`=> …` with no braces) — there is no body span to scan, and the next brace in the file belongs to something else entirely",
    );
  }
  const brace = atDepthZero(source, start, "{");
  assert.ok(
    brace >= 0,
    "storage-error-samples: classifyStorageError's signature is followed by no body at all",
  );
  const before = source.slice(start, brace).trimEnd().slice(-1);
  assert.ok(
    before === "" || BEFORE_A_BODY.test(before),
    `storage-error-samples: the first brace after classifyStorageError's signature follows "${before}", so it opens the RETURN TYPE and not the body — an annotation this reader cannot skip, and reading it would report the annotation's contents as the classifier's signals`,
  );
  return brace;
}

/**
 * The literal signals a classifier's source tests, read out of its body.
 *
 * Two shapes and no more, because those are the two the classifier uses: a
 * numeric `code === N` comparison, and a `haystack.includes("…")`. A third
 * shape (a regex, a `startsWith`) is invisible here and would be a signal with
 * no sample and nothing red — which is why the coverage case also asserts the
 * population is not smaller than {@link KNOWN_CLASSIFIER_SIGNALS}.
 *
 * Takes the SOURCE rather than reading the file, so the rules built on it can
 * be handed a planted classifier and shown to reject it. The dead-substring
 * pair this found in the real one was proven by editing `lib/` by hand and
 * putting it back — evidence that lived in a terminal, for a guard whose whole
 * value is that it fails on that input.
 *
 * REFUSES rather than returning nothing when it cannot find the declaration.
 * An empty result and a classifier with no signals are the same value, and the
 * reader is the layer that knows which one it is holding — the floor two layers
 * up would report an unreadable declaration as "the signal count dropped to 0",
 * which is true and about the wrong file. `parameterList` in
 * `declared-shape.ts` refuses an overload set out loud for the same reason.
 *
 * It follows BOTH declaration shapes. `const classifyStorageError = (error) =>
 * { … }` used to be a refusal, and refusing it made this helper a rule the
 * codebase never agreed to: nothing lints against the arrow form, so the first
 * contributor to write one would have got a red suite explaining a reader's
 * limitation rather than a problem with their code. What survives as a refusal
 * is the arrow with no braces at all — see {@link DECLARATION_FORMS}.
 */
export function signalsInSource(source: string): ClassifierSignals {
  const form = DECLARATION_FORMS.find((candidate) => source.includes(candidate.opener));
  assert.ok(
    form !== undefined,
    source.includes("classifyStorageError")
      ? "storage-error-samples: classifyStorageError is in this source but in neither shape this reader follows — `function classifyStorageError(` or `const classifyStorageError = (` — so a rewritten signature"
      : "storage-error-samples: no classifyStorageError declaration in this source — renamed, moved, or the wrong file",
  );
  const openParen = source.indexOf(form.opener) + form.opener.length - 1;
  const parameters = balancedInner(source, openParen, "(", ")");
  assert.ok(
    parameters !== null,
    "storage-error-samples: classifyStorageError's parameter list never closes — an unterminated string literal in the signature is the only way this happens",
  );
  const body = balancedInner(source, bodyBrace(source, openParen + parameters.length + 2, form), "{", "}");
  assert.ok(
    body !== null,
    "storage-error-samples: classifyStorageError's body never closes — an unterminated string literal is the only way this happens",
  );
  const codes = new Set<string>();
  const phrases = new Set<string>();
  for (const [, code] of body.matchAll(/code === (\d+)/g)) codes.add(code);
  for (const [, text] of body.matchAll(/includes\("([^"]+)"\)/g)) phrases.add(text);
  return { codes: [...codes], phrases: [...phrases] };
}

/** {@link signalsInSource} over the real classifier. */
export function classifierSignals(): ClassifierSignals {
  return signalsInSource(declaredSource(CLASSIFIER_REL));
}

/**
 * How many signals the classifier had when this was written.
 *
 * A floor rather than an exact count: a signal ADDED is the case this exists
 * for and is caught by the coverage loop; a signal REMOVED without its sample
 * would otherwise shrink the population silently and leave the loop passing
 * over less than it used to.
 */
export const KNOWN_CLASSIFIER_SIGNALS = 5;

/**
 * Classifiers that are not this repo's, for showing what the rules reject.
 *
 * A guard that only ever runs over source that satisfies it is green for two
 * indistinguishable reasons — the tree is clean, or the reader found nothing.
 * These are the needles: each is a `classifyStorageError` the reader must parse
 * and a rule must have an opinion about.
 *
 * Written as source strings rather than committed `.ts` fixtures because a real
 * file under `lib/` would be swept by every OTHER guard in this tree, and a
 * deliberately broken classifier is exactly what those are looking for.
 */
export const PLANTED_CLASSIFIERS: Readonly<Record<string, string>> = {
  /** The pair that was really there: the longer clause can never decide. */
  deadSubstring: `
export function classifyStorageError(error: unknown): StorageFailureReason {
  const haystack = String(error).toLowerCase();
  if (haystack.includes("disk is full") || haystack.includes("database or disk is full")) return "full";
  return "unavailable";
}`,
  /** A signal added with no sample — what the coverage loop is for. */
  unsampledSignal: `
export function classifyStorageError(error: unknown): StorageFailureReason {
  const haystack = String(error).toLowerCase();
  if (haystack.includes("storage is over capacity")) return "full";
  return "unavailable";
}`,
  /** Both kinds, so the reader is shown to separate them rather than flatten. */
  bothKinds: `
export function classifyStorageError(error: unknown): StorageFailureReason {
  const code = (error as { code?: unknown }).code;
  const haystack = String(error).toLowerCase();
  if (code === 22 || code === 1014) return "full";
  if (haystack.includes("quota")) return "full";
  return "unavailable";
}`,
  /** No such function: the reader must refuse rather than report zero signals. */
  renamedAway: `
export function classifyTheStore(error: unknown): StorageFailureReason {
  if (String(error).includes("quota")) return "full";
  return "unavailable";
}`,
  /**
   * A legal rewrite, and the reader follows it now.
   *
   * It was a refusal, and the nastier of the two absences while it was one: the
   * name IS here, so a reader that only asked "is the identifier present?"
   * would be satisfied while every signal in the body was invisible. Nothing in
   * this repo forbids the arrow form, so the reader learned it rather than the
   * codebase acquiring a rule it never agreed to.
   */
  arrowConst: `
export const classifyStorageError = (error: unknown): StorageFailureReason => {
  if (String(error).includes("quota")) return "full";
  return "unavailable";
};`,
  /**
   * The absence the arrow form introduces: an arrow with no body span at all.
   *
   * The trailing function is the point. A reader that took "the first `{` after
   * `=>`" would land in `elsewhere` and report `"neighbour"` as a signal
   * `classifyStorageError` tests — a wrong answer, which is worse than a
   * refusal, and the one shape where scanning forward for a brace can silently
   * cross into a different declaration.
   */
  conciseArrow: `
export const classifyStorageError = (error: unknown): StorageFailureReason =>
  String(error).includes("quota") ? "full" : "unavailable";

function elsewhere(value: unknown): void {
  if (String(value).includes("neighbour")) return;
}`,
  /**
   * A return type whose own arrow is not the one that ends the signature.
   *
   * READABLE: the annotation's `=>` sits inside its parens, at depth 1, so a
   * depth-aware scan walks past it to the real one. An `indexOf("=>")` stops at
   * the first, finds `StorageFailureReason` rather than `{` after it, and
   * refuses a perfectly ordinary declaration.
   */
  functionTypedReturn: `
export const classifyStorageError = (error: unknown): ((e: unknown) => StorageFailureReason) => {
  if (String(error).includes("quota")) return "full";
  return "unavailable";
};`,
  /**
   * An object-literal return type: the first brace is not the body.
   *
   * Reading it would report `reason` and `retryable` as the span this reader
   * scans — a wrong answer dressed as a successful parse, which is the failure
   * this whole helper is built to refuse rather than commit.
   */
  objectReturnType: `
export function classifyStorageError(error: unknown): { reason: StorageFailureReason } {
  if (String(error).includes("quota")) return { reason: "full" };
  return { reason: "unavailable" };
}`,
  /**
   * The same brace one level in, where a `:` check would not have seen it.
   *
   * `Promise<{ … }>` puts the annotation's brace after `<` rather than after
   * `:`, which is why the guard asks what a body's brace may FOLLOW instead of
   * looking for the one shape that went wrong first.
   */
  genericObjectReturnType: `
export function classifyStorageError(error: unknown): Promise<{ reason: string }> {
  if (String(error).includes("quota")) return Promise.resolve({ reason: "full" });
  return Promise.resolve({ reason: "unavailable" });
}`,
  /** A signature that never closes: the parameter list runs off the end. */
  unclosedParameters: `
export function classifyStorageError(error: unknown {
  if (String(error).includes("quota")) return "full";
}`,
  /** A body that never closes, which only an unterminated literal produces. */
  unclosedBody: `
export function classifyStorageError(error: unknown): StorageFailureReason {
  if (String(error).includes("quota")) return "full";`,
  /** A `const` binding that is not a function at all. */
  notAnArrow: `
export const classifyStorageError = (error: unknown) as StorageFailureReason;`,
};

/** The needles that must PARSE — everything but the two deliberate absences. */
export const READABLE_PLANTED_CLASSIFIERS = [
  "deadSubstring",
  "unsampledSignal",
  "bothKinds",
  "arrowConst",
  "functionTypedReturn",
];

/**
 * The needles the reader must REFUSE, and the word its message must carry.
 *
 * One entry per `assert` in the reader, which is the point: a branch whose
 * whole job is to fire on input nobody writes by hand is a branch nothing
 * exercises, and "nothing exercises it" is indistinguishable from "it works"
 * until the day it is the only thing standing between a rewrite and a silently
 * wrong answer.
 */
export const UNREADABLE_PLANTED_CLASSIFIERS: Readonly<Record<string, RegExp>> = {
  renamedAway: /no classifyStorageError declaration/,
  conciseArrow: /expression-bodied arrow/,
  objectReturnType: /opens the RETURN TYPE and not the body/,
  genericObjectReturnType: /opens the RETURN TYPE and not the body/,
  unclosedParameters: /parameter list never closes/,
  unclosedBody: /body never closes/,
  notAnArrow: /with no `=>` after the parameters/,
};
