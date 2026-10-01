/**
 * What "this screen uses this token" is worth when an import satisfies it.
 *
 * `design-tokens.test.ts` proves adoption one token at a time:
 *
 *   assert.match(src, /\bAMBER_ACCENT\b/);
 *
 * against the file's whole text — and a file's whole text includes the import
 * line that names the token. So the claim is satisfied by the import alone,
 * and on 2026-10-01 three of them were: `MUTED` and `SUCCESS_GREEN_2` in
 * `app/item/[id].tsx`, `BORDER_7` in `app/collection/[id].tsx`. All three
 * screens imported the token and used it nowhere. They were found by deleting
 * 101 unused imports for an unrelated reason, which is not a way of finding
 * things.
 *
 * There are 462 of these claims. Rewriting each one is 462 edits to a file
 * nobody wants to re-read; the shape this repository takes instead is a case
 * that derives the property from the suite's own source, the way
 * `verify-gate-script.test.ts` reads its step list out of ci.yml. A claim that
 * only the import satisfies is then a finding, whichever of the 462 it is,
 * and a 463rd joins the check by being written.
 */

/** One `assert.match(src, /TOKEN/)` inside one screen's adoption case. */
export interface TokenClaim {
  /** Repo-relative path of the screen or component the case is about. */
  readonly file: string;
  /** The design token the case says it uses. */
  readonly token: string;
}

/** A token name and nothing else, once the `\b` guards are taken off. */
const TOKEN_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Import statements, so what is left is the code.
 *
 * Non-greedy from an `import` at the start of a line to the first `from "…";`
 * that ends one, which is what makes a multi-line specifier list one match. A
 * side-effect import (`import "./polyfill";`) is not matched and does not
 * need to be: it binds no name, so no claim can rest on it.
 */
export function withoutImports(source: string): string {
  return source.replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, "");
}

/**
 * Every token claim in a suite, read out of its source.
 *
 * The case titles are the index: `it("<path> imports tokens from
 * lib/design-tokens …")`. An `assert.match(src, /…/)` whose pattern is not a
 * bare token name is left alone — those assert a usage shape
 * (`color:\s*theme\.text`), which an import cannot satisfy.
 */
export function tokenClaims(suiteSource: string): TokenClaim[] {
  const claims: TokenClaim[] = [];
  for (const block of suiteSource.matchAll(
    /it\("([^"]+?) imports tokens from lib\/design-tokens[^"]*",([\s\S]*?)\n  \}\);/g,
  )) {
    const file = block[1].trim();
    for (const match of block[2].matchAll(/assert\.match\(src,\s*\/([^/]+)\/\)/g)) {
      const token = match[1].replace(/\\b/g, "");
      if (TOKEN_NAME.test(token)) claims.push({ file, token });
    }
  }
  return claims;
}

/** The claims whose only evidence is the import line — the vacuous ones. */
export function claimsOnlyImportsSatisfy(
  claims: readonly TokenClaim[],
  read: (file: string) => string,
): string[] {
  const bodies = new Map<string, string>();
  const vacuous: string[] = [];
  for (const claim of claims) {
    let body = bodies.get(claim.file);
    if (body === undefined) {
      body = withoutImports(read(claim.file));
      bodies.set(claim.file, body);
    }
    if (!new RegExp(`\\b${claim.token}\\b`).test(body)) {
      vacuous.push(`${claim.file} claims ${claim.token} and only its import line says so`);
    }
  }
  return vacuous;
}
