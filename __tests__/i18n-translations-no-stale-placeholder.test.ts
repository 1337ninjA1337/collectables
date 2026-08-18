import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile as read } from "./helpers/repo-file";
import { tsxFiles } from "./helpers/source-files";

/** The two trees that hold rendered markup. */
const SCAN_DIRS = ["app", "components"] as const;

/**
 * Structural audit over every i18n string that is rendered as a `placeholder`.
 *
 * The regression class this catches: React Native's `TextInput` does NOT
 * ellipsise a placeholder — it clips it. A hint that reads fine in English on
 * a wide simulator silently loses its second half in German on a narrow
 * phone, and nothing fails, so nobody notices until a user reports it.
 *
 * Two things make this audit hold up over time:
 *
 *   1. The key list is DERIVED from the JSX, never hardcoded. A new
 *      `placeholder={t("…")}` anywhere under `app/` or `components/` is
 *      covered the moment it is written — which is the opposite of the
 *      per-key tests elsewhere in this repo, where adding a key means
 *      remembering to add its assertions.
 *
 *   2. The cap is per FIELD SHAPE, not global. A `multiline` field is a
 *      textarea several lines tall, so a full sentence of guidance fits
 *      there and genuinely does not on a single-line input. Applying one
 *      number to both would either fail the four legitimate long hints or be
 *      too loose to catch anything.
 *
 * On punctuation, the rule is narrower than "no dots": a trailing `…`/`...`
 * is idiomatic for a hint ("Write a message…") and `e.g.` / `np.` / `z. B.` /
 * `p. ej.` are ordinary abbreviations in five of the six languages. What is
 * banned is a placeholder written as a SENTENCE — one that ends in a single
 * `.` or contains a `?` — because that is the shape that runs long.
 */


type Usage = { key: string; file: string; multiline: boolean };

/**
 * Every `placeholder={t("KEY")}` in the UI, tagged with whether the element
 * carrying it is `multiline`.
 *
 * The element is located by walking OUT from the placeholder prop — back to
 * the nearest unclosed `<Tag`, forward to that tag's `>` — rather than by
 * matching a list of component names. `app/create.tsx` renders placeholders
 * through a local `<Field>` wrapper and `components/currency-input.tsx`
 * through `<CurrencyInput>`, so a name-based scan silently skips them, which
 * is exactly the kind of blind spot that makes an audit worthless.
 */
function collectUsages(): Usage[] {
  const usages: Usage[] = [];
  for (const file of tsxFiles(...SCAN_DIRS)) {
    const src = read(file);
    const re = /placeholder=\{t\("([A-Za-z0-9_]+)"\)\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      const open = src.lastIndexOf("<", match.index);
      const close = src.indexOf(">", match.index);
      assert.ok(open >= 0 && close > open, `${file}: could not bound the element around ${match[1]}`);
      const element = src.slice(open, close);
      usages.push({ key: match[1], file, multiline: /\bmultiline\b/.test(element) });
    }
  }
  return usages;
}

/** All declared values of `key` across the en base table and the 5 overrides. */
function valuesOf(i18n: string, key: string): string[] {
  return [...i18n.matchAll(new RegExp(`\\b${key}:\\s*"([^"]*)"`, "g"))].map((m) => m[1]);
}

/** Single-line inputs clip hard — this is roughly what fits on a 360dp phone. */
const SINGLE_LINE_MAX = 40;
/** Textareas are several lines tall, so a full sentence of guidance fits. */
const MULTILINE_MAX = 90;

const USAGES = collectUsages();
const I18N = readI18nSource();

describe("i18n placeholders — the audit sees every placeholder in the UI", () => {
  it("finds placeholder keys in both source dirs", () => {
    // A refactor that moved every input behind one wrapper, or a regex that
    // stopped matching, would leave this suite passing vacuously.
    assert.ok(USAGES.length >= 20, `only ${USAGES.length} placeholder usages found — scan is broken`);
    for (const dir of SCAN_DIRS) {
      assert.ok(
        USAGES.some((u) => u.file.startsWith(`${dir}/`)),
        `no placeholder usages found under ${dir}/`,
      );
    }
  });

  it("classifies both field shapes, so neither cap is dead code", () => {
    assert.ok(USAGES.some((u) => u.multiline), "no multiline placeholder found");
    assert.ok(USAGES.some((u) => !u.multiline), "no single-line placeholder found");
  });

  it("resolves every key it found to a real i18n declaration", () => {
    // Catches a typo'd `t("itemTitlePlaceholdr")` — which type-checks only
    // because a missing key falls back at runtime, rendering an empty hint.
    for (const usage of USAGES) {
      assert.ok(
        valuesOf(I18N, usage.key).length > 0,
        `${usage.file} renders t("${usage.key}") but no such key is declared`,
      );
    }
  });

  it("never renders one key as both a single-line and a multiline hint", () => {
    // The two shapes have different length budgets; a key used as both could
    // only satisfy the stricter one, making the looser cap a lie.
    const byKey = new Map<string, Set<boolean>>();
    for (const u of USAGES) {
      if (!byKey.has(u.key)) byKey.set(u.key, new Set());
      byKey.get(u.key)!.add(u.multiline);
    }
    for (const [key, shapes] of byKey) {
      assert.equal(shapes.size, 1, `${key} is rendered in both a single-line and a multiline field`);
    }
  });
});

describe("i18n placeholders — length caps per field shape", () => {
  for (const usage of USAGES) {
    const cap = usage.multiline ? MULTILINE_MAX : SINGLE_LINE_MAX;
    const shape = usage.multiline ? "multiline" : "single-line";

    it(`${usage.key} (${shape}) stays under ${cap} characters in all languages`, () => {
      const values = valuesOf(I18N, usage.key);
      for (const value of values) {
        assert.ok(
          value.length <= cap,
          `${usage.key} is ${value.length} chars (cap ${cap} for a ${shape} field): "${value}"`,
        );
      }
    });
  }
});

describe("i18n placeholders — hint shape, not sentence shape", () => {
  const keys = [...new Set(USAGES.map((u) => u.key))].sort();

  for (const key of keys) {
    it(`${key} reads as a hint in every language`, () => {
      for (const value of valuesOf(I18N, key)) {
        assert.ok(value.length > 0, `${key} is an empty string`);
        assert.equal(value.trim(), value, `${key} has leading/trailing whitespace: "${value}"`);

        // A question mark means the hint was written as a prompt
        // ("What did you pay?") — those run long and read oddly greyed out
        // inside a field the user is about to type into.
        assert.ok(!value.includes("?"), `${key} is phrased as a question: "${value}"`);

        // A trailing single "." is a sentence. A trailing "..." / "…" is the
        // idiomatic "keep going" ellipsis and stays allowed, as do the
        // abbreviations ("e.g.", "np.", "z. B.", "p. ej.") that five of the
        // six languages use to open a hint.
        const endsInEllipsis = value.endsWith("...") || value.endsWith("…");
        assert.ok(
          !value.endsWith(".") || endsInEllipsis,
          `${key} ends in a sentence-final period: "${value}"`,
        );
      }
    });
  }
});
