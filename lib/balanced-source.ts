/**
 * One balanced, quote-aware reader of a bracketed span in JavaScript source.
 *
 * ## Why this is a module now
 *
 * Three private copies had accumulated — `balanced` in
 * `__tests__/helpers/declared-shape.ts`, `balancedBraces` in
 * `lib/check-empty-state-wrappers.ts`, `balancedParens` in
 * `__tests__/persist-effect-one-key.test.ts` — and the last of them wrote the
 * condition for stopping into its own doc block: "when a second rule needs the
 * same reader, that is the moment it earns a module". A fourth rule needed it,
 * which is the moment.
 *
 * The copies had already drifted, in the direction that costs something rather
 * than the direction that is merely untidy: `balancedBraces` is NOT quote-aware,
 * so a `"}"` inside a string literal decrements its depth and ends the object
 * early. Nothing in the style tables it reads contains one today, which is why
 * the copy has been correct so far and not why it is correct.
 *
 * ## What this is not
 *
 * Not a parser. It counts one bracket pair and skips string literals so a
 * quoted delimiter cannot move the counter. That is enough for every reader in
 * this tree and it is not enough in general:
 *
 *   - A REGEX LITERAL containing a delimiter (`/\)/`) is not skipped, because
 *     telling a regex from a division needs the preceding token. `lib/js-tokens.ts`
 *     answers exactly that question for the reader that needed it; nothing here
 *     does, and no rule in this tree reads a span containing one.
 *   - A TEMPLATE LITERAL's `${…}` is not descended into: {@link endOfString}
 *     stops at the first unescaped backtick, so a nested template or a quote
 *     inside an interpolation would end the literal early.
 *
 * Both gaps are inherited from the copies, unchanged and now stated once
 * instead of in two of the three places.
 *
 * ## Where it cannot answer, it answers null
 *
 * An unclosed bracket is null rather than "the rest of the file". Every caller
 * either skips that span or reports it; none of them may quietly treat a
 * truncated read as a complete one, because for a sweep asserting an ABSENCE
 * that is the silent direction — a span read short is a span whose offence was
 * not seen.
 */

/**
 * The three string-literal delimiters, none of which nest inside each other.
 *
 * Exported because a caller that walks a span character by character — the
 * parameter splitter in `declared-shape` does — has to skip literals with the
 * same set the balancer used, and two sets that disagree is the drift this
 * module exists to end.
 */
export const QUOTES: ReadonlySet<string> = new Set(['"', "'", "`"]);

/**
 * The index just past the string literal opening at `from`, escapes included.
 *
 * `from` must be the index of the opening quote. An unterminated literal
 * answers the end of the text, so a scan that consults this always advances.
 */
export function endOfString(text: string, from: number): number {
  const quote = text[from];
  for (let i = from + 1; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/**
 * The index of the bracket that closes the `open` at `from`, or null when it
 * never closes.
 *
 * `from` must be the index of the opening bracket; anything else is a caller
 * bug rather than a source one, so it throws instead of scanning from the
 * middle of a span and reporting a plausible wrong answer.
 */
export function balancedEnd(
  source: string,
  from: number,
  open: string,
  close: string,
): number | null {
  if (source[from] !== open) {
    throw new Error(
      `balancedEnd: index ${String(from)} is ${JSON.stringify(source[from] ?? "<end of source>")}, not the opening ${JSON.stringify(open)} — pass the index OF the bracket, not of what precedes it`,
    );
  }
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (QUOTES.has(char)) {
      i = endOfString(source, i) - 1;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

/**
 * The text BETWEEN the balanced pair opening at `from` — a call's argument
 * list, a type's members — with the brackets themselves excluded.
 */
export function balancedInner(
  source: string,
  from: number,
  open: string,
  close: string,
): string | null {
  const end = balancedEnd(source, from, open, close);
  return end === null ? null : source.slice(from + 1, end);
}

/**
 * The text THROUGH the balanced pair opening at `from`, brackets included.
 *
 * The other half of the same read, and a separate export rather than a flag:
 * `check-empty-state-wrappers` hands its result to a matcher that looks for
 * `backgroundColor:` inside an object body, and a boolean argument at that call
 * site would say nothing about which of the two it wanted.
 */
export function balancedThrough(
  source: string,
  from: number,
  open: string,
  close: string,
): string | null {
  const end = balancedEnd(source, from, open, close);
  return end === null ? null : source.slice(from, end + 1);
}
