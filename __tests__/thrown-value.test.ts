/**
 * The renderer under every message that has to print a caught value.
 *
 * Two call sites interpolate a `catch` binding straight into a diagnosis: the
 * guard fixture's unreadable-link report and the unreadable-input reason
 * twelve guard wrappers hand to `assertParsedInputs`. Each used to own a
 * `String(error)`, and each carried the same two defects — an object rendered
 * as the fallback every object shares, and an object with no prototype
 * throwing a TypeError inside the catch that was reporting something else.
 *
 * `describeThrown` is a pure function of one argument, so its cases are a
 * table: the values `catch` can actually bind, which is all of them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeThrown, describeThrownReason, THROWN_LIMIT } from "../lib/thrown-value";

describe("describeThrown", () => {
  it("keeps an error's first line and drops its stack", () => {
    // The stack belongs to the process that threw, not to the one sentence
    // being written about it.
    assert.equal(
      describeThrown(new Error("realpath went sideways\n    at frame")),
      "realpath went sideways",
    );
  });

  it("survives an error whose message is not a string", () => {
    // `instanceof` says nothing about the shape of the fields, and `.split` on
    // a non-string throws inside the catch block that was handling a throw.
    const detail = describeThrown(Object.assign(new Error("boom"), { message: 42 }));
    assert.ok(detail.includes("42"), `the rendering loses the message it was handed: ${detail}`);
  });

  it("describes a thrown object, rather than naming the language's fallback", () => {
    // `[object Object]` tells the reader strictly less than the word "unknown"
    // would: every object without a `toString` renders as it, so it says a
    // throw happened and nothing at all about what threw.
    const detail = describeThrown({ errno: -13, syscall: "realpath" });
    assert.doesNotMatch(
      detail,
      /\[object Object\]/,
      `a thrown object renders as the fallback every object shares: ${detail}`,
    );
    assert.ok(
      detail.includes("realpath"),
      `the rendering drops the fields that say what was thrown: ${detail}`,
    );
  });

  it("survives a value with no prototype, which `String` cannot convert", () => {
    // `String(Object.create(null))` is a TypeError — raised inside the
    // diagnosis whose whole job is to explain a different failure, and
    // replacing it. The shape is not exotic: it is what a JSON-ish payload
    // from a patched module arrives as.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.reason = "denied";
    assert.throws(() => String(bare), TypeError, "the value this case exists for is convertible");
    const detail = describeThrown(bare);
    assert.ok(detail.includes("denied"), `the rendering drops the value's own fields: ${detail}`);
  });

  it("tells a thrown string apart from an error message", () => {
    // Two different bugs — a `throw "ENOENT"` and an `Error("ENOENT")` — and
    // the quotes are the only place the reader can see which one happened.
    assert.equal(describeThrown("ENOENT"), "'ENOENT'");
    assert.equal(describeThrown(new Error("ENOENT")), "ENOENT");
  });

  it("renders the values that are neither errors nor objects", () => {
    assert.equal(describeThrown(null), "null");
    assert.equal(describeThrown(undefined), "undefined");
    assert.equal(describeThrown(7), "7");
    assert.equal(describeThrown(false), "false");
  });

  it("keeps a large value from burying the sentence carrying it", () => {
    // The message is a paragraph the reader has to get through; a thrown
    // config tree would push the sentence explaining it off the screen.
    const detail = describeThrown({
      blob: "x".repeat(5_000),
      rows: Array.from({ length: 500 }, (_, index) => index),
    });
    assert.ok(
      detail.length <= THROWN_LIMIT + 1,
      `a thrown value renders ${detail.length} characters into one clause`,
    );
    assert.doesNotMatch(
      detail,
      /\n/,
      "the rendering spans lines, in a slot the caller interpolates into one",
    );
  });

  it("never spans lines, whatever it is handed", () => {
    // Every caller builds a single line around this, so a rendering that wraps
    // splits one message into two that read as unrelated.
    const values: unknown[] = [
      new Error("first\nsecond"),
      "a\nb",
      { note: "a\nb" },
      { deep: { nested: { further: 1 } } },
      Array.from({ length: 50 }, (_, index) => `entry-${index}`),
    ];
    for (const value of values) {
      assert.doesNotMatch(describeThrown(value), /\n/, `${describeThrown(value)} spans lines`);
    }
  });
});

describe("describeThrownReason", () => {
  it("prefers the errno, which is the part a reader can act on", () => {
    assert.equal(describeThrownReason(Object.assign(new Error("boom"), { code: "ENOENT" })), "ENOENT");
  });

  it("does not report a blank code as the whole reason", () => {
    // `code: ""` used to be returned as-is, which put a blank where the reason
    // goes: "could not be read ()" names a file and then declines to say what
    // happened to it, in a message that exists for no other purpose.
    const reason = describeThrownReason(Object.assign(new Error("permission denied"), { code: "" }));
    assert.equal(reason, "permission denied");
  });

  it("falls back to the value's own rendering when there is no code", () => {
    assert.equal(describeThrownReason(new Error("invalid JSON at position 4")), "invalid JSON at position 4");
    assert.equal(describeThrownReason({ kind: "parser" }), "{ kind: 'parser' }");
  });

  it("ignores a non-string code rather than printing its shape", () => {
    // `errno` is a number and `code` is conventionally a string; an object or
    // a number in that field is not an errno and must not be rendered as one.
    assert.equal(describeThrownReason(Object.assign(new Error("boom"), { code: 13 })), "boom");
  });
});
