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
 * SWAPPING GLOBALS IS THE COST. `console.log` and `console.error` are replaced
 * for the duration and restored in a `finally`, so a throwing callback cannot
 * leave the runner without a console — the failure mode that makes this kind of
 * helper worse than the gap it closes. Nothing here is concurrent-safe: node's
 * test runner interleaves async cases, so callbacks passed in must be
 * synchronous, which the signature enforces.
 */

export type CapturedConsole = {
  /** Everything written through `console.log`, in order. */
  readonly log: readonly string[];
  /** Everything written through `console.error`, in order. */
  readonly error: readonly string[];
};

/**
 * `captureConsole(() => printProvenanceOutput(output))` — no console passed, so
 * the default is the thing under test.
 *
 * Arguments are joined the way the console joins them, so a caller that spreads
 * several values into one call reads back as one line.
 */
export function captureConsole(run: () => void): CapturedConsole {
  const log: string[] = [];
  const error: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...args: unknown[]) => {
    log.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    error.push(args.map(String).join(" "));
  };
  try {
    run();
  } finally {
    console.log = realLog;
    console.error = realError;
  }
  return { log, error };
}
