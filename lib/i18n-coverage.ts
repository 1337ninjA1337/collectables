/**
 * How much of the app each language actually translates, measured from the
 * source of `lib/i18n-context.tsx` rather than believed from the picker.
 *
 * Every locale map in that file opens with `...en`, so a key nobody translated
 * is not a missing key: it is an English string served under a Polish flag. It
 * renders, it fits the layout, `t()` returns a non-empty value, and every test
 * that asserts a label appears on screen passes. The fallback is the right
 * runtime behaviour — an empty string would be worse — and it is also why the
 * gap survives: nothing in a green suite distinguishes "translated" from
 * "inherited". `deleteItem` existed in three of six languages for as long as it
 * was unused, and was noticed only when a new accessibility label reached for
 * it.
 *
 * So the fallback becomes a NUMBER here. Each language's declared-key count is
 * a fact about the file, floored in {@link TRANSLATION_FLOORS} the way the lint
 * guards floor their walks — a measurement with slack under it, not a target —
 * and the keys a language inherits are listed rather than counted, because the
 * list is what someone would work from.
 *
 * Why "declared" and not "differs from the English string": a locale may
 * legitimately serve the English text (`appName` is a brand, `emailPlaceholder`
 * is an address), and value comparison would report both as untranslated
 * forever. Declaring a key is the recorded decision that someone looked at it;
 * inheriting one is the absence of that decision. The two disagree on a handful
 * of keys, and the honest thing to publish is the count of decisions not made,
 * which is why {@link TranslationCoverage.inherited} carries the names.
 *
 * Node-pure on purpose, and a PARSER rather than an import: `lib/i18n-context.tsx`
 * pulls React Native peers, so the existing i18n suites read its source too
 * (`i18n-translations.test.ts`, `i18n-locale-map-parity.test.ts`). This module
 * is the parsing those suites do by regex, done once and against the syntax.
 */

/** The map every other locale spreads, and the denominator of every ratio. */
export const TRANSLATION_BASE_LANGUAGE = "en";

/**
 * The languages this module expects to find, in picker order.
 *
 * Declared here rather than imported from `lib/i18n-context.tsx` (React Native
 * peers) — `__tests__/i18n-translation-coverage.test.ts` asserts parity against
 * that file's `languageOptions`, so a seventh language cannot arrive in the
 * picker and stay out of this table.
 */
export const TRANSLATION_LANGUAGES = ["ru", "en", "be", "pl", "de", "es"] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

/** What one object literal declares: its own keys, and what it spread in. */
export type ParsedObjectLiteral = {
  /** Keys written at the literal's own level, in source order. */
  readonly keys: readonly string[];
  /** Identifiers spread at that level, e.g. `en` for `...en`. */
  readonly spreads: readonly string[];
};

/**
 * One locale map located in the source: the text between its braces, plus what
 * that text declares.
 */
export type LocaleBlock = ParsedObjectLiteral & {
  readonly language: string;
  /** The literal's body — brace-to-brace, exclusive. */
  readonly body: string;
  /** True when the map spreads {@link TRANSLATION_BASE_LANGUAGE}. */
  readonly inheritsBase: boolean;
};

/**
 * Scans an object literal body and reports what it declares at its OWN level.
 *
 * A brace counter is not enough on its own: the values here are strings and
 * template-literal arrow functions, so `{`, `}` and `:` all appear inside text
 * the parser must not read as structure — a ternary in a `${...}` slot
 * (`Number(count) === 1 ? "item" : "items"`) is a colon at what a naive scan
 * would call the top level. The scan therefore tracks string, template and
 * comment context, and treats a template's `${` as a nested code frame, which
 * is what it is.
 *
 * Depth is relative to `start`, so callers pass the index just after the
 * literal's opening brace and get back the index of the brace that closes it.
 */
