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
 * What draws with a UI library outside the roots the JSX rules scan.
 *
 * `NON_MARKUP_REASONS` shipped on 2026-09-14 saying `lib/` holds "modules that
 * return values", which was FALSE: twelve files there render JSX. Eleven were
 * context providers whose entire markup is `<Ctx.Provider>{children}</…>` —
 * which is why nobody had noticed, and which no accessibility or design rule
 * has anything to say about. The twelfth, `lib/toast-context.tsx`, drew the
 * toast host: two `<View>`s, two `<Pressable>`s and three `<Text>`s that a
 * screen reader meets on every error this app reports, scanned by none of the
 * five rules that would have opinions about them. That overlay is
 * `components/toast-host.tsx` now, and this file is what keeps it there.
 *
 * A sentence in a constant said one thing and the tree said another for the
 * length of one commit, which is the argument for checking it.
 *
 * WHAT COUNTS AS DRAWING. An element the file imported from a LIBRARY —
 * `react-native`, `@expo/vector-icons` — in CODE, not in a comment, a string
 * or a regex literal, which is where the lint modules keep their fixtures and
 * their patterns, and not preceded by an identifier character, which would
 * make it a TypeScript generic (`useRef<TextInput>`).
 *
 * NOT "any capitalised element", which was the first version and flags a file
 * for rendering `<ToastHost />` — a component whose own file is scanned, and
 * which no rule has anything to say about as a tag. What the five rules are
 * about is primitives: `<Pressable>` and `<Ionicons>` for the a11y guard,
 * `<TextInput>` for the clarity guard, `<View>` for the empty-state wrappers,
 * `<Text>` for the heading sweeps. A file that only composes `@/components` is
 * covered by those components' own files.
 *
 * Deliberately a text rule rather than `walkJsx`: the question is whether a
 * file draws anything at all, and a walk that gave up on the first unreadable
 * tag would answer "no" for the wrong reason.
 */

/**
 * Element names a file imported from a UI library, as opposed to composed.
 *
 * Derived from the imports rather than from a list of primitive names, so a
 * library this repository has not used yet is covered the day it arrives — a
 * hardcoded list would have to be remembered, which is the failure mode every
 * other constant in `lib/source-dirs.ts` carries a check against.
 */
function libraryElements(src: string): Set<string> {
  const names = new Set<string>();
  for (const match of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    // `@/` is this repository and `.` is a sibling; anything else is a package.
    if (match[2].startsWith("@/") || match[2].startsWith(".")) continue;
    for (const part of match[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim() ?? "";
      if (/^[A-Z]/.test(name)) names.add(name);
    }
  }
  return names;
}

/** Every library element a source DRAWS, outside strings and comments. */
function renderedElements(file: string): string[] {
  const src = readSource(file);
  const library = libraryElements(src);
  const inCode = codeOffsets(src);
  const names: string[] = [];
  for (const match of src.matchAll(/<([A-Z][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)*/g)) {
    const at = match.index ?? 0;
    if (!inCode(at)) continue;
    // `Foo<Bar>` is a type argument; no JSX tag has an identifier character
    // before its `<`.
    if (/[\w$)\]]/.test(src[at - 1] ?? "")) continue;
    // `<Animated.View>` is `Animated`, imported from react-native; a
    // `<ToastContext.Provider>` is a local constant and is not.
    if (library.has(match[1])) names.push(match[1]);
  }
  return names;
}

/** The source files the JSX rules do NOT scan. */
const UNSCANNED = sourceFiles().filter(
  (file) => !MARKUP_DIRS.some((dir) => file.startsWith(`${dir}/`)),
);

describe("nothing draws markup outside the scanned roots without saying so", () => {
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

  it("finds library elements only in the files that admit to them", () => {
    const offenders = UNSCANNED.filter(
      (file) => !MARKUP_OUTSIDE_MARKUP_DIRS.includes(file) && renderedElements(file).length > 0,
    );
    assert.deepEqual(
      offenders,
      [],
      `these draw with a UI library outside ${MARKUP_DIRS.join(" + ")}, so the a11y, clarity, empty-state and heading rules never see them — move the markup into components/, or add the file to MARKUP_OUTSIDE_MARKUP_DIRS with a sentence saying why it cannot`,
    );
  });

  it("keeps the exception list honest — each entry still draws something", () => {
    // The direction a stale list fails silently in: a file excused from a rule
    // it no longer needs excusing from is an exemption that will excuse the
    // next thing to land in it.
    for (const file of MARKUP_OUTSIDE_MARKUP_DIRS) {
      assert.ok(
        renderedElements(file).length > 0,
        `${file} is listed as drawing outside the scanned roots and draws nothing — drop it`,
      );
    }
  });

  it("is empty, and that is an achievement rather than a default", () => {
    // It held `lib/toast-context.tsx` for one commit: the toast overlay, the
    // surface every error in this app lands on, scanned by none of the five
    // rules. The overlay is `components/toast-host.tsx` now; the queue and the
    // api stayed behind, which is what `lib/` is for.
    assert.deepEqual(MARKUP_OUTSIDE_MARKUP_DIRS, []);
  });

  it("still sees the primitives it is looking for, where they do live", () => {
    // The floor under an empty offender list: a reader that had stopped
    // recognising `<View>` would report a clean tree from here to forever.
    const drawn = new Set(
      MARKUP_DIRS.flatMap((dir) => sourceFiles(dir).flatMap((file) => renderedElements(file))),
    );
    for (const primitive of ["View", "Text", "Pressable", "Ionicons"]) {
      assert.ok(drawn.has(primitive), `the reader no longer recognises <${primitive}>`);
    }
  });

  it("sees the toast overlay now that it lives under the rules", () => {
    // The move, asserted from this side: the elements that were invisible are
    // in a file the five rules walk, and the file they left behind draws none.
    assert.deepEqual(renderedElements("lib/toast-context.tsx"), []);
    const host = new Set(renderedElements("components/toast-host.tsx"));
    for (const primitive of ["View", "Text", "Pressable", "Animated"]) {
      assert.ok(host.has(primitive), `components/toast-host.tsx no longer draws <${primitive}>`);
    }
  });

  it("does not count a tag that lives in a string or a comment", () => {
    // Half the lint modules here keep JSX fixtures in template literals and
    // element names in their doc comments; counting those would make every
    // guard in `lib/` an offender.
    assert.deepEqual(renderedElements("lib/check-jsx-walk.ts"), []);
    assert.deepEqual(renderedElements("lib/check-a11y-jsx.ts"), []);
    // And a context provider composes nothing from a library, so the twelve
    // that render `<Ctx.Provider>{children}</Ctx.Provider>` are not drawing.
    assert.deepEqual(renderedElements("lib/auth-context.tsx"), []);
  });
});
