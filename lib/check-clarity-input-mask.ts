/**
 * Clarity input-mask scanner used by `scripts/check-clarity-input-mask.ts`
 * and its tests.
 *
 * Pure module: no filesystem access. The CLI wrapper walks `app/` +
 * `components/` for `.tsx` files and passes their contents here so the rules
 * can be unit-tested under `node --test` without mocking `fs`.
 *
 * The rule (docs/analytics-platform.md "Privacy" section): every text input
 * rendered on web must carry the Microsoft Clarity masking attribute
 * (`data-clarity-mask`) so session replays never capture user input — a
 * single forgotten input (e.g. the email-OTP form) would leak its contents
 * to Clarity's replay bucket. In practice that means using the
 * `MaskedTextInput` wrapper (`components/masked-text-input.tsx`) instead of
 * raw `<TextInput` / `<input`. A raw tag is tolerated only when its own
 * props visibly carry the mask (`clarity-mask` inside the tag, via
 * `dataSet={{ "clarity-mask": ... }}` or a literal `data-clarity-mask`
 * attribute) — which is exactly what the wrapper itself does.
 */

export type ClarityMaskViolation = {
  file: string;
  line: number;
  tag: "TextInput" | "input";
  hint: string;
};

const MASK_MARKER = "clarity-mask";

/**
 * Files where a raw `<TextInput` is expected: the wrapper that applies the
 * mask attribute itself.
 */
export const CLARITY_MASK_ALLOWED_FILES: readonly string[] = [
  "components/masked-text-input.tsx",
];

/**
 * Find the end of a JSX opening tag starting at `openIndex` (the `<`).
 * Skips `>` characters inside `{...}` expressions (arrow functions in
 * handlers) so `onChangeText={(v) => ...}` doesn't terminate the scan early.
 * Returns the index just past the closing `>`, or `source.length` if the
 * tag never closes (malformed source — treat the rest of the file as the
 * tag so the mask check still sees every attribute).
 */
function endOfJsxTag(source: string, openIndex: number): number {
  let braceDepth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === ">" && braceDepth === 0) return i + 1;
  }
  return source.length;
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/**
 * Scan one file's contents for unmasked `<TextInput` / `<input` JSX tags.
 *
 * A `<` preceded by an identifier character is a TypeScript generic
 * (`useRef<TextInput>`), not JSX, and is skipped. A tag is compliant when
 * its own attribute span contains `clarity-mask`.
 */
export function findUnmaskedInputTags(
  file: string,
  source: string,
): ClarityMaskViolation[] {
  const violations: ClarityMaskViolation[] = [];
  const tagPattern = /<(TextInput|input)\b/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    const before = match.index > 0 ? source[match.index - 1] : "";
    if (before !== "" && IDENTIFIER_CHAR.test(before)) continue; // generic, not JSX
    const tagEnd = endOfJsxTag(source, match.index);
    const tagText = source.slice(match.index, tagEnd);
    if (tagText.includes(MASK_MARKER)) continue;
    violations.push({
      file,
      line: lineNumberAt(source, match.index),
      tag: match[1] as ClarityMaskViolation["tag"],
      hint: "use MaskedTextInput from components/masked-text-input.tsx (or add data-clarity-mask)",
    });
  }
  return violations;
}

/**
 * Full scan over `{ path -> contents }`, skipping the allow-listed wrapper.
 * Sorted by path, then line.
 */
export function findClarityMaskViolations(
  files: Record<string, string>,
): ClarityMaskViolation[] {
  const violations: ClarityMaskViolation[] = [];
  for (const file of Object.keys(files).sort()) {
    if (CLARITY_MASK_ALLOWED_FILES.includes(file)) continue;
    violations.push(...findUnmaskedInputTags(file, files[file]));
  }
  return violations;
}

export function formatClarityMaskReport(
  violations: ClarityMaskViolation[],
): string {
  const lines = violations.map(
    (v) => `  ${v.file}:${v.line} — unmasked <${v.tag}>: ${v.hint}`,
  );
  return [
    `check-clarity-input-mask: ${violations.length} unmasked input(s) would be recorded by Clarity session replay:`,
    ...lines,
    "Every input must carry data-clarity-mask on web — render it via MaskedTextInput.",
  ].join("\n");
}
