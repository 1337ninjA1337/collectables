/**
 * Reading a JSX opening tag out of source text, said once.
 *
 * Several things in this repository match a shape in the app's `.tsx` files
 * without parsing them: the a11y guard, the sheet-semantics suite, and the
 * scratch sweeps that keep being written. Every one of them needs the same
 * two answers — where does this opening tag END, and what is the expression
 * inside `someProp={…}` — and every one of them had its own copy, because the
 * copies are eight lines each and look obvious.
 *
 * They are not obvious. The naive `/<Pressable([\s\S]*?)>/` ends the open tag
 * at the first `>` in the file, which in this codebase is usually the one
 * inside `onPress={() => x}`; on the a11y sweep it produced seven false
 * positives, every one a button that DID carry a label in attribute text the
 * regex never reached. So an open tag is walked with a brace counter, string
 * and template literals are skipped whole so a `">"` inside one cannot end
 * the tag, and a close tag is matched with a depth counter so a nested
 * `<Pressable>` does not end its parent.
 *
 * That reasoning was written down in `lib/check-a11y-jsx.ts` and nowhere else,
 * so the next copy — a suite comparing each sheet's `onRequestClose` against
 * its backdrop's `onPress` — reimplemented the brace counter and left out the
 * string skipping, which is exactly the half a reader does not miss until an
 * attribute contains a quoted `>`. One module means one answer to "where does
 * this tag end", and one place for the next person to read WHY it is not a
 * regex.
 *
 * What this is NOT: a parser. It understands text, not components. Callers ask
 * about a tag they have already located and get back text they still have to
 * interpret. The a11y guard's own tag-stack walk (which tracks ancestors, so
 * it knows when a node is inside a hidden subtree) stays there — it is a rule
 * about that guard's domain rather than a primitive.
 *
 * Offsets are into whatever string the caller passes. Pass source with
 * comments blanked by `stripComments` if a commented-out tag should not count;
 * that function preserves offsets, so a line number computed afterwards is
 * still the real one.
 */

/**
 * Index just past the closing quote of the string or template literal at `i`.
 *
 * Backslash escapes are honoured; an unterminated literal consumes the rest of
 * the source, which is the forgiving choice — these scanners read files
 * mid-edit and one that threw would turn a lint run into a crash.
 */
export function skipStringLiteral(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === "\\") {
      j += 2;
      continue;
    }
    if (source[j] === quote) return j + 1;
    j++;
  }
  return source.length;
}

/**
 * Walk from just after an opening tag name to the `>` that closes it.
 *
 * Returns the index of that `>`, or -1 if the tag never closes. Brace depth
 * matters because every interesting attribute in this codebase is an
 * expression containing at least one `>`; string and template literals are
 * skipped whole so a `">"` inside one cannot end the tag either.
 */
export function openTagEnd(source: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipStringLiteral(source, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
    i++;
  }
  return -1;
}

/**
 * Index of the `</tag>` matching an open tag that ended at `from`.
 *
 * Depth-counted: a row of buttons inside a pressable card is the ordinary case
 * here, and a scanner that took the first close tag would hand the parent's
 * body to the child and report the card as icon-only.
 */
export function closeTagIndex(source: string, from: number, tag: string): number {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let depth = 1;
  let i = from;
  while (i < source.length) {
    const nextOpen = source.indexOf(open, i);
    const nextClose = source.indexOf(close, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + open.length;
      continue;
    }
    depth--;
    if (depth === 0) return nextClose;
    i = nextClose + close.length;
  }
  return -1;
}

/**
 * The full opening tag that CARRIES the character at `at`, `<` through `>`.
 *
 * The inverse question to {@link openTagEnd}: a sweep that found an attribute
 * by matching it (`accessibilityRole="none"`) has an offset in the middle of a
 * tag and wants the whole tag to ask about its other props. Reads back to the
 * nearest `<` and forward through {@link openTagEnd}.
 *
 * Returns `""` when `at` is not inside a tag at all — no `<` before it, or a
 * tag that never closes. Callers treat an empty tag as "no attributes found",
 * which is the same answer they get for a tag that genuinely has none.
 */
export function openTagAt(source: string, at: number): string {
  const start = source.lastIndexOf("<", at);
  if (start === -1) return "";
  const end = openTagEnd(source, start);
  return end === -1 ? "" : source.slice(start, end + 1);
}

/**
 * The expression inside `name={…}` on one opening tag, or null if absent.
 *
 * Whitespace is flattened to single spaces so a prop the formatter wrapped
 * across three lines compares equal to the same handler written inline —
 * there is no prettier in this repo, so the same expression genuinely does
 * appear both ways.
 *
 * Brace-aware for the reason the whole module exists in reverse: reading to
 * the first `}` truncates `onPress={() => setOpen(false)}` at `setOpen(false`,
 * and an inline arrow is the common value here. String literals are skipped so
 * a brace inside one (`aria-label={"}"}`, a regex, a template) cannot close
 * the value early.
 *
 * Matches the attribute by name only where a name can start — after `<` or
 * whitespace — so asking for `label` does not match `accessibilityLabel`.
 * Only the braced form is read: `name="literal"` is a different question
 * (a string, not an expression) and a caller that conflated the two would be
 * comparing a value against an expression that produces it.
 */
export function attributeValue(tag: string, name: string): string | null {
  const at = new RegExp(`(?:^<[A-Za-z][A-Za-z0-9_.]*|\\s)${name}=\\{`).exec(tag);
  if (!at) return null;
  const open = at.index + at[0].length - 1;
  let depth = 0;
  let i = open;
  while (i < tag.length) {
    const c = tag[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipStringLiteral(tag, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return tag.slice(open + 1, i).replace(/\s+/g, " ").trim();
    }
    i++;
  }
  return null;
}
