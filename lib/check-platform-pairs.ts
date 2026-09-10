/**
 * Scanner behind `scripts/check-platform-pairs.ts` (`npm run
 * lint:platform-pairs`): the two halves of a platform-split module still agree
 * about what they export.
 *
 * ## The failure this exists for
 *
 * Metro resolves `@/lib/reorder-announcement` to the `.web.ts` spelling in the
 * web bundle and to the plain one everywhere else. There are two such pairs
 * today — `DraggableList` and `reorder-announcement` — and nothing has ever
 * compared them. A web half
 * that drops an export, renames one, or is added without a native sibling at
 * all is a runtime `undefined is not a function` on ONE platform, and it passes
 * every check this repository runs: `tsc` type-checks each file on its own and
 * the node suites import the NATIVE half, because node has no platform
 * extensions. GitHub Pages is the only build that ships, and it is the half no
 * suite loads.
 *
 * The `reorder-announcement` pair already carries the shape that makes this
 * cheap to get wrong: its web spelling re-exports `ReorderAnnouncement` from
 * the native one with `export type { … } from`, which is a different statement
 * form from the `export type` that declares it. Two forms, one name — exactly
 * the comparison a reader does by eye and stops doing after the third pair.
 *
 * ## Names, not signatures
 *
 * This compares the SET OF EXPORTED NAMES and nothing else. A web half whose
 * `announceReorder` takes different arguments is a real bug and is not this
 * guard's — that one `tsc` can see, because both halves are type-checked and
 * the screens' call sites pin the native signature. What no compiler sees is a
 * name that exists on one side and not the other.
 *
 * ## Where it refuses rather than guesses
 *
 * The reader recognises the export forms this tree uses and REFUSES anything
 * else ({@link ExportScan.unreadable}), instead of returning a name set that is
 * quietly short. A missing name and an unparsed statement produce the same
 * "only in the native half" finding, so a reader that shrugged at an unfamiliar
 * form would report a difference that is not there — or, worse, miss one that
 * is, when both halves use the form. `export const a = 1, b = 2;` is the
 * commonest of these: naming `a` and stopping is the silent direction.
 *
 * Pure module: no filesystem access — the CLI walks the directories and hands
 * sources over, so every rule here is unit-testable under node --test.
 */

import { QUOTES, balancedInner, endOfString } from "@/lib/balanced-source";
import { codeOffsets, stripComments } from "@/lib/strip-comments";

/**
 * The platform suffixes Metro resolves, without the leading dot.
 *
 * All four, not just `web`, even though `web` is the only one this tree uses:
 * the day someone adds `foo.ios.ts` the pair it forms is the same pair, and a
 * guard that only knew about one suffix would let it land unchecked. The
 * `native` suffix is Metro's own catch-all for "not web" and pairs with the
 * extensionless spelling the same way.
 */
export const PLATFORM_SUFFIXES: readonly string[] = ["web", "native", "ios", "android"];

/** The extensions a native sibling may be spelled with, most likely first. */
const SIBLING_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/** One platform-specific file, split into the parts a pair is built from. */
export type PlatformFile = {
  /** Repo-relative path of the platform spelling, e.g. `lib/foo.web.ts`. */
  readonly file: string;
  /** The path with the platform suffix and extension removed, e.g. `lib/foo`. */
  readonly base: string;
  /** Which suffix it carries, e.g. `web`. */
  readonly platform: string;
};

/**
 * The platform parts of a path, or null when it carries none.
 *
 * Matched on the suffix as its own dot-delimited segment: `lib/foo.web.ts` is a
 * platform spelling and `lib/webhooks.ts` is not, which a `includes(".web")`
 * test would get wrong in both directions.
 */
export function platformSpelling(file: string): PlatformFile | null {
  for (const platform of PLATFORM_SUFFIXES) {
    for (const extension of SIBLING_EXTENSIONS) {
      const suffix = `.${platform}${extension}`;
      if (file.endsWith(suffix)) {
        return { file, base: file.slice(0, -suffix.length), platform };
      }
    }
  }
  return null;
}

/** A platform spelling and the native file it must agree with. */
export type PlatformPair = {
  readonly platform: PlatformFile;
  /** The native sibling's path, or null when the tree holds none. */
  readonly native: string | null;
};

/**
 * Every platform spelling in `files`, each matched to its native sibling.
 *
 * `files` is the whole walk rather than only the platform ones, because the
 * sibling lookup is a membership test against it: a pair is formed from what
 * the scan actually saw, so a native half that exists outside the scanned roots
 * is correctly reported as missing rather than assumed.
 */
export function platformPairs(files: readonly string[]): PlatformPair[] {
  const present = new Set(files);
  const pairs: PlatformPair[] = [];
  for (const file of files) {
    const platform = platformSpelling(file);
    if (!platform) continue;
    const native =
      SIBLING_EXTENSIONS.map((extension) => `${platform.base}${extension}`).find((candidate) =>
        present.has(candidate),
      ) ?? null;
    pairs.push({ platform, native });
  }
  return pairs;
}

