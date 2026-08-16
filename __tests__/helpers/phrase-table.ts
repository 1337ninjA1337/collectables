/**
 * The shape rules every phrasing table in this repository has to satisfy, in
 * one place, with the reason for each beside it.
 *
 * There are three such tables now — `OBSTRUCTION_PHRASE`, `EMPTY_LINK_PHRASE`
 * and `EMPTY_LINK_TAIL` — each holding the wording for one closed union of
 * findings, each rendered into a sentence built around it. Their suites were
 * written by copying the one before, and by the third the copies had already
 * drifted: the first forbids a period ANYWHERE in a row and the second forbids
 * one only at the END, which is a real difference for a real reason (the second
 * legitimately names `.package-lock.json` mid-phrase) that was recorded
 * nowhere. A rule nobody wrote down is a rule the next table inherits by coin
 * flip — and the containment check, which only the second table had, is the
 * same story in the other direction: the first went without it for no reason at
 * all.
 *
 * So the rules are a parameter and the reasons live here. A new table states
 * what it needs and gets everything else for free; a table that wants to differ
 * has to say which rule and, because the option is named after the reason,
 * roughly why.
 *
 * Lives under `__tests__/helpers/` — outside the `__tests__/*.test.ts` runner
 * glob, so it is a library, not a suite.
 */

import assert from "node:assert/strict";

/** Where a row may carry a period, and what each choice is for. */
export type PeriodRule =
  /**
   * Nowhere in the row. For tables whose phrase is rendered mid-sentence with
   * text following it on both sides, where any period ends the sentence early.
   */
  | "never"
  /**
   * Not as the last character. For tables whose rows legitimately name a dotted
   * file — `.package-lock.json`, `.bin` — while still being continued by the
   * clause that renders them, which supplies the punctuation itself.
   */
  | "not-at-the-end";

export type PhraseTableRules = {
  /**
   * What every row must begin with.
   *
   * A phrase table exists because the rows are dropped into ONE template, and
   * the template decides the grammar: rows completing "<path> …" open with a
   * verb ("is not a directory"), rows completing "… and <tail>" open with a
   * subject. A row written for the wrong template parses as prose and reads as
   * a bug report nobody can act on.
   */
  readonly opens: RegExp;
  /** @see PeriodRule */
  readonly periods: PeriodRule;
  /**
   * The sentence the rows are rendered into, quoted back in failure messages so
   * a red run shows what the row has to fit rather than only what it is.
   */
  readonly template: string;
};

/**
 * Assert the rows of a phrasing table are usable in the sentence that renders
 * them, distinct from each other, and safe to pin with `includes`.
 *
 * The distinctness rules are two, and the second is the one that is easy to
 * miss: two identical rows are two findings the reader cannot act on
 * differently, and a row CONTAINED IN another is worse than that — every case
 * pinning the shorter with `includes` passes on a message that only ever
 * printed the longer, so the shorter row can be dead prose and its case green
 * forever.
 *
 * Takes the table as `Record<string, string>` rather than a generic keyed on
 * the union, because nothing here is about the keys: the caller pins those
 * separately (a table that lost a row is a refusal rendering `undefined`, which
 * is a different failure with a different message).
 */
export function assertPhraseTable(
  table: Readonly<Record<string, string>>,
  rules: PhraseTableRules,
): void {
  const entries = Object.entries(table);
  assert.ok(entries.length > 0, `a phrasing table with no rows renders nothing into ${rules.template}`);

  for (const [key, phrase] of entries) {
    assert.match(
      phrase,
      rules.opens,
      `${key} does not open the way "${rules.template}" needs (${String(rules.opens)}): ${phrase}`,
    );
    assert.equal(phrase.trim(), phrase, `${key} is padded, and the template spaces its own slot: "${phrase}"`);
    assert.doesNotMatch(phrase, /\n/, `${key} spans lines, and the template is one sentence: ${phrase}`);
    if (rules.periods === "never") {
      assert.doesNotMatch(
        phrase,
        /\./,
        `${key} punctuates itself and "${rules.template}" continues past it: ${phrase}`,
      );
    } else {
      assert.doesNotMatch(
        phrase,
        /\.$/,
        `${key} ends the sentence "${rules.template}" means to continue: ${phrase}`,
      );
    }
  }

  const phrases = entries.map(([, phrase]) => phrase);
  assert.equal(
    new Set(phrases).size,
    phrases.length,
    `two rows say the same words, so the reader cannot tell the findings apart: ${phrases.join(" / ")}`,
  );
  for (const phrase of phrases) {
    const container = phrases.find((other) => other !== phrase && other.includes(phrase));
    assert.equal(
      container,
      undefined,
      `"${phrase}" is contained in "${container}", so an \`includes\` pin on the shorter row is satisfied by the longer one and can never fail`,
    );
  }
}
