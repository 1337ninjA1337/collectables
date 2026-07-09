/**
 * Whole-`process.env` scanner used by `scripts/check-env-inlining.ts` and
 * its tests.
 *
 * Pure module: no React Native imports, no filesystem access. Filesystem
 * walking lives in the script wrapper so the matcher can be unit-tested
 * under `node --test` without mocking `fs`.
 *
 * Why this exists: Metro / babel-preset-expo only inlines
 * `process.env.EXPO_PUBLIC_*` when the access is a *literal member
 * expression* in source. Passing `process.env` whole into a resolver
 * (`resolveFooConfig(process.env as Record<...>)`) or reading keys
 * dynamically (`process.env[name]`) bypasses the transform, so every value
 * reads `undefined` in the production bundle even though the secret was set
 * in CI. `lib/sentry-config.ts` shipped that bug once; this scan keeps every
 * `lib/*-config.ts` resolver (cloudinary, analytics, future modules) on the
 * `readFooEnvFromProcess()` literal-access pattern without a per-module
 * structural test.
 */

/**
 * Matches any `process.env` occurrence that is NOT a literal member access.
 * The lookahead tolerates whitespace/newlines before the `.` because babel
 * inlines member expressions regardless of line breaks — so
 * `process.env\n  .EXPO_PUBLIC_X` is safe and must not be flagged.
 * Everything else (`process.env as Record<`, `(process.env)`,
 * `process.env[key]`, `...process.env`) is a whole-object escape.
 */
export const WHOLE_PROCESS_ENV_PATTERN = /process\.env(?!\s*\.\s*[A-Za-z_$])/g;

export type EnvInliningMatch = {
  file: string;
  line: number;
  column: number;
  /** The offending source line, trimmed, for the report. */
  snippet: string;
};

/**
 * Blank out `//` and `/* *\/` comment bodies with spaces, preserving every
 * newline so match offsets/line numbers still map to the original source.
 * Doc comments legitimately *mention* passing `process.env` whole (that is
 * the whole point of the pattern's documentation) and must not trip the
 * scan. String literals are tracked so a `"// not a comment"` string is
 * left intact.
 */
export function stripComments(source: string): string {
  const out = source.split("");
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") mode = "line";
      else if (c === "/" && next === "*") mode = "block";
      else if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      if (mode === "line" || mode === "block") out[i] = " ";
    } else if (mode === "line") {
      if (c === "\n") mode = "code";
      else out[i] = " ";
    } else if (mode === "block") {
      if (c === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        mode = "code";
      } else if (c !== "\n") {
        out[i] = " ";
      }
    } else {
      // Inside a string literal: honour escapes, exit on the matching quote.
      if (c === "\\") i++;
      else if (mode === "single" && (c === "'" || c === "\n")) mode = "code";
      else if (mode === "double" && (c === '"' || c === "\n")) mode = "code";
      else if (mode === "template" && c === "`") mode = "code";
    }
  }
  return out.join("");
}

/**
 * Scan a single source string for whole-`process.env` usages.
 * Comments are ignored; returns one entry per occurrence
 * (line + column 1-indexed, snippet taken from the original source).
 */
export function findWholeProcessEnvUsages(
  file: string,
  source: string,
): EnvInliningMatch[] {
  const matches: EnvInliningMatch[] = [];
  const stripped = stripComments(source);
  const re = new RegExp(WHOLE_PROCESS_ENV_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const before = stripped.slice(0, m.index);
    const line = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = source.indexOf("\n", m.index);
    matches.push({
      file,
      line,
      column: m.index - lineStart + 1,
      snippet: source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
    });
  }
  return matches;
}

/**
 * Format a list of matches as a human-readable error message. Returns an
 * empty string when there are no matches so callers can short-circuit.
 */
export function formatEnvInliningReport(matches: EnvInliningMatch[]): string {
  if (matches.length === 0) return "";
  const grouped = new Map<string, EnvInliningMatch[]>();
  for (const m of matches) {
    const list = grouped.get(m.file) ?? [];
    list.push(m);
    grouped.set(m.file, list);
  }
  const lines: string[] = [];
  lines.push(
    `Found ${matches.length} whole-\`process.env\` usage(s) in lib/*-config.ts.`,
  );
  lines.push(
    "Metro only inlines literal `process.env.EXPO_PUBLIC_*` accesses — add a `readFooEnvFromProcess()` helper (see lib/sentry-config.ts) instead of passing `process.env` whole.",
  );
  for (const [file, list] of grouped) {
    lines.push("");
    lines.push(`  ${file}`);
    for (const m of list) {
      lines.push(`    ${m.line}:${m.column}  ${m.snippet}`);
    }
  }
  return lines.join("\n");
}