function scanObjectLiteral(
  source: string,
  start: number,
): ParsedObjectLiteral & { readonly end: number } {
  const keys: string[] = [];
  const spreads: string[] = [];
  /** Frames of `${`-nested code inside template literals; empty = top level. */
  const frames: number[] = [];
  let depth = 0;
  let i = start;
  /** True while the next identifier at the top level would be a key. */
  let expectKey = true;
  /** True while inside a template literal (its `${` slots push a frame). */
  let inTemplate = false;

  const atTopLevel = () => depth === 0 && frames.length === 0 && !inTemplate;

  while (i < source.length) {
    const ch = source[i];

    if (inTemplate) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        inTemplate = false;
        i += 1;
        continue;
      }
      if (ch === "$" && source[i + 1] === "{") {
        frames.push(depth);
        depth = 0;
        inTemplate = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        i += source[i] === "\\" ? 2 : 1;
      }
      i += 1;
      expectKey = false;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      i += 1;
      expectKey = false;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) {
        // Closing the frame this scan was started on, or returning to the
        // template literal whose `${` opened the frame above it.
        const frame = frames.pop();
        if (frame === undefined) return { keys, spreads, end: i };
        depth = frame;
        inTemplate = true;
        i += 1;
        continue;
      }
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === ",") {
      if (atTopLevel()) expectKey = true;
      i += 1;
      continue;
    }
    if (ch === "." && source.startsWith("...", i)) {
      i += 3;
      const spread = readIdentifier(source, i);
      if (atTopLevel() && spread) spreads.push(spread);
      i += spread.length;
      expectKey = false;
      continue;
    }
    if (isIdentifierStart(ch)) {
      const name = readIdentifier(source, i);
      i += name.length;
      if (atTopLevel() && expectKey) {
        let j = i;
        while (j < source.length && /\s/.test(source[j])) j += 1;
        if (source[j] === ":") {
          keys.push(name);
          i = j + 1;
        }
      }
      expectKey = false;
      continue;
    }
    i += 1;
  }

  return { keys, spreads, end: source.length };
}

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function readIdentifier(source: string, at: number): string {
  let end = at;
  while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
  return source.slice(at, end);
}

/**
 * The keys and spreads of one object literal body — the syntax-aware
 * derivation, and the one {@link translationCoverage} counts.
 */
export function parseObjectLiteral(body: string): ParsedObjectLiteral {
  const { keys, spreads } = scanObjectLiteral(body, 0);
  return { keys, spreads };
}

/**
 * The same question answered from FORMATTING: a key is a line indented by
 * exactly two spaces. True of this file because prettier writes it that way,
 * and false of the language in general — which is the point. It is a second
 * statement of "what does this literal declare", derived from something the
 * scanner above does not look at, so the case comparing them can fail. A
 * scanner bug that swallows entries (an unbalanced template, a string quote it
 * mishandles) shows up as a disagreement rather than as a smaller number that
 * still looks plausible.
 */
