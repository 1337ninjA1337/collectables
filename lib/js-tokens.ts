/**
 * Where a `/` starts a regular expression rather than a division.
 *
 * ECMA-262 tokenises with two goal symbols — `InputElementRegExp`, where a `/`
 * opens a `RegularExpressionLiteral`, and `InputElementDiv`, where it is the
 * division operator — and which one applies is decided by whether the grammar
 * is at the start of an expression. Any scanner reading JavaScript as text has
 * to answer that question or lose the rest of a line to a pattern it read as
 * structure.
 *
 * Its own module because two of them now do. `lib/i18n-source.ts` built this
 * to read the translations file's object literals without a regex swallowing a
 * locale map, and `lib/strip-comments.ts` needs the same answer for a
 * different reason: a quote or a BACKTICK inside a pattern (`/`msg-${x}/`,
 * `/["']key["']/`) puts a stripper that does not know about regexes into
 * string mode, after which every comment below it survives into what a guard
 * reads as code. That was live in four files when this moved here.
 *
 * The table below is derived from the grammar rather than recalled, and
 * audited exhaustively against ECMA-262's `ReservedWord` production in
 * `__tests__/js-tokens.test.ts` — a word in NEITHER list is a red case there
 * rather than an invisible one here.
 */

/**
 * After one of these, a `/` is division; anywhere else it opens a regular
 * expression. The standard disambiguation, and the reason it is needed here at
 * all: a value like `(p) => p.name.replace(/}/g, "")` puts a brace inside a
 * regex, and a scanner that reads it as structure ends the literal early and
 * loses every key below it.
 *
 * The `.` is in the class for one shape and one only: a trailing-dot numeric
 * literal. `2. / 2` is a division, and `.` was outside the class, so the `/`
 * opened a regex and ate the rest of its line — `1.5 / 2` escaped it by ending
 * in a DIGIT, which is why the hole stayed invisible while every decimal in
 * the file went through. A `.` can be the token before a `/` in no other valid
 * program (`p./re/` is a syntax error, and no statement begins with a dot), so
 * reading it as end-of-expression is unconditional rather than a guess.
 *
 * What a misread costs, since it decides how much the two rules below have to
 * be right about: {@link skipRegExpLiteral} stops at a NEWLINE, so a `/` read
 * as a regex opener swallows the rest of its line and the scan resyncs on the
 * next one. That bound is why every hazard here is a lost key or two rather
 * than a truncated literal — and it is also why a stale-word bug cannot be
 * caught by counting keys from outside on a file prettier has wrapped.
 *
 * The `.` argument is the third claim in this file that is load-bearing and
 * unassertable, and they are worth naming together because each is defended
 * only by the comment above it:
 *  1. this one — the counter-example (`p./re/`) is a SYNTAX ERROR, so it
 *     cannot be written into a fixture that compiles, and the scanner would
 *     read the fixture the same way whichever side of the class the `.` sat on;
 *  2. the ASI rows of {@link REGEXP_FOLLOWS_KEYWORD} — `break`, `continue` and
 *     `debugger` cost nothing because no valid program puts a `/` on their
 *     line, which is again a statement about the grammar and not about a scan;
 *  3. the newline bound just described — it is why every misread here is
 *     survivable, and a case asserting it would be asserting that a bug this
 *     scanner does not have would have been cheap.
 * A reader tempted to delete any of the three for want of a test should read
 * that absence as the claim being about JavaScript rather than about this file.
 */
export const DIVISION_FOLLOWS = /[A-Za-z0-9_$)\]}"'`.]/;

/**
 * One row of {@link REGEXP_FOLLOWS_KEYWORD}: the shape that puts a regex after
 * the word, and — separately — what stands between the two.
 *
 * The separator is its own field because the two claims are not the same one
 * and only one of them is about a division this scanner can get wrong. An
 * `"inline"` row asserts the strong thing: a `/` can follow the word on the
 * SAME line, so a program really can write `return /re/.test(s)` and a scanner
 * reading that `/` as division loses the rest of the line. A `"newline"` row
 * asserts the weak one: the word ends a statement, so the only place its regex
 * can stand is the line below, and the row exists to keep the word out of the
 * "in neither list" hole rather than to describe a hazard.
 *
 * Collapsing them is how the row-shape case quietly stopped checking anything:
 * it matched the word and its regex with a single space until the three ASI
 * rows arrived, then loosened to "any whitespace" for every row at once —
 * after which a `return` row rewritten across a line break would still have
 * passed, and the distinction that decides whether there is a division to get
 * wrong was no longer stated anywhere. With the field, the inline rows are
 * checked strictly again.
 */
