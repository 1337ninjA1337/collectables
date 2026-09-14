import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MARKUP_DIRS,
  MARKUP_OUTSIDE_MARKUP_DIRS,
  NON_MARKUP_REASONS,
} from "@/lib/source-dirs";
import { codeOffsets } from "@/lib/strip-comments";

import { readSource, sourceFiles } from "./helpers/source-files";

/**
 * What renders markup outside the roots the JSX rules scan.
 *
 * `NON_MARKUP_REASONS` shipped on 2026-09-14 saying `lib/` holds "modules that
 * return values", which was FALSE: twelve files there render JSX. Eleven are
 * context providers whose entire markup is `<Ctx.Provider>{children}</…>` —
 * which is why nobody had noticed, and which no accessibility or design rule
 * has anything to say about. The twelfth, `lib/toast-context.tsx`, draws the
 * toast host: two `<View>`s, two `<Pressable>`s and three `<Text>`s that a
 * screen reader meets on every error this app reports, scanned by none of the
 * five rules that would have opinions about them.
 *
 * A sentence in a constant said one thing and the tree said another for the
 * length of one commit, which is the argument for this file: the claim is
 * checked now, and the exception is a named list rather than a clause.
 *
 * WHAT COUNTS AS RENDERING. A `<` followed by a capital, in CODE — not in a
 * comment, a string, or a regex literal, which is where the lint modules keep
 * their fixtures and their patterns — and not preceded by an identifier
 * character, which would make it a TypeScript generic (`useRef<TextInput>`).
 * Deliberately a text rule rather than `walkJsx`: the question is whether a
 * file declares any element at all, not what its tags are, and a walk that
 * gave up on the first unreadable tag would answer "no" for the wrong reason.
 */

/** A `<Ctx.Provider` and nothing else is not markup any rule cares about. */
const PROVIDER = /^<[A-Z][A-Za-z0-9_]*\.Provider$/;

/** Every element name a source declares, outside strings and comments. */
function renderedElements(file: string): string[] {
  const src = readSource(file);
  const inCode = codeOffsets(src);
  const names: string[] = [];
  for (const match of src.matchAll(/<[A-Z][A-Za-z0-9_.]*/g)) {
    const at = match.index ?? 0;
    if (!inCode(at)) continue;
    // `Foo<Bar>` is a type argument; no JSX tag has an identifier character
    // before its `<`.
    if (/[\w$)\]]/.test(src[at - 1] ?? "")) continue;
    names.push(match[0]);
  }
  return names;
}

/** The source files the JSX rules do NOT scan. */
const UNSCANNED = sourceFiles().filter(
  (file) => !MARKUP_DIRS.some((dir) => file.startsWith(`${dir}/`)),
);

describe("nothing renders markup outside the scanned roots without saying so", () => {
  it("walks the files the rules do not, so this is not an empty sweep", () => {
    assert.ok(UNSCANNED.length >= 200, `only ${UNSCANNED.length} unscanned files walked`);
    assert.deepEqual(
      Object.keys(NON_MARKUP_REASONS).filter(
        (dir) => !UNSCANNED.some((file) => file.startsWith(`${dir}/`)),
      ),
      [],
      "a directory excused from holding markup contributed no files to this sweep",
    );
  });

  it("finds real elements only in the files that admit to them", () => {
    const offenders = UNSCANNED.filter((file) => {
      if (MARKUP_OUTSIDE_MARKUP_DIRS.includes(file)) return false;
      return renderedElements(file).some((name) => !PROVIDER.test(name));
    });
    assert.deepEqual(
      offenders,
      [],
      `these render markup outside ${MARKUP_DIRS.join(" + ")}, so the a11y, clarity, empty-state and heading rules never see them — add the file to MARKUP_OUTSIDE_MARKUP_DIRS with a sentence, or move the component into components/`,
    );
  });

  it("keeps the exception list honest — each entry still renders something", () => {
    // The other direction, and the one a stale list fails silently: a file
    // excused from a rule it no longer needs excusing from is an exemption
    // that will excuse the next thing to land in it.
    for (const file of MARKUP_OUTSIDE_MARKUP_DIRS) {
      const elements = renderedElements(file).filter((name) => !PROVIDER.test(name));
      assert.ok(
        elements.length > 0,
        `${file} is listed as rendering markup outside the scanned roots and renders none — drop it from MARKUP_OUTSIDE_MARKUP_DIRS`,
      );
    }
  });

  it("counts the providers, since eleven of them are the reason nobody noticed", () => {
    // The sentence in `NON_MARKUP_REASONS` says "eleven context providers".
    // This is what makes that a number rather than a memory.
    const providerOnly = UNSCANNED.filter((file) => {
      const elements = renderedElements(file);
      return elements.length > 0 && elements.every((name) => PROVIDER.test(name));
    });
    assert.equal(
      providerOnly.length,
      11,
      `${providerOnly.length} provider-only files outside the scanned roots, not the eleven NON_MARKUP_REASONS claims — update the sentence with the new number`,
    );
  });

  it("does not count a tag that lives in a string or a comment", () => {
    // Half the lint modules here keep JSX fixtures in template literals and
    // element names in their doc comments; counting those would make every
    // guard in `lib/` an offender.
    assert.deepEqual(renderedElements("lib/check-jsx-walk.ts"), []);
    assert.deepEqual(renderedElements("lib/check-a11y-jsx.ts"), []);
  });
});