/** One export, as an importer would name it, and where it is declared. */
export type ExportRecord = {
  /** The imported name — `default` for a default export, `*` for a bare re-export. */
  readonly name: string;
  /** 1-based line of the `export` keyword. */
  readonly line: number;
};

/** An export statement the reader recognised nothing in, kept for the report. */
export type UnreadableExport = {
  /** The statement's opening text, trimmed and truncated, for the message. */
  readonly snippet: string;
  readonly line: number;
  /** Why it could not be named, as a whole clause. */
  readonly reason: string;
};

export type ExportScan = {
  readonly exports: readonly ExportRecord[];
  readonly unreadable: readonly UnreadableExport[];
};

/** `export { a, b as c, type D }` — the brace list's own contents. */
const NAMED_BLOCK = /^export\s+(?:type\s+)?\{/;
/** `export * as ns from "…"`. */
const STAR_AS = /^export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\b/;
/** `export * from "…"` — a name set this reader cannot resolve. */
const STAR = /^export\s+\*\s*from\b/;
/** `export default …`, whatever follows: the exported name is `default`. */
const DEFAULT_EXPORT = /^export\s+default\b/;
/** `export function f`, `export const x`, `export type T`, and the rest. */
const DECLARATION =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
/** Which declaration keywords may be followed by a second declarator. */
const MULTI_DECLARATOR = /^export\s+(?:declare\s+)?(?:const|let|var)\b/;

/** How much of an unreadable statement the report quotes. */
const SNIPPET_LENGTH = 60;

/**
 * The names one `export { … }` list introduces.
 *
 * `a as b` exports `b`; `type A` exports `A`; `default as X` exports `X`. The
 * LOCAL name on the left is deliberately dropped — it is invisible to an
 * importer, and comparing local names would report a difference between two
 * halves that export exactly the same thing under different internals.
 */
function namesInBlock(inner: string): string[] {
  return inner
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const words = entry.replace(/^type\s+/, "").split(/\s+as\s+/);
      return (words[words.length - 1] ?? "").trim();
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * True when a `const`/`let`/`var` statement declares more than one name.
 *
 * Walks forward from the declaration tracking bracket depth and skipping string
 * literals, and answers on the first depth-0 comma. Everything before the
 * statement ends is fair game for commas that are NOT declarator separators —
 * an argument list, an array literal, an object literal, a type parameter list
 * — which is why depth is counted rather than the line being split.
 *
 * ## Where it stops, and which way it errs
 *
 * At a depth-0 `;` or a depth-0 NEWLINE. A multi-line declaration is therefore
 * not read to its end, so a second declarator on a later line is missed — and
 * that is the direction chosen deliberately. This function's only consequence
 * is a REFUSAL, so a false positive fails a guard over correct source while a
 * false negative leaves the reader exactly as short as it was before this
 * function existed. Every multi-declarator statement in real code is one line.
 *
 * `<` counts as a bracket only when it is preceded by an identifier character
 * — `Record<string, number>` is a type argument list whose comma is not a
 * declarator separator, while `a > b`, `=>` and a JSX tag are not brackets at
 * all. Depth is clamped at zero so a stray closer cannot drive it negative and
 * make every later comma look top-level, which is how the arrow in
 * `() => fn(a, b)` read as a second declarator.
 */
function declaresSecondName(code: string, from: number): boolean {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const char = code[i]!;
    if (QUOTES.has(char)) {
      // The quote-aware skip the balanced reader uses, for the same reason: a
      // comma or a brace inside a string literal is text, not structure.
      i = endOfString(code, i) - 1;
      continue;
    }
    const opensGeneric = char === "<" && /[\w$)\]]/.test(code[i - 1] ?? "");
    if (char === "(" || char === "[" || char === "{" || opensGeneric) {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === ">" && code[i - 1] !== "=" && depth > 0) {
      depth -= 1;
    } else if (depth === 0 && (char === ";" || char === "\n")) {
      return false;
    } else if (depth === 0 && char === ",") {
      return true;
    }
  }
  return false;
}

/**
 * Every name a module exports, plus every export statement that could not be
 * named at all.
 *
 * Comments are stripped and string literals are skipped, so the word `export`
 * in this file's own prose — or in a translated string — is not a statement.
 * Offsets survive the strip, so the reported line is the real one.
 */
