/**
 * Run a callback with the GLOBAL console captured, and hand back what it wrote.
 *
 * For one shape of gap, which this repository has two of. A function that logs
 * takes its console as a parameter defaulted to the global one — a seam so a
 * suite can be the console — and then every case passes a capturing object.
 * The parameter is exercised; the DEFAULT never is. Which means the overload
 * that runs in production is the one nobody calls: `= console` could be
 * `= console.error`-only, could name a method the type does not have, could be
 * dropped entirely and made required, and each case in the suite beside it goes
 * on passing.
 *
 * Neither of the two seams here can be closed by asserting a default's identity
 * from outside — a default parameter is not readable through the function
 * object, and a source-text regex for `= console` pins the spelling rather than
 * the behaviour. What DOES close it is calling the function with the argument
 * omitted and watching the global console, which is what this is.
 *
 * It is also, since the day two suites had written the same twelve-line
 * `withCapturedWarns` byte for byte, the one place a suite swaps a console
 * method at all. That is why every stream is captured rather than the two the
 * seams use: a helper that watches `log` and `error` sends anybody testing a
 * `console.warn` back to writing the swap by hand, which is where the two
 * copies came from.
 *
 * SWAPPING GLOBALS IS THE COST. Every captured method is replaced for the
 * duration and restored in a `finally`, so a throwing callback cannot leave the
 * runner without a console — the failure mode that makes this kind of helper
 * worse than the gap it closes.
 *
 * TWO SHAPES, BECAUSE ONE SHAPE LEFT FIVE SUITES OUT. {@link captureConsole}
 * owns the lifetime and is the one to reach for. {@link beginCapture} hands the
 * lifetime to the caller, for the three things a callback cannot hold: a swap
 * that spans `beforeEach`/`afterEach`, a body with an `await` in it (which the
 * thenable refusal exists to reject), and a case that only wants the stream
 * silenced. Those were five suites swapping a method by hand — a rule saying
 * "capture through the helper" would have been five exemptions out of seven,
 * which is a rule that says nothing.
 *
 * THE TRADE, STATED: `beginCapture` gives up the `finally`. Its `restore` is
 * the caller's to call, and a caller that forgets leaves the runner writing
 * into an array nobody reads. That cannot be made safe from here, so it is made
 * LOUD instead — captures do not nest, and the next `beginCapture` or
 * `captureConsole` refuses and names the leak rather than quietly stacking a
 * second swap on top of the first.
 *
 * NOTHING HERE IS CONCURRENT-SAFE, and the signature does not make it so. Node's
 * test runner interleaves async cases, so a callback that returns a promise
 * would have its logging captured up to its first `await` and then written
 * through a restored console — or, worse, through the NEXT case's capture. This
 * used to be documented as "which the signature enforces", and it was not:
 * `() => T` accepts an `async` arrow and `() => void` accepts one silently.
 * {@link captureConsole} refuses a thenable result instead, which is the check
 * the type cannot be.
 */

/**
 * The methods captured, so the swap and the restore cannot disagree — and, since
 * both result types are mapped over it, so that a sixth stream is ONE edit.
 *
 * It used to be one array and ten hand-written fields: five on
 * {@link CapturedConsole}, five on {@link OpenCapture}, each with a doc comment
 * saying "everything written through `console.<its own name>`, in order". Ten
 * restatements of one array, and the per-stream prose that was the argument for
 * writing them out said nothing the method name did not — so it is said once,
 * on {@link CapturedStreams}, and the two shapes are that type plus the one
 * field each actually adds.
 */
export const CAPTURED = ["log", "error", "warn", "info", "debug"] as const;

/**
 * Not exported, and neither is {@link CapturedStreams}.
 *
 * Both were, for a day, on the argument that a mapped type nobody can name is
 * awkward to assert against — and then nothing imported either of them. The
 * two shapes a caller actually holds ({@link CapturedConsole},
 * {@link OpenCapture}) are exported and name these in their own definitions,
 * so a suite that needs one back has a one-word edit rather than a design
 * question. `CAPTURED` stays exported because it has a reader: the seams suite
 * loops over it rather than writing the five names a sixth time.
 */
type CapturedMethod = (typeof CAPTURED)[number];

/**
 * Everything written through each captured stream, in order, keyed by the
 * method that wrote it.
 *
 * Arrays rather than one joined string: a case asserting "warned once" is
 * counting calls, and a caller that spread several values into one call is one
 * entry here (they are joined the way the console joins them).
 */
type CapturedStreams = {
  readonly [Method in CapturedMethod]: readonly string[];
};

