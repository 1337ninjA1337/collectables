import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readSource, tsxFiles } from "./helpers/source-files";

/**
 * A control that LOOKS active has to SAY it is active.
 *
 * The app's selected-state language is a style suffix: `styles.chipActive`,
 * `styles.templateCardActive`, `styles.filterButtonActive`. That is invisible
 * to a screen reader, which announces "Filters, button" whether the sheet is
 * open or not and reads a row of identical template buttons with no way to
 * tell which one is applied. `accessibilityState` is the fix and it is one
 * prop, so the failure mode is never difficulty — it is that a new chip is
 * added next to five that already have it and nobody looks.
 *
 * Hence a sweep rather than a per-file pin. It answers one question over the
 * whole tree: does every `<Pressable>` whose style names an `*Active` variant
 * also declare an `accessibilityState`? The state's CONTENT is the author's
 * call — `selected` for a chip, `expanded` for a button that opens a sheet,
 * `checked` for a toggle — and the sweep deliberately does not police it: a
 * rule that guessed would be wrong about a third of the cases and would train
 * people to write the wrong one to keep it quiet.
 *
 * ## Why the elements are parsed rather than regexed
 *
 * A JSX opening tag is full of `>` characters that do not end it — every arrow
 * function in an `onPress` has one. A `[\s\S]*?>` match stops at the first of
 * those, so it reads a fraction of the element and reports props that ARE
 * there as missing: the first draft of this sweep named seven files, four of
 * which already had the prop, below the arrow where the regex had given up.
 * {@link openingTags} tracks brace depth and string literals instead.
 *
 * The walk is `helpers/source-files.ts` — `app/` and `components/` because a
 * `<Pressable>` renders, and `lib/` holds one (`toast-context.tsx`), which the
 * `.tsx` filter picks up wherever it lives.
 */
const SCREENS = () => tsxFiles("app", "components", "lib");

/**
 * The opening tags of `<name …>` elements, each as its full source text.
 *
 * Walks from the tag name to the `>` that closes it at brace depth 0, skipping
 * over string literals so a `>` inside one cannot end the tag either.
 */
export function openingTags(source: string, name: string): { index: number; text: string }[] {
  const tags: { index: number; text: string }[] = [];
  const opener = new RegExp(`<${name}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 0;
    for (let i = match.index + match[0].length; i < source.length; i += 1) {
      const char = source[i];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === '"' || char === "'" || char === "`") {
        const quote = char;
        i += 1;
        while (i < source.length && source[i] !== quote) i += 1;
      } else if (char === ">" && depth === 0) {
        tags.push({ index: match.index, text: source.slice(match.index, i + 1) });
        break;
      }
    }
  }
  return tags;
}

const ACTIVE_STYLE = /styles\.\w*Active\b/;

function offenders(): string[] {
  const found: string[] = [];
  for (const file of SCREENS()) {
    const source = readSource(file);
    for (const tag of openingTags(source, "Pressable")) {
      if (!ACTIVE_STYLE.test(tag.text)) continue;
      if (tag.text.includes("accessibilityState")) continue;
      const line = source.slice(0, tag.index).split("\n").length;
      found.push(`${file}:${String(line)}`);
    }
  }
  return found;
}

describe("the JSX scanner this sweep depends on", () => {
  it("does not stop at the > of an arrow function", () => {
    // The bug that made the first draft of this sweep useless.
    const src = `<Pressable onPress={() => go()} accessibilityState={{ selected: true }} />`;
    const [tag] = openingTags(src, "Pressable");
    assert.ok(tag.text.includes("accessibilityState"), "the tag was cut off at the arrow");
  });

  it("does not stop at a > inside a string prop", () => {
    const src = `<Pressable accessibilityLabel="a > b" accessibilityState={{ selected: true }} />`;
    const [tag] = openingTags(src, "Pressable");
    assert.ok(tag.text.includes("accessibilityState"));
  });

  it("finds each element separately, and reads nested braces to the end", () => {
    const src = `<Pressable style={{ ...a, ...(on ? b : {}) }} accessibilityRole="button">x</Pressable>\n<Pressable />`;
    const tags = openingTags(src, "Pressable");
    assert.equal(tags.length, 2);
    assert.ok(tags[0].text.endsWith('accessibilityRole="button">'));
  });

  it("actually sweeps a non-trivial number of elements", () => {
    // A scanner that matched nothing would report zero offenders forever.
    const total = SCREENS().reduce(
      (count, file) => count + openingTags(readSource(file), "Pressable").length,
      0,
    );
    assert.ok(total > 100, `only ${String(total)} Pressables found — the walk is not reaching the tree`);
  });
});

describe("every active-styled control declares its state", () => {
  it("leaves no Pressable that looks selected and says nothing", () => {
    assert.deepEqual(
      offenders(),
      [],
      "these render an *Active style with no accessibilityState — add selected/expanded/checked as fits the control",
    );
  });
});