export function declaredKeysByIndentation(body: string): readonly string[] {
  const keys: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^ {2}([A-Za-z_$][A-Za-z0-9_$]*):/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/**
 * Locates `const <language> = {` / `const <language>: TranslationMap = {` and
 * reads the literal that follows. Null when the language has no map at all,
 * which is a different finding from a map that declares nothing.
 */
export function findLocaleBlock(
  source: string,
  language: string,
): LocaleBlock | null {
  const declaration = new RegExp(
    `\\bconst\\s+${language}(?:\\s*:\\s*TranslationMap)?\\s*=\\s*\\{`,
  ).exec(source);
  if (!declaration) return null;
  const bodyStart = declaration.index + declaration[0].length;
  const { keys, spreads, end } = scanObjectLiteral(source, bodyStart);
  return {
    language,
    body: source.slice(bodyStart, end),
    keys,
    spreads,
    inheritsBase: spreads.includes(TRANSLATION_BASE_LANGUAGE),
  };
}

/** One language's standing against the base map. */
export type TranslationCoverage = {
  readonly language: string;
  /** Keys the language writes for itself. */
  readonly declared: number;
  /** Keys in the base map this language does not declare, in base order. */
  readonly inherited: readonly string[];
  /** Size of the base map — the denominator. */
  readonly baseKeys: number;
  /**
   * Keys declared here that the base map does not have. Always empty today;
   * a non-empty list is a typo'd key, which `TranslationMap` would reject at
   * compile time but which this parser can also see without a compiler.
   */
  readonly unknown: readonly string[];
};

/** Translated share of the base map, 0–100, one decimal place. */
export function coveragePercent(row: TranslationCoverage): number {
  if (row.baseKeys === 0) return 0;
  const translated = row.baseKeys - row.inherited.length;
  return Math.round((translated / row.baseKeys) * 1000) / 10;
}

/** One line per language, for a report a person reads. */
export function formatCoverageRow(row: TranslationCoverage): string {
  return `${row.language}: ${row.baseKeys - row.inherited.length}/${row.baseKeys} keys (${coveragePercent(row).toFixed(1)}%), ${row.inherited.length} inherited from ${TRANSLATION_BASE_LANGUAGE}`;
}

/**
 * Coverage for every requested language, base language included (it inherits
 * nothing by definition, and its row carries the denominator every other row
 * is measured against).
 *
 * Throws when a language has no map: a caller asking about a language that is
 * not in the file has either renamed one or is asking the wrong question, and
 * answering "0% translated" would read as a finding about the translations.
 */
export function translationCoverage(
  source: string,
  languages: readonly string[] = TRANSLATION_LANGUAGES,
): readonly TranslationCoverage[] {
  const base = findLocaleBlock(source, TRANSLATION_BASE_LANGUAGE);
  if (!base) {
    throw new Error(
      `no \`const ${TRANSLATION_BASE_LANGUAGE}\` map in the source — every ratio here is measured against it`,
    );
  }
  const baseKeys = base.keys;
  const baseSet = new Set(baseKeys);

  return languages.map((language) => {
    const block =
      language === TRANSLATION_BASE_LANGUAGE
        ? base
        : findLocaleBlock(source, language);
    if (!block) {
      throw new Error(`no \`const ${language}\` translation map in the source`);
    }
    const declared = new Set(block.keys);
    return {
      language,
      declared: block.keys.length,
      inherited:
        language === TRANSLATION_BASE_LANGUAGE
          ? []
          : baseKeys.filter((key) => !declared.has(key)),
      baseKeys: baseKeys.length,
      unknown: block.keys.filter((key) => !baseSet.has(key)),
    };
  });
}

/** A committed measurement of one language's declared-key count. */
export type TranslationFloor = {
  /** Minimum declared keys, measured with slack under it. */
  readonly minimum: number;
  /** What was measured, when, and how much slack the floor leaves. */
  readonly note: string;
};

/**
 * Per-language floors on DECLARED keys, in the same spirit as `SCANNED_FLOORS`:
 * a measured number with slack, not a target.
 *
 * Deliberately a floor on what is translated rather than a ceiling on what is
 * inherited. A new English string ships before its five translations — that is
 * the ordinary way a feature lands here — so a ceiling on `inherited` would go
 * red on every feature PR and be deleted within a week, which is the failure
 * mode `lib/scanned-floor.ts` names for a floor that trips on churn. What must
 * never happen is the other direction: a locale LOSING translations, from a
 * bad merge or a block deleted while resolving a conflict. That is what these
 * catch, and the inherited counts are published by the suite instead of gated.
 *
 * Exhaustive over {@link TRANSLATION_LANGUAGES}, so a seventh language cannot
 * be added to the picker without a measurement of its own.
 */
export const TRANSLATION_FLOORS: Readonly<
  Record<TranslationLanguage, TranslationFloor>
> = {
  en: {
    minimum: 500,
    note: "538 keys on 2026-08-17. The base map and the denominator of every other row: a drop here shrinks the whole table's meaning, so the slack is the tightest of the six (~7%).",
  },
  ru: {
    minimum: 500,
    note: "535 of 538 on 2026-08-17 (99.4%) — the only fully-maintained locale. ~7% slack; the three inherited keys are pinned by name in the suite rather than left to this number.",
  },
  be: {
    minimum: 205,
    note: "222 of 538 on 2026-08-17 (41.3%). ~8% slack, which is roughly one feature's worth of keys.",
  },
  pl: {
    minimum: 197,
    note: "213 of 538 on 2026-08-17 (39.6%). ~8% slack, same reasoning as be.",
  },
  de: {
    minimum: 193,
    note: "209 of 538 on 2026-08-17 (38.8%). ~8% slack, same reasoning as be.",
  },
  es: {
    minimum: 193,
    note: "209 of 538 on 2026-08-17 (38.8%). ~8% slack, same reasoning as be.",
  },
};
