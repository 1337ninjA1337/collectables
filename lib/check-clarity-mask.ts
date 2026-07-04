/**
 * Clarity input-mask scanner used by `scripts/check-clarity-mask.ts` and its
 * tests.
 *
 * Pure module: no React Native imports, no filesystem access. Filesystem
 * walking lives in the script wrapper so the matcher can be unit-tested
 * under `node --test` without mocking `fs`.
 *
 * The check enforces the hard requirement declared in
 * docs/analytics-platform.md "Privacy implications": every `<input>`
 * rendered by react-native-web must carry `data-clarity-mask="True"` (or a
 * `ms-clarity-mask` wrapper class) so Microsoft Clarity's session replay
 * never records what users type. In this codebase inputs are authored as
 * `<TextInput` (react-native) — the mask is applied by spreading
 * `CLARITY_MASK_PROPS` from `lib/clarity-mask.ts`, which react-native-web
 * renders as the `data-clarity-mask` attribute. Raw `<input` elements are
 * flagged unconditionally with a dedicated reason: nothing in the app
 * should bypass the RN primitive.
 */

export type ClarityMaskViolation = {
  file: string;
  line: number;
  column: number;
  /** The tag that was found, e.g. "TextInput" or "input". */
  tag: string;
  reason: "unmasked" | "raw-input";
};

/**
 * Markers that satisfy the mask requirement when present inside the tag's
 * attribute region:
 * - `...CLARITY_MASK_PROPS` — the shared spread from lib/clarity-mask.ts
 *   (canonical form; renders `data-clarity-mask="True"` via RNW dataSet).
 * - an inline `dataSet={{ clarityMask: ... }}` literal.
 * - a literal `data-clarity-mask` attribute (raw DOM escape hatch).
 * - `ms-clarity-mask` in a className (Clarity's class-based marker).
 */
const MASK_MARKERS = [
  /\.\.\.\s*CLARITY_MASK_PROPS\b/,
  /dataSet\s*=\s*\{\{\s*clarityMask\b/,
  /data-clarity-mask/,
  /ms-clarity-mask/,
];

/** Opening tags the scanner audits. `\b` keeps `<TextInputMask` etc. out. */
const INPUT_TAG_PATTERN = /<(TextInput|input)\b/g;

/**
 * Given `source` and the index just past `<Tag`, return the index of the
 * `>` that closes the opening tag, honouring nested `{ ... }` attribute
 * expressions (e.g. `onChangeText={(t) => setValue(t)}` contains `>`
 * inside braces) and string/template literals inside those expressions.
 * Returns `source.length` when the tag never closes (malformed source) so
 * the caller still scans the remainder rather than crashing.
 */
export function findTagEnd(source: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") {
        i++; // skip the escaped character
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (ch === ">" && depth <= 0) {
      return i;
    }
  }
  return source.length;
}

/** 1-indexed line/column of an absolute offset into `source`. */
function positionAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

/**
 * Scan a single source string for text-input tags that lack the Clarity
 * mask. Returns one entry per violating tag (line + column 1-indexed).
 */
export function findUnmaskedInputs(file: string, source: string): ClarityMaskViolation[] {
  const violations: ClarityMaskViolation[] = [];
  const re = new RegExp(INPUT_TAG_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const tag = m[1];
    const tagEnd = findTagEnd(source, m.index + m[0].length);
    const { line, column } = positionAt(source, m.index);
    if (tag === "input") {
      // Raw DOM inputs bypass the RN primitive; flag regardless of masking
      // so they get rewritten as <TextInput {...CLARITY_MASK_PROPS}>.
      violations.push({ file, line, column, tag, reason: "raw-input" });
    } else {
      const attrs = source.slice(m.index, tagEnd);
      const masked = MASK_MARKERS.some((marker) => marker.test(attrs));
      if (!masked) {
        violations.push({ file, line, column, tag, reason: "unmasked" });
      }
    }
    re.lastIndex = tagEnd;
  }
  return violations;
}

/**
 * Format a list of violations as a human-readable error message. Returns an
 * empty string when there are none so callers can short-circuit.
 */
export function formatClarityMaskReport(violations: ClarityMaskViolation[]): string {
  if (violations.length === 0) return "";
  const grouped = new Map<string, ClarityMaskViolation[]>();
  for (const v of violations) {
    const list = grouped.get(v.file) ?? [];
    list.push(v);
    grouped.set(v.file, list);
  }
  const lines: string[] = [];
  lines.push(
    `Found ${violations.length} text input(s) without Clarity masking in app/** or components/**.`,
  );
  lines.push(
    "Spread {...CLARITY_MASK_PROPS} from lib/clarity-mask.ts onto every <TextInput> (docs/analytics-platform.md ‘Privacy implications’); raw <input> elements must be rewritten as <TextInput>.",
  );
  for (const [file, list] of grouped) {
    lines.push("");
    lines.push(`  ${file}`);
    for (const v of list) {
      const why = v.reason === "raw-input" ? "raw <input> element" : "missing Clarity mask";
      lines.push(`    ${v.line}:${v.column}  <${v.tag}> — ${why}`);
    }
  }
  return lines.join("\n");
}
