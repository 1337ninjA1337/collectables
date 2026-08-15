/**
 * One line describing whatever was thrown, for the messages that have to
 * render a caught value.
 *
 * `catch` binds anything at all, and this repository has two places that
 * interpolate that binding straight into a diagnosis: the guard fixture's
 * unreadable-link report (`__tests__/helpers/guard-fixture.ts`) and the
 * unreadable-input reason twelve guard wrappers report through
 * (`scripts/guard-io.ts`). Both had their own `String(error)`, and both failed
 * on the same two values — so the rendering lives here, once, beside the other
 * pure text helpers, and neither call site owns a copy of the edge cases.
 *
 * Pure: `node:util` and nothing else. No filesystem, no process state.
 */

import { inspect } from "node:util";

/**
 * How wide a thrown value may be rendered before the message carrying it stops
 * being readable.
 *
 * The value is arbitrary — a rejected promise from a patched module, a
 * validation object, a whole config tree are all things a caller can put in
 * this slot. The refusal it lands in is a paragraph the reader has to get
 * through, so the value gets one clause of it: enough to recognise what
 * arrived, not enough to bury the sentence explaining why it matters. Depth 1
 * keeps a nested object one level of shape rather than a dump;
 * `breakLength: Infinity` keeps the whole thing on the single line the caller
 * is interpolating it into.
 */
const THROWN_INSPECT: Parameters<typeof inspect>[1] = {
  depth: 1,
  breakLength: Infinity,
  maxArrayLength: 5,
  maxStringLength: 200,
};

/** Longest rendering of a thrown value a message will carry, before the ellipsis. */
export const THROWN_LIMIT = 200;

/**
 * One line describing `error`, whatever it turns out to be.
 *
 * `String(error)` is what this replaces, and it fails in both directions on
 * values `catch` really can bind. A plain object renders as `[object Object]`,
 * which tells the reader strictly less than the word "unknown" would — it
 * names the language's fallback, not the value. And an object with no
 * prototype (`Object.create(null)`, the shape a JSON-ish payload from a
 * patched module arrives in) has no `toString` at all, so `String(...)` throws
 * `TypeError: Cannot convert object to primitive value` — INSIDE the diagnosis
 * whose whole job is to explain a failure, replacing it with a different one.
 *
 * `util.inspect` has an answer for every value: `{ a: 1 }` for an object,
 * `[Object: null prototype] {}` for that one, `Symbol(x)`, `1n`, a quoted
 * string. The quotes are the point rather than noise — `'ENOENT'` and `ENOENT`
 * are a thrown string and an Error whose message was an errno, and those are
 * different bugs.
 *
 * Errors keep their first line: the rest is a stack, which belongs to the
 * process that threw and not to the sentence being written. `message` is
 * checked for being a string because `instanceof` says nothing about the shape
 * of the fields — a subclass assigning a non-string message would otherwise
 * take `.split` down with it, in the same catch block.
 */
export function describeThrown(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message.split("\n")[0];
  }
  const rendered = inspect(error, THROWN_INSPECT).split("\n")[0];
  return rendered.length > THROWN_LIMIT ? `${rendered.slice(0, THROWN_LIMIT)}…` : rendered;
}

/**
 * What the OS or the parser called it: the errno if there is one, otherwise
 * the value's own rendering.
 *
 * A `code` is preferred because it is the part a reader can act on and search
 * for — but only when it says something. An empty-string `code` used to be
 * returned as-is, which put a blank where the reason goes: "could not be read
 * ()" names a file and then declines to say what happened to it, and the
 * message it lands in exists for no other purpose. A blank code is no code.
 */
export function describeThrownReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code;
  return describeThrown(error);
}
