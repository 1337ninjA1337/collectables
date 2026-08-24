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
 * NOTHING HERE IS CONCURRENT-SAFE, and the signature does not make it so. Node's
 * test runner interleaves async cases, so a callback that returns a promise
 * would have its logging captured up to its first `await` and then written
 * through a restored console — or, worse, through the NEXT case's capture. This
 * used to be documented as "which the signature enforces", and it was not:
 * `() => T` accepts an `async` arrow and `() => void` accepts one silently.
 * {@link captureConsole} refuses a thenable result instead, which is the check
 * the type cannot be.
 */

/** Every stream {@link captureConsole} watches, and what the callback returned. */
export type CapturedConsole<T = void> = {
  /** Whatever the callback returned, for a case that wants both. */
  readonly result: T;
  /** Everything written through `console.log`, in order. */
  readonly log: readonly string[];
  /** Everything written through `console.error`, in order. */
  readonly error: readonly string[];
  /** Everything written through `console.warn`, in order. */
  readonly warn: readonly string[];
  /** Everything written through `console.info`, in order. */
  readonly info: readonly string[];
  /** Everything written through `console.debug`, in order. */
  readonly debug: readonly string[];
};

/** The methods captured, so the swap and the restore cannot disagree. */
const CAPTURED = ["log", "error", "warn", "info", "debug"] as const;

type CapturedMethod = (typeof CAPTURED)[number];

function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
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
  const written: Record<CapturedMethod, string[]> = {
    log: [],
    error: [],
    warn: [],
    info: [],
    debug: [],
  };
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
  let result: T;
  try {
    result = run();
  } finally {
    for (const method of CAPTURED) console[method] = real[method];
  }
  if (isThenable(result)) {
    throw new Error(
      "captureConsole was given an async callback. The capture ends when the callback returns, so everything logged after its first await is written through a restored console — or through the next case's capture, since the runner interleaves. Await the work outside the callback, or swap the method by hand and restore it yourself.",
    );
  }
  return { result, ...written };
}
