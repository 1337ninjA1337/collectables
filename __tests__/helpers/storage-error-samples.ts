import { balancedInner } from "@/lib/balanced-source";
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
 * The literal signals `classifyStorageError` tests, read out of its body.
 *
 * Two shapes and no more, because those are the two the classifier uses: a
 * numeric `code === N` comparison, and a `haystack.includes("…")`. A third
 * shape (a regex, a `startsWith`) is invisible here and would be a signal with
 * no sample and nothing red — which is why {@link assertSamplesCoverClassifier}
 * also asserts the population is not smaller than the one that exists today.
 */
export function classifierSignals(): readonly string[] {
  const source = declaredSource(CLASSIFIER_REL);
  const start = source.indexOf("function classifyStorageError(");
  if (start < 0) return [];
  const body = balancedInner(source, source.indexOf("{", source.indexOf(")", start)), "{", "}");
  if (body === null) return [];
  const signals = new Set<string>();
  for (const [, code] of body.matchAll(/code === (\d+)/g)) signals.add(code);
  for (const [, text] of body.matchAll(/includes\("([^"]+)"\)/g)) signals.add(text);
  return [...signals];
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
