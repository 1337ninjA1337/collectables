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
 * interpret.
 *
 * The one thing that WAS ruled out of here and has since been ruled back in is
 * the tag-stack walk. This header used to say the a11y guard's own walk "stays
 * there — it is a rule about that guard's domain rather than a primitive",
 * which was right while there was one of them. There were two by 2026-09-13,
 * and they had the same bug: the JSX inside a render prop lives in the
 * PARENT'S OPEN TAG, so both walks stepped over everything a component renders
 * through a prop. Two copies, one bug, two fixes an hour apart. `walkJsx` at
 * the foot of this file is the walk; what stays with each caller is the only
 * part that differs — what a tag passes down to its descendants.
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
 *
 * A `'` or `"` literal ALSO ends at a line break, because one in JavaScript
 * cannot contain a raw newline. That is a fact about the language and it was
 * missing here, so an apostrophe consumed the rest of the file:
 *
 *     <Pressable
 *       style={styles.item}
 *       // the bar's own highlight says which tab you are on
 *       accessibilityRole="button"
 *     >
 *
 * `components/nav-tab.tsx`, verbatim. The apostrophe in "bar's" opened a
 * string that never closed, {@link openTagEnd} ran off the end and returned
 * -1, and {@link walkJsx} stops at a tag that does not close — so the walk
 * yielded NOTHING for the file, silently, and every rule over it reported a
 * clean tree. The `>` in a comment is the same class of hazard and the answer
 * to both is `stripComments`, which these scanners are documented to use; what
 * makes this one worth fixing in the primitive is that it does not need a `>`
 * or a tag to fire, it needs an apostrophe, and the failure is the whole file
 * rather than one tag.
 *
 * A template literal still spans lines, because it legally does. A line
 * continuation (`"a\` then a newline) still works, because the escape is
 * handled before the newline test.
 */
export function skipStringLiteral(source: string, i: number): number {
  const quote = source[i];
  const spansLines = quote === "`";
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === "\\") {
      j += 2;
      continue;
    }
    if (source[j] === quote) return j + 1;
    // An unterminated `'` or `"` ends at the line break, which is where the
    // language ends it. Returning the newline's own index rather than the one
    // after it keeps the caller's cursor on a character it has not consumed.
    if (!spansLines && source[j] === "\n") return j;
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
 * Every opening tag in `code`, for a caller that inherits nothing.
 *
 * `walkJsx(code, { seed: null, inherit: () => null })` was written in five
 * places within a day of the walk being extracted — four suites and
 * {@link openTagsNamed} below — which is a phrase, not a decision: none of
 * those callers has an ancestor question, they want the tags. The two that DO
 * inherit something (the a11y guard's "an ancestor hid this subtree", the
 * heading sweeps' "a `<Modal>` is above this node") still say so, and now the
 * difference between the two kinds of caller is visible at the call site
 * rather than buried in an argument that reads the same either way.
 *
 * Yields a plain {@link JsxTag}: the `inherited` field of a walk that inherits
 * nothing is a null every caller would have to ignore.
 */
export function* jsxTags(code: string): Generator<JsxTag> {
  for (const tag of walkJsx(code, { seed: null, inherit: () => null })) {
    const { inherited: _inherited, ...rest } = tag;
    yield rest;
  }
}

/**
 * Every opening tag of one element, with its offsets.
 *
 * The `[...jsxTags(code)].find((tag) => tag.name === "Profiler")` two suites
 * wrote on the same afternoon. Offsets rather than text because these callers
 * ask a question ABOUT the position — what follows this tag, where does its
 * element close — which {@link openTagsNamed} cannot answer.
 *
 * Self-closing tags are included: the caller asked for the tag, not for a
 * subtree, and a rule about a subtree has `selfClosing` to check.
 */
export function tagsNamed(code: string, name: string): JsxTag[] {
  const found: JsxTag[] = [];
  for (const tag of jsxTags(code)) {
    if (tag.name === name) found.push(tag);
  }
  return found;
}

/**
 * Every opening tag of one element, whole, `<` through `>`.
 *
 * The question three suites were asking with `match(/<HeroBanner[\s\S]*?>/g)`
 * before `lint:jsx-walk` refused it — "give me the `<HeroBanner>` in this file
 * so I can assert about its props" — which is the naive form this module's
 * header opens with: the wildcard stops at the first `>`, and the first `>` in
 * a tag of any interest is the one inside `onPress={() => close()}`.
 *
 * Goes through {@link walkJsx} rather than {@link openTagEnd} alone, so a tag
 * rendered through a render prop is found too.
 *
 * The text form of {@link tagsNamed}, and the one most callers want: a rule
 * that tests `attrs` is reading a string either way, and the slice is the
 * thing it would otherwise write out.
 */
export function openTagsNamed(code: string, name: string): string[] {
  return tagsNamed(code, name).map((tag) => code.slice(tag.start, tag.tagEnd + 1));
}

/** Where an element starts, where it closes, and what is between. */
export type JsxElementSpan = {
  /** Offset of the opening tag's `<`. */
  readonly start: number;
  /**
   * Offset just PAST the element's last character — exclusive, like every
   * other end offset a `slice` takes.
   *
   * It shipped for one day as "the offset of the close tag", and for a
   * self-closing tag as "the offset of its `>`", which are two different
   * meanings for one field: `code.slice(start, end)` returned the whole
   * element minus its close tag in the first case and the whole element minus
   * its final `>` in the second. Neither is wrong on its own and a caller
   * holding a mixed list gets both, which is how half a tag ends up in an
   * error message. One meaning now, and it is the one a slice wants.
   */
  readonly end: number;
  /** Everything between the opening tag's `>` and the close — `""` if none. */
  readonly body: string;
};

/**
 * The extent of the element an opening tag opens, or null if it never closes.
 *
 * `closeTagIndex(code, tag.tagEnd + 1, tag.name)` had been written out three
 * times within a day — the sheet-span reader and two suites asking what a
 * `<Profiler>` wraps — and every one of them wanted the same two things from
 * it: where the element ends, and what is inside. The `+ 1` is the part a
 * fourth copy gets wrong: `tagEnd` is the `>` itself, so starting the count
 * there would read the open tag as its own first character.
 *
 * `body` is what makes a window assertion falsifiable. Three suites checked
 * that something is NOT in an element and had no way to notice a window that
 * had silently shrunk to nothing — the negative holds either way — so the body
 * is handed back for them to assert something IS in it.
 *
 * A self-closing tag has no body and ends where its own tag ends: `""` and
 * `tagEnd + 1`, rather than null. It is a complete element, and a caller
 * asking what is inside `<HeroBanner />` should get "nothing", not
 * "unparseable".
 *
 * null means the close tag is missing, which these scanners meet whenever they
 * read a file mid-edit — the same forgiving answer {@link closeTagIndex}
 * gives, carried up so a caller cannot mistake -1 for an offset.
 */
export function elementSpan(code: string, tag: JsxTag): JsxElementSpan | null {
  if (tag.selfClosing) return { start: tag.start, end: tag.tagEnd + 1, body: "" };
  const closeAt = closeTagIndex(code, tag.tagEnd + 1, tag.name);
  if (closeAt === -1) return null;
  return {
    start: tag.start,
    end: closeAt + `</${tag.name}>`.length,
    body: code.slice(tag.tagEnd + 1, closeAt),
  };
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

/**
 * One opening tag, as a walk reports it.
 *
 * Offsets are into the string the walk was given, so `start` is what a line
 * number is computed from and `attrs` is the text every rule tests.
 */
export type JsxTag = {
  /** The element name — `Pressable`, `Ionicons`, `Modal`. */
  readonly name: string;
  /** Everything between the name and the closing `>`, `/` included. */
  readonly attrs: string;
  /** Offset of the `<`. */
  readonly start: number;
  /** Offset just past the name, where `attrs` begins. */
  readonly attrsAt: number;
  /** Offset of the closing `>`. */
  readonly tagEnd: number;
  /** Whether the tag closes itself and so opens no subtree. */
  readonly selfClosing: boolean;
};

/** A tag, plus whatever its ancestors passed down to it. */
export type WalkedJsxTag<T> = JsxTag & { readonly inherited: T };

/**
 * What descendants inherit, and where the outermost element starts from.
 *
 * The two callers inherit different things — the a11y guard tracks whether an
 * ancestor has hidden this subtree from screen readers, the heading sweeps
 * track whether a `<Modal>` is above this node — and that one difference is
 * the whole of what used to justify two copies of the walk.
 */
export type JsxWalk<T> = {
  readonly seed: T;
  readonly inherit: (tag: JsxTag, inherited: T) => T;
};

/**
 * Every opening tag in `code`, outermost first, with an inherited value.
 *
 * WHY THIS IS HERE NOW, against what the header of this module used to say.
 * It said the a11y guard's tag-stack walk "stays there — it is a rule about
 * that guard's domain rather than a primitive", and that was right while there
 * was one of them. There were two by this morning, written months apart, and
 * they had the same bug: a render prop's JSX lives INSIDE the parent's open
 * tag, `openTagEnd` correctly reports that tag as ending after the closing
 * brace, and both walks resumed there — so everything drawn through a prop
 * rather than through children was invisible to six lint rules and two sweeps.
 * Two copies, one bug, two fixes an hour apart is the argument this module was
 * written to make.
 *
 * The tag that CARRIES a render prop is yielded before the tags inside it, so
 * a rule about the parent is not lost to the recursion, and the inherited
 * value is passed down into the prop: a render prop's children are inside the
 * element that hides them.
 *
 * An unmatched close tag pops down to its name if the name is open and is
 * ignored otherwise — the forgiving choice, because these scanners read files
 * mid-edit and a stack that threw would turn a lint run into a crash.
 */
export function* walkJsx<T>(code: string, walk: JsxWalk<T>): Generator<WalkedJsxTag<T>> {
  yield* walkJsxRange(code, 0, code.length, walk.seed, walk);
}

function* walkJsxRange<T>(
  code: string,
  from: number,
  to: number,
  seed: T,
  walk: JsxWalk<T>,
): Generator<WalkedJsxTag<T>> {
  /** Open ancestors, innermost last. */
  const stack: { name: string; inherited: T }[] = [];
  let cursor = from;
  while (cursor < to) {
    const start = code.indexOf("<", cursor);
    if (start === -1 || start >= to) return;
    const closeMatch = /^<\/([A-Za-z][A-Za-z0-9_.]*)\s*>/.exec(code.slice(start));
    if (closeMatch) {
      const depth = stack.map((frame) => frame.name).lastIndexOf(closeMatch[1]);
      if (depth !== -1) stack.length = depth;
      cursor = start + closeMatch[0].length;
      continue;
    }
    // `<` followed by a letter is the whole tag test: a bare `<` in an
    // expression (`a < b`) is followed by a space in every formatting this
    // repository uses, and a fragment `<>` has no name.
    const nameMatch = /^<([A-Za-z][A-Za-z0-9_.]*)/.exec(code.slice(start));
    if (!nameMatch) {
      cursor = start + 1;
      continue;
    }
    const attrsAt = start + nameMatch[0].length;
    const tagEnd = openTagEnd(code, attrsAt);
    if (tagEnd === -1 || tagEnd > to) return;
    cursor = tagEnd + 1;
    const tag: JsxTag = {
      name: nameMatch[1],
      attrs: code.slice(attrsAt, tagEnd),
      start,
      attrsAt,
      tagEnd,
      selfClosing: code[tagEnd - 1] === "/",
    };
    const inherited = stack.length > 0 ? stack[stack.length - 1].inherited : seed;
    yield { ...tag, inherited };
    const passedDown = walk.inherit(tag, inherited);
    // A render prop carries JSX inside the open tag. `<` in the attribute text
    // is a cheap test that costs a fruitless walk of a string containing one.
    if (tag.attrs.includes("<")) {
      yield* walkJsxRange(code, attrsAt, tagEnd, passedDown, walk);
    }
    // A self-closing tag opens nothing, so it never becomes an ancestor.
    if (!tag.selfClosing) stack.push({ name: tag.name, inherited: passedDown });
  }
}