/** Every stream {@link captureConsole} watches, and what the callback returned. */
export type CapturedConsole<T = void> = CapturedStreams & {
  /** Whatever the callback returned, for a case that wants both. */
  readonly result: T;
};

function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * The capture currently holding the console, or null.
 *
 * One global, because there is one global console. Its only job is to turn the
 * two ways of leaving a swap installed — a `restore()` nobody called, an
 * `afterEach` that did not run — into a refusal at the next capture instead of
 * silence for the rest of the file.
 */
let open: OpenCapture | null = null;

/** Swap every stream, collect into fresh arrays, and hand back the undo. */
function install(): {
  readonly written: Record<CapturedMethod, string[]>;
  readonly restore: () => void;
} {
  // Built from CAPTURED rather than written out, for the reason the types are
  // mapped over it: a stream present in one of the three places and missing from
  // another is a capture that swaps a method and drops what it collects.
  const written = Object.fromEntries(
    CAPTURED.map((method) => [method, [] as string[]]),
  ) as Record<CapturedMethod, string[]>;
  // The originals themselves, NOT `.bind(console)` copies: restoring has to put
  // the same function object back, or a case asserting the console was given
  // back compares a bound wrapper against what it saved and reads as a leak.
  const real = {} as Record<CapturedMethod, Console[CapturedMethod]>;
  for (const method of CAPTURED) {
    real[method] = console[method];
    console[method] = (...args: unknown[]) => {
      written[method].push(args.map(String).join(" "));
    };
  }
  let restored = false;
  return {
    written,
    // Idempotent, because the caller-owned form is used in an `afterEach` that
    // a `finally` in the case may already have reached.
    restore: () => {
      if (restored) return;
      restored = true;
      for (const method of CAPTURED) console[method] = real[method];
    },
  };
}

/** Refuse to stack a second swap on a console the first one has not given back. */
function claim(what: string): void {
  if (open === null) return;
  const held = open;
  // Give the console back before throwing, so the refusal is readable and the
  // rest of the file is not swallowed by the capture that was already leaking.
  held.restore();
  open = null;
  throw new Error(
    `${what} was called while a beginCapture() was still open, so the console was swapped twice and the first restore would have put the capture back rather than the real console. The capture that leaked has been closed; the usual causes are a restore() the case never reached and an afterEach that did not run.`,
  );
}

/**
 * A capture whose lifetime the CALLER owns, for the bodies a callback cannot
 * hold: an `await`, a `beforeEach`/`afterEach` pair, a stream that only needs
 * silencing.
 *
 * The arrays are live — a case may read `warn.length` while the capture is
 * still open — and stay readable after `restore()`, which is what lets an
 * assertion sit outside the `finally` that closed it.
 */
export type OpenCapture = CapturedStreams & {
  /** Puts the real console back. Idempotent, and safe to call twice. */
  restore: () => void;
};

/**
 * `const captured = beginCapture()` … `captured.restore()`.
 *
 * Put the `restore()` in a `finally` or an `afterEach` and read the streams
 * afterwards. Prefer {@link captureConsole} wherever the body fits in a
 * synchronous callback: it owns the `finally`, and this does not.
 */
export function beginCapture(): OpenCapture {
  claim("beginCapture()");
  const { written, restore } = install();
  const capture: OpenCapture = {
    ...written,
    restore: () => {
      restore();
      if (open === capture) open = null;
    },
  };
  open = capture;
  return capture;
}

/**
 * `captureConsole(() => printProvenanceOutput(output))` — no console passed, so
 * the default is the thing under test.
 *
 * Arguments are joined the way the console joins them, so a caller that spreads
 * several values into one call reads back as one line.
 *
 * The callback's return value comes back as `result`, for the shape both
 * `withCapturedWarns` copies had: run a function, read what it returned AND what
 * it printed. A THENABLE result throws — after the console is restored, so the
 * refusal itself is readable — because an async callback captures only up to its
 * first `await` and hands the rest of its logging to whatever case runs next.
 */
export function captureConsole<T>(run: () => T): CapturedConsole<T> {
  claim("captureConsole()");
  const { written, restore } = install();
  let result: T;
  try {
    result = run();
  } finally {
    restore();
  }
  if (isThenable(result)) {
    throw new Error(
      "captureConsole was given an async callback. The capture ends when the callback returns, so everything logged after its first await is written through a restored console — or through the next case's capture, since the runner interleaves. Await the work outside the callback, or swap the method by hand and restore it yourself.",
    );
  }
  return { result, ...written };
}
