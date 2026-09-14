/**
 * What a piece of code SCHEDULED, without waiting for it.
 *
 * Written inside `toast-host-render.test.ts` on 2026-09-14, for the toast's
 * dismissal window, and wanted immediately by everything else in this tree that
 * reasons about a timer. Today those suites do one of two things, and both are
 * worse than this:
 *
 *  - **They await real time.** `await new Promise((r) => setTimeout(r, 160))`
 *    is a real 160ms every run, and it is the kind of assertion that passes on
 *    a fast machine and flakes on a loaded one — the case is not "the timer
 *    fired", it is "the timer fired before my arbitrary margin ran out".
 *  - **They read the source.** `assert.match(src, /setTimeout\(commit, delay\)/)`
 *    is an assertion about spelling. It passes on a `setTimeout` whose callback
 *    is wrong, on one that is never cleared, and on one whose cleanup returns
 *    the wrong handle.
 *
 * ## Not a fake clock
 *
 * Nothing that wants this needs time to PASS. It needs to see what was
 * scheduled, at what delay, whether it was cleared, and what happens when it
 * runs — four questions a captured `setTimeout` answers exactly and a clock
 * answers by simulating a fifth thing nobody asked about. `mock.timers` from
 * `node:test` is the clock, and `announce-queue.test.ts` uses it where the
 * question really is "what does 150ms later look like".
 *
 * ## The restore is the part a copy would leave out
 *
 * These stubs are installed on `globalThis`. A suite that returned early, or
 * threw an assertion, and left them there would break every later file in the
 * same process — not with an error about timers, but with whatever the next
 * suite's own `setTimeout` was supposed to do. That failure reads as a bug in
 * an unrelated file, which is why {@link withCapturedTimers} exists and why
 * every caller should prefer it: the `finally` is inside the helper rather than
 * in each case that remembers to write one.
 */

/**
 * One timer that was scheduled while the capture was installed.
 *
 * `run()` fires the callback and retires the entry, because a real `setTimeout`
 * does not stay armed after it fires. An entry that kept reporting itself as
 * live after running would make "and nothing is left over" pass on a component
 * that re-armed and fail on one that did not.
 */
export type Scheduled = {
  /** The delay the caller asked for, in milliseconds. */
  readonly delay: number;
  /** Fire the callback now, once; the entry stops being live. */
  readonly run: () => void;
  /** Whether it was cleared, or has already run. */
  fired: boolean;
};

export type CapturedTimers = {
  /** Every timer scheduled since the capture went in, in schedule order. */
  readonly scheduled: readonly Scheduled[];
  /** The ones still standing — scheduled, not cleared, not yet run. */
  readonly live: () => Scheduled[];
  /** Their delays, which is what most cases actually assert on. */
  readonly liveDelays: () => number[];
  /** Put the real globals back. Idempotent. */
  readonly restore: () => void;
};

/**
 * Capture `setTimeout`/`clearTimeout` until the returned `restore` is called.
 *
 * Prefer {@link withCapturedTimers}; reach for this only where a case needs the
 * capture to outlive one function body, and then pair it with a `finally`.
 *
 * The handle is the entry's 1-based index rather than a `Timeout` object, so
 * `clearTimeout` can find what it is clearing. Code under test only ever passes
 * the handle back, so the shape is unobservable to it — which is why the cast
 * is safe and why a caller must not, say, call `.unref()` on it.
 */
export function captureTimers(): CapturedTimers {
  const scheduled: Scheduled[] = [];
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  let restored = false;

  globalThis.setTimeout = ((run: () => void, delay: number) => {
    const entry: Scheduled = {
      delay,
      fired: false,
      run: () => {
        entry.fired = true;
        run();
      },
    };
    scheduled.push(entry);
    return scheduled.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: number) => {
    const entry = scheduled[(handle as number) - 1];
    if (entry) entry.fired = true;
  }) as typeof clearTimeout;

  const live = () => scheduled.filter((entry) => !entry.fired);

  return {
    scheduled,
    live,
    liveDelays: () => live().map((entry) => entry.delay),
    restore: () => {
      if (restored) return;
      restored = true;
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
}

/**
 * Run one case with the timers captured, and put the globals back whatever
 * happens — including when an assertion inside it throws, which is the case
 * that matters and the one a hand-written `restore()` at the end of a body
 * silently skips.
 *
 * Awaiting inside the window is deliberate and is how the callers use it: a
 * component under test is often behind a dynamic `import()`, and module
 * resolution does not go through `globalThis.setTimeout`. Anything that DOES —
 * a real network call, a `setTimeout`-based sleep — must stay outside.
 */
export async function withCapturedTimers<T>(
  run: (timers: CapturedTimers) => T | Promise<T>,
): Promise<T> {
  const timers = captureTimers();
  try {
    return await run(timers);
  } finally {
    timers.restore();
  }
}
