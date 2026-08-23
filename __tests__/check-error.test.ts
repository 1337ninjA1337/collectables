import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHECK_ERROR_PREFIX, checkError } from "@/lib/check-error";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/**
 * The line every build-time guard refuses in, and the sweep that keeps it one
 * line.
 *
 * `<check-name>: ERROR — <prose>` was spelled out at nineteen sites in eleven
 * modules. The convention is load-bearing in two ways that no single copy shows:
 * the check name comes FIRST, so a log holding four guards' output can be read
 * by guard, and the em dash separates a machine-readable prefix from a sentence.
 * Nineteen copies is nineteen chances to write `ERROR: ` or drop the name, and
 * the result is not a broken build — it is a line that scrolls past looking
 * almost right.
 */

describe("checkError", () => {
  it("puts the check name first, then the separator, then the prose", () => {
    assert.equal(
      checkError("check-privacy-baseline-provenance", "the table is empty."),
      "check-privacy-baseline-provenance: ERROR — the table is empty.",
    );
  });

  it("is the em dash and not a hyphen, which is what a grep would miss", () => {
    // The two are indistinguishable at a glance and not to a `grep -F`. Pinned
    // by codepoint rather than by pasting the character into an assertion,
    // because pasting it is exactly how the wrong one arrives.
    assert.equal(CHECK_ERROR_PREFIX, `: ERROR — `);
    assert.ok(!CHECK_ERROR_PREFIX.includes("-"));
  });

  it("does not punctuate or capitalise for the caller", () => {
    // Callers pass a whole finding, and several of them look their phrasing up
    // in a table. A helper that appended a full stop would double it on most of
    // them and be wrong on the ones ending in a path.
    assert.equal(checkError("g", "lib/x.ts moved"), "g: ERROR — lib/x.ts moved");
  });
});

/**
 * A refusal line BUILT rather than mentioned.
 *
 * The first version of this sweep asked whether a module's source contains the
 * separator anywhere, which is the offence plus two things that are not: a
 * fixture that quotes a guard's output, and a module documenting the convention
 * itself. `lib/provenance-key-set.ts` misses being reported only because its
 * mention sits in a comment that `stripComments` removes — a mention inside a
 * real string would have read as a hand-built line.
 *
 * What a hand-built line actually looks like is the prefix with a NAME in front
 * of it, and there are two ways to write that: interpolate one
 * (`` `${checkName}: ERROR — …` ``, which is all nineteen of the sites this
 * replaced) or spell one (`"guard: ERROR — …"`). Both are matched; a bare
 * mention of the separator with no name before it is not.
 *
 * Exported to the cases below rather than inlined in the filter, because a
 * sweep's rule is worth testing against strings a walk over a healthy tree can
 * never produce.
 */
export function buildsARefusalByHand(source: string): boolean {
  // `${…}: ERROR — ` (interpolated name) or `<word>: ERROR — ` (spelled name).
  return /(\$\{[^}]*\}|[\w-]+)(?=: ERROR — )/.test(source);
}

describe("the sweep's own rule", () => {
  it("reports a line built from an interpolated check name", () => {
    assert.ok(buildsARefusalByHand("return `${checkName}: ERROR — nope`;"));
  });

  it("reports a line built from a spelled check name", () => {
    assert.ok(buildsARefusalByHand('throw new Error("my-guard: ERROR — nope");'));
  });

  it("tolerates a module that MENTIONS the convention without building one", () => {
    // The two shapes the first version of this sweep would have reported: a
    // module explaining the format, and a fixture holding a guard's output for
    // a case to assert against. Neither is a second copy of the formatter.
    assert.ok(!buildsARefusalByHand('const FORMAT = ": ERROR — ";'));
    assert.ok(!buildsARefusalByHand('expect(out).toContain(": ERROR — ");'));
  });
});

describe("the guards that print refusals", () => {
  /**
   * Every module that builds a refusal line by hand, found rather than listed.
   *
   * The population is the offence itself, so a module that stopped refusing
   * anything drops out on its own and a twelfth guard is covered without being
   * added to anything.
   */
  const OFFENDERS = sourceFiles("lib", "scripts").filter((file) => {
    if (file === "lib/check-error.ts") return false;
    return buildsARefusalByHand(stripComments(readRepoFile(file)));
  });

  it("build the line through the helper, not by hand", () => {
    assert.deepEqual(
      OFFENDERS,
      [],
      `these modules spell the guard refusal prefix themselves instead of calling checkError: ${OFFENDERS.join(", ")}`,
    );
  });

  it("still refuse things, so the sweep above is not passing over silence", () => {
    // The positive control the sweep needs: it looks for a string's ABSENCE, and
    // a tree where nothing refuses anything would satisfy it perfectly. Eleven
    // modules called the helper on the run that introduced it; the floor is
    // argued at eight so ordinary consolidation does not have to be ratified,
    // and a collapse to nothing is caught.
    const callers = sourceFiles("lib", "scripts").filter(
      (file) =>
        file !== "lib/check-error.ts" &&
        stripComments(readRepoFile(file)).includes("checkError("),
    );
    assert.ok(
      callers.length >= 8,
      `only ${String(callers.length)} module(s) build a refusal through checkError — the sweep above is reading a tree that stopped refusing things: ${callers.join(", ")}`,
    );
  });

  it("keeps the helper a leaf, because every guard module would import it", () => {
    assert.ok(
      !/^\s*import\s/m.test(stripComments(readRepoFile("lib/check-error.ts"))),
      "lib/check-error.ts has grown an import — it is reached from eleven guard modules and a build script, and may depend on nothing",
    );
  });
});