export type KeywordRegExpRow = {
  /** A valid fragment in which a regex stands immediately after the word. */
  readonly example: string;
  /** Whether {@link example} separates word from `/` by spaces or a newline. */
  readonly separator: "inline" | "newline";
};

/**
 * …except after one of these words, which end in an identifier character and
 * still leave the grammar expecting an expression — so the one-character rule
 * above calls `return /}/.test(s)` a division and reads the pattern as
 * structure, the exact failure the regex branch exists to prevent, one keyword
 * away. `x / 2` and `returnValue / 2` are still divisions: what matters is the
 * whole word before the slash, not its last letter.
 *
 * The list is derived rather than recalled, because a list written from memory
 * is the kind that is wrong in one row nobody checks. ECMA-262 tokenises with
 * two goal symbols — `InputElementRegExp`, where a `/` starts a
 * `RegularExpressionLiteral`, and `InputElementDiv`, where it is the division
 * operator — and the goal is chosen by whether the grammar is at the START of
 * an expression. `DIVISION_FOLLOWS` approximates "the previous token ended an
 * expression"; a reserved word is where that approximation breaks, so the
 * membership rule is not "is this a keyword" but "can an expression begin
 * immediately after this word".
 *
 * Every row therefore carries the shape that puts one there, and three of them
 * (`extends`, `instanceof`, `new`) are rows the PARSER accepts and the runtime
 * then rejects — which changes nothing here, since a tokeniser has to read the
 * literal either way. Three more (`break`, `continue`, `debugger`) put their
 * regex on the NEXT LINE, because that is the only place one can stand: each
 * ends a statement, so no valid program writes a `/` straight after them, and
 * ASI closes the statement at the line break so the `/re/` below opens a new
 * one. Those three say so in their {@link KeywordRegExpRow.separator}, which is
 * what keeps the other sixteen checkable as the same-line claim they are. A row
 * costs nothing where there is no division to get wrong, and leaving them out
 * is exactly how a word ends up in neither the table nor the audit.
 *
 * Words that end an expression (`this`, `true`, `null`, `super`) are
 * deliberately absent, and so are the ones a punctuator or a binding name
 * always follows: `if`, `while`, `for` and `switch` take a `(`, and a `/`
 * after the matching `)` is the ambiguity this scanner cannot resolve without
 * a parser. Which side each word of the language falls on is checked
 * exhaustively against ECMA-262's `ReservedWord` production in
 * `__tests__/js-tokens.test.ts`, so a word in NEITHER list is a red case
 * rather than an invisible one. That suite audits the table; each CALLER's
 * suite separately drives its own scanner over every row, because a table
 * nobody consults is documentation.
 */
export const REGEXP_FOLLOWS_KEYWORD: Readonly<Record<string, KeywordRegExpRow>> = {
  await: { example: "await /re/.test(s)", separator: "inline" },
  break: { example: "break\n/re/.test(s);", separator: "newline" },
  case: { example: "case /re/.test(s):", separator: "inline" },
  continue: { example: "continue\n/re/.test(s);", separator: "newline" },
  debugger: { example: "debugger\n/re/.test(s);", separator: "newline" },
  default: { example: "export default /re/;", separator: "inline" },
  delete: { example: "delete /re/.lastIndex", separator: "inline" },
  do: { example: "do /re/.test(s); while (next())", separator: "inline" },
  else: { example: "else /re/.test(s);", separator: "inline" },
  extends: { example: "class R extends /re/ {}", separator: "inline" },
  in: { example: '"source" in /re/', separator: "inline" },
  instanceof: { example: "s instanceof /re/", separator: "inline" },
  new: { example: "new /re/()", separator: "inline" },
  of: { example: "for (const m of /re/)", separator: "inline" },
  return: { example: "return /re/.test(s)", separator: "inline" },
  throw: { example: "throw /re/", separator: "inline" },
  typeof: { example: "typeof /re/", separator: "inline" },
  void: { example: "void /re/", separator: "inline" },
  yield: { example: "yield /re/", separator: "inline" },
};

/**
 * Membership is read off the table itself rather than off a `Set` rebuilt from
 * its keys at import: a second structure derived from the first cannot drift on
 * the day it is written and is precisely what a later hand-edit drifts, with
 * every membership case still green — they read the record, and the scanner
 * read the set. `Object.hasOwn` rather than `in`, so a value named
 * `constructor` or `toString` is not a keyword by inheritance.
 */
export const followsRegExpKeyword = (word: string): boolean =>
  Object.hasOwn(REGEXP_FOLLOWS_KEYWORD, word);
