/**
 * The scan two guards share, tested where it lives.
 *
 * `check-chunked-list-items` wrote all of this for itself and
 * `check-context-array-stability` then wanted the same three answers about a
 * different subject, so the walk moved here rather than being copied. These
 * cases moved with it: a scanner tested only through the first rule that used
 * it is a scanner the second rule cannot change safely.
 *
 * The cases are all about the two places a text scan goes wrong — a pattern
 * that stops at the first comma or close paren it sees, and a sentence inside a
 * string literal read as code. Both cost this tree a red run on the day the
 * first rule was written.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { declarations, firstArgumentAt, scannableCode } from "@/lib/declaration-scan";

describe("firstArgumentAt", () => {
  it("stops at the top-level comma", () => {
    assert.equal(firstArgumentAt("f(a, b)", 1), "a");
  });

  it("keeps a nested call, an arrow, an object and an array whole", () => {
    assert.equal(firstArgumentAt("f(g(a, b), c)", 1), "g(a, b)");
    assert.equal(firstArgumentAt("f(xs.map((x) => x.id), c)", 1), "xs.map((x) => x.id)");
    assert.equal(firstArgumentAt("f({ a: 1, b: 2 }, c)", 1), "{ a: 1, b: 2 }");
    assert.equal(firstArgumentAt("f([a, b], c)", 1), "[a, b]");
  });

  it("does not end on a comma inside a string", () => {
    assert.equal(firstArgumentAt('f(t("a, b"), c)', 1), 't("a, b")');
  });

  it("returns the only argument of a one-argument call", () => {
    assert.equal(firstArgumentAt("f(a)", 1), "a");
  });

  it("returns null for an unterminated call rather than guessing", () => {
    assert.equal(firstArgumentAt("f(a", 1), null);
  });
});

describe("scannableCode", () => {
  it("keeps line numbers and offsets after blanking a string", () => {
    const blanked = scannableCode('const a = "useChunkedList(x)";\nconst b = 2;');
    assert.equal(blanked.split("\n").length, 2);
    assert.equal(blanked.length, 'const a = "useChunkedList(x)";\nconst b = 2;'.length);
    assert.doesNotMatch(blanked, /useChunkedList/);
  });

});

describe("declarations", () => {
  it("finds a declaration that follows a wide destructure, which a fixed-width regex could not", () => {
    // The bug this walk replaced: a pattern ending in `([\s\S]{0,60})`
    // consumes sixty characters past the `=`, swallowing the `const {` after
    // it, and `matchAll` cannot return overlapping matches — so the second
    // declaration was never offered rather than mis-read.
    const code = scannableCode(
      [
        "  const { user, signOut, pending } = useAuth();",
        "  const {",
        "    collections,",
        "    subscribedCollections,",
        "  } = useCollections();",
      ].join("\n"),
    );
    const found = declarations(code);
    assert.ok(
      found.some((d) => d.names.includes("subscribedCollections") && d.rhs.startsWith("useCollections(")),
      "the second destructure is invisible",
    );
  });

  it("keeps a bare name and its initialiser head together", () => {
    const [only] = declarations(scannableCode("const rows = useMemo(() => xs.filter(f), [xs]);"));
    assert.deepEqual([...only.names], ["rows"]);
    assert.match(only.rhs, /^useMemo\(/);
  });

  it("reads a renamed destructured field by its LOCAL name", () => {
    const found = declarations(scannableCode("const { items: rows } = useCollections();"));
    assert.ok(found.some((d) => d.names.includes("rows")));
    assert.ok(!found.some((d) => d.names.includes("items")));
  });
});
