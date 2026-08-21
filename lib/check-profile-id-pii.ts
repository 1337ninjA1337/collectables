import { stripComments } from "@/lib/strip-comments";

/**
 * Scanner behind `scripts/check-profile-id-pii.ts` (`npm run lint:profile-id-pii`):
 * flags an email address flowing into a profile's PUBLIC IDENTIFIER.
 *
 * Written the moment the count reached zero, which is the only time a rule
 * like this can be written — the same pattern `check-a11y-jsx`'s `no_role`
 * followed. On 2026-08-21 `normalizeProfile` derived `publicId` from
 * `profile.email` whenever a profile carried no ID, no username and no display
 * name, and that branch was reachable: `coerceProfileRow` turns a NULL column
 * into `""`, so a sparse cloud row arrived with the address as its only
 * non-empty name and came out as `ada-lovelace-example-com`. `publicId` is the
 * identifier the app invites people to share so others can find them, and
 * `toProfileRow` writes it back to the cloud, so the address stuck. The term
 * was removed; this stops the next one.
 *
 * WHICH FIELDS, and why not all of them.
 *
 * `publicId` / `public_id` and `username` are covered: both are identifiers a
 * person shares, is searched by, and does not choose at sign-up.
 *
 * `displayName` is deliberately NOT covered, and the reason is the interesting
 * half. Deriving a display name from an email's local part is intended
 * behaviour here — somebody signing up as `ada@example.com` should be called
 * "ada" rather than "Collector", and `resolveFallbackIdentity` does exactly
 * that. A rule covering `displayName` would fire on live, reviewed code, and a
 * rule that fires on correct code is one somebody exempts and then ignores.
 *
 * WHAT COUNTS AS A REFERENCE, and the gap it leaves open on purpose.
 *
 * A value expression naming `email` as a whole word — `profile.email`,
 * `user.email`, `r.email`. It does NOT match `emailName`, and that is the
 * seam: the local part of an address DOES legitimately seed a username, via a
 * named intermediate (`emailName`, `slugSeed`) that somebody had to write down
 * and that a reviewer can see. The rule's real subject is a raw address
 * reaching an identifier inline, where nobody has weighed what part of it
 * survives — which is exactly the shape the bug had.
 *
 * Pure module: no filesystem access — the CLI walks the tree and hands sources
 * over, so the matcher is unit-testable under `node --test`.
 */

/** A profile-identifier field an email address must not reach inline. */
export const GUARDED_FIELDS = ["publicId", "public_id", "username"] as const;

export type ProfileIdPiiMatch = {
  readonly file: string;
  readonly line: number;
  /** The field the value was being assigned to. */
  readonly field: string;
  /** The offending value expression, trimmed and flattened for the report. */
  readonly snippet: string;
};

/**
 * The value expression that follows a `field:` at `start`, read to its end.
 *
 * Brace- and quote-aware rather than "up to the next comma", because the
 * offending shapes are exactly the ones a naive scan truncates: a value
 * spanning several lines, and a call whose own arguments are comma-separated.
 * Stops at a `,` `;` or a closing bracket seen at depth zero, which is where
 * an object property ends.
 */
function readValueExpression(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  let index = start;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if ((char === "," || char === ";") && depth === 0) break;
  }
  return source.slice(start, index);
}

/** `email` as a whole word — so `emailName` and `userEmail` do not match. */
const EMAIL_REFERENCE = /(?:^|[^A-Za-z0-9_])email(?![A-Za-z0-9_])/;

/**
 * Scan one source for an email reaching a guarded identifier field.
 *
 * Comments are stripped so prose about the rule — this module's own doc block,
 * and the failure sentence the CLI prints — cannot be a finding.
 */
export function findProfileIdPii(
  file: string,
  source: string,
): ProfileIdPiiMatch[] {
  const matches: ProfileIdPiiMatch[] = [];
  const stripped = stripComments(source);
  for (const field of GUARDED_FIELDS) {
    const opener = new RegExp(`(?:^|[^A-Za-z0-9_])(${field})\\s*:`, "g");
    let m: RegExpExecArray | null;
    while ((m = opener.exec(stripped)) !== null) {
      const value = readValueExpression(stripped, m.index + m[0].length);
      if (!EMAIL_REFERENCE.test(value)) continue;
      matches.push({
        file,
        line: stripped.slice(0, m.index).split("\n").length,
        field,
        snippet: value.replace(/\s+/g, " ").trim().slice(0, 120),
      });
    }
  }
  return matches.sort((a, b) => a.line - b.line);
}

/** The report, naming each site and what to do instead. */
export function formatProfileIdPiiReport(
  matches: readonly ProfileIdPiiMatch[],
): string {
  const lines = [
    `check-profile-id-pii: ${matches.length} place(s) where an email address reaches a public profile identifier.`,
    "",
    "publicId and username are shared, searched and written back to the cloud row,",
    "so an address that reaches one sticks to the profile permanently. Derive the",
    "identifier from a name, or from a NAMED intermediate that says which part of",
    "the address survives - an inline reference means nobody weighed that.",
    "",
  ];
  for (const { file, line, field, snippet } of matches) {
    lines.push(`  ${file}:${line}  ${field}: ${snippet}`);
  }
  return lines.join("\n");
}