export function exportedNames(source: string): ExportScan {
  const code = stripComments(source);
  const isCode = codeOffsets(source);
  const exports: ExportRecord[] = [];
  const unreadable: UnreadableExport[] = [];

  for (const match of code.matchAll(/\bexport\b/g)) {
    const at = match.index;
    if (!isCode(at)) continue;
    const line = code.slice(0, at).split("\n").length;
    const rest = code.slice(at);

    const block = NAMED_BLOCK.exec(rest);
    if (block) {
      const brace = at + rest.indexOf("{");
      const inner = balancedInner(code, brace, "{", "}");
      if (inner === null) {
        unreadable.push({
          snippet: snippetAt(rest),
          line,
          reason: "its brace list is never closed",
        });
        continue;
      }
      for (const name of namesInBlock(inner)) exports.push({ name, line });
      continue;
    }

    const starAs = STAR_AS.exec(rest);
    if (starAs) {
      exports.push({ name: starAs[1]!, line });
      continue;
    }

    if (STAR.test(rest)) {
      // A bare re-export's names live in another module, so this reader cannot
      // list them — and a pair where one half has one is a pair whose sets
      // cannot be compared. Reported rather than recorded as a name.
      unreadable.push({
        snippet: snippetAt(rest),
        line,
        reason: "a bare `export * from` names nothing this scan can resolve — re-export the names explicitly so both halves can be compared",
      });
      continue;
    }

    if (DEFAULT_EXPORT.test(rest)) {
      // Before DECLARATION on purpose: `export default function f` is imported
      // as `default`, and naming it `f` would compare a name no importer uses.
      exports.push({ name: "default", line });
      continue;
    }

    const declaration = DECLARATION.exec(rest);
    if (declaration) {
      exports.push({ name: declaration[1]!, line });
      if (MULTI_DECLARATOR.test(rest) && declaresSecondName(code, at + declaration[0].length)) {
        unreadable.push({
          snippet: snippetAt(rest),
          line,
          reason: "it declares more than one name in one statement — split it so every export can be named",
        });
      }
      continue;
    }

    unreadable.push({ snippet: snippetAt(rest), line, reason: "the reader recognises no export form here" });
  }

  return { exports, unreadable };
}

function snippetAt(rest: string): string {
  const firstLine = rest.split("\n")[0] ?? "";
  const text = firstLine.trim();
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

/** What a platform pair can be wrong about. */
export type PlatformPairCode =
  /** A platform spelling with no native sibling — the native build has no module at all. */
  | "missing-native"
  /** A name the platform half exports and the native half does not. */
  | "platform-only-export"
  /** A name the native half exports and the platform half does not. */
  | "native-only-export"
  /** An export statement one half spells in a form this reader refuses. */
  | "unreadable-export";

export type PlatformPairFinding = {
  readonly code: PlatformPairCode;
  /** The file the reader should open — the half the finding is about. */
  readonly file: string;
  /** 1-based line, or 1 when the finding is about the file's absence. */
  readonly line: number;
  /** The whole sentence, minus the location. */
  readonly detail: string;
};

/**
 * Compare one pair. `nativeSource` is null exactly when the sibling is missing.
 *
 * A missing sibling short-circuits: with nothing to compare against, every name
 * the platform half exports would be reported as platform-only, which is a page
 * of findings for one fact.
 */
export function comparePlatformPair(
  pair: PlatformPair,
  platformSource: string,
  nativeSource: string | null,
): PlatformPairFinding[] {
  const { platform, native } = pair;
  if (native === null || nativeSource === null) {
    return [
      {
        code: "missing-native",
        file: platform.file,
        line: 1,
        detail: `has no native sibling (${platform.base}.ts / ${platform.base}.tsx) — every platform but "${platform.platform}" resolves this import to nothing`,
      },
    ];
  }

  const findings: PlatformPairFinding[] = [];
  const platformScan = exportedNames(platformSource);
  const nativeScan = exportedNames(nativeSource);

  for (const [file, scan] of [
    [platform.file, platformScan],
    [native, nativeScan],
  ] as const) {
    for (const bad of scan.unreadable) {
      findings.push({
        code: "unreadable-export",
        file,
        line: bad.line,
        detail: `\`${bad.snippet}\` cannot be named: ${bad.reason}`,
      });
    }
  }
  // An unreadable statement makes the name set short, so a comparison run
  // beside it would invent differences. The refusal above is the whole report.
  if (findings.length > 0) return findings;

  const platformNames = new Set(platformScan.exports.map((e) => e.name));
  const nativeNames = new Set(nativeScan.exports.map((e) => e.name));

  for (const record of platformScan.exports) {
    if (nativeNames.has(record.name)) continue;
    findings.push({
      code: "platform-only-export",
      file: platform.file,
      line: record.line,
      detail: `exports "${record.name}", which ${native} does not — an importer that reaches the native spelling gets undefined`,
    });
  }
  for (const record of nativeScan.exports) {
    if (platformNames.has(record.name)) continue;
    findings.push({
      code: "native-only-export",
      file: native,
      line: record.line,
      detail: `exports "${record.name}", which ${platform.file} does not — an importer that reaches the "${platform.platform}" spelling gets undefined`,
    });
  }
  return findings;
}

/**
 * Human-readable failure report; empty string when there is nothing to report
 * so callers can short-circuit.
 */
export function formatPlatformPairReport(findings: readonly PlatformPairFinding[]): string {
  if (findings.length === 0) return "";
  const lines: string[] = [];
  lines.push(`Found ${findings.length} platform-pair problem(s).`);
  lines.push(
    "Metro serves one spelling per platform, so the halves must export the same names — a name on one side only is a runtime error on the other, and no type-check or node suite sees it.",
  );
  for (const finding of findings) {
    lines.push(`  ${finding.file}:${finding.line}  ${finding.detail}`);
  }
  return lines.join("\n");
}
