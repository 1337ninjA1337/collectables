/**
 * A declaration, pinned from source, for the facts a case cannot call.
 *
 * Three suites reached for a module's own text in one week, each to say the
 * same KIND of thing: `arguedFloor`'s reason is a required parameter,
 * `localesDeclaring`'s first parameter is an index and not a source string, and
 * `<DangerIconButton>`'s `accessibilityLabel` is required rather than
 * optional-with-fallback. None of the three is callable — a missing argument is
 * a compile error, so the case that would prove it is a case that does not
 * build — and each had written its own read, its own regex and its own idea of
 * what "required" means.
 *
 * The regexes were the part worth sharing, because two of the three were half
 * the rule. `/because: string,?\s*\)/` matches the required form and says
 * nothing about the optional one; it happens to be safe (`because?: string`
 * does not contain `because: string`) and it is safe by accident rather than by
 * statement, and the one site that DID assert both directions is the one that
 * had been bitten. Both directions are asserted here for every caller.
 *
 * WHAT THIS IS NOT. It is not a parser. It reads a function's parameter list
 * between balanced parentheses and a type's members between balanced braces,
 * skipping over string literals so a `")"` default or an `"a,b"` type cannot
 * move a depth counter. That is enough for every declaration in this tree and
 * it is not enough for, say, a callback parameter — `(value: string) => void`
 * closes a bracket the splitter never opened. A template-literal type with an
 * interpolation in it is the other known gap: `endOfString` stops at the first
 * unescaped backtick and does not descend into `${…}`, so a quote nested there
 * would end the literal early. Neither shape exists in this tree.
 *
 * WHERE IT CANNOT ANSWER, IT REFUSES. Every ambiguity below turns into a throw
 * naming what it could not read, rather than into a confident answer about the
 * wrong declaration:
 *
 *   - a name declared more than once (an overload set, a merged interface),
 *     where the first hit is a signature the caller did not mean;
 *   - a member asked for without saying which type it belongs to — the
 *     `declaration` option is required for exactly this reason, because a
 *     module with two types and a same-named member would otherwise answer
 *     from whichever one came first;
 *   - a parameter list whose brackets the splitter cannot balance.
 *
 * A signature that shape should be pinned by hand with a comment saying why.
 *
 * Comments are stripped before every read, so a doc comment above the
 * declaration may go on describing the shape it once had — or, more usefully,
 * may quote the shape this is asserting without becoming the thing that
 * satisfies it.
 */

import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./repo-file";

/** One read per module per process; nothing here writes to the repository. */
const cache = new Map<string, string>();

/**
 * A module's source with comments removed, by repo-relative path.
 *
 * Deliberately NOT whitespace-flattened, unlike `suiteText`: a property
 * declaration is matched with `^…$` against its own line, and flattening would
 * take that anchor away. Callers wanting flattening can do it; a caller wanting
 * the line cannot undo it.
 */
export function declaredSource(relative: string): string {
  const cached = cache.get(relative);
  if (cached !== undefined) return cached;
  const source = stripComments(readRepoFile(relative));
  cache.set(relative, source);
  return source;
}

/**
 * The string delimiters a declaration can contain.
 *
 * Comments are gone by the time anything here reads, so the only quote left in
 * a scanned region is a real literal: `"log" | "error"` in a `Pick<>`, an
 * `"a,b"` string-literal type, a `")"` default. Each of those carries
 * characters the depth counters below balance on, and each means nothing there.
 */
const QUOTES = new Set(['"', "'", "`"]);

/**
 * The index just past the string literal opening at `from`, escapes included.
 *
 * Scanning is always local — from a declaration's opening bracket to its
 * balanced close — rather than over a whole module, because an apostrophe in a
 * JSX text node is not a literal and would otherwise mask the rest of a `.tsx`
 * file. Nothing here reads past the declaration it was asked about.
 */
function endOfString(text: string, from: number): number {
  const quote = text[from];
  for (let i = from + 1; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/** Every index at which `needle` occurs, so "declared twice" is answerable. */
function occurrences(source: string, needle: string): readonly number[] {
  const found: number[] = [];
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1))
    found.push(at);
  return found;
}

/**
 * The text between `source`'s balanced `open`/`close` pair starting at `from`.
 *
 * `from` is the index of the opening bracket. Returns null when the pair never
 * closes, which for well-formed source means only that a quote was left open —
 * and which callers report rather than paper over.
 */
function balanced(
  source: string,
  from: number,
  open: string,
  close: string,
): string | null {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (QUOTES.has(char)) {
      i = endOfString(source, i) - 1;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(from + 1, i);
    }
  }
  return null;
}

/**
 * The text between a function's parentheses, or null when it has no such
 * declaration.
 *
 * Balanced on parentheses so a default value with a call in it (`= resolve()`)
 * does not end the list early, and quote-aware so a `")"` default does not
 * either. Exported because the shape of "no such function" is a thing a case
 * may want to assert directly.
 *
 * Throws when the module declares the name more than once: an overload set's
 * first signature is not the implementation's, and answering from it would be a
 * confident wrong answer about a declaration the caller did not mean.
 */
export function parameterList(source: string, fn: string): string | null {
  const declarations = occurrences(source, `function ${fn}(`);
  assert.ok(
    declarations.length <= 1,
    `declared-shape: ${fn} is declared ${String(declarations.length)} times (an overload set, or a local shadowing an export) — this reads the first one, which is not necessarily the one you mean, so pin it by hand`,
  );
  const start = declarations[0];
  if (start === undefined) return null;
  const list = balanced(source, source.indexOf("(", start), "(", ")");
  assert.ok(
    list !== null,
    `declared-shape: ${fn}'s parameter list never closes — an unterminated string literal in the signature is the only way this happens`,
  );
  return list;
}

/**
 * Top-level commas only, so `Pick<Console, "log">` stays one parameter.
 *
 * Four bracket kinds and the string literals between them. A list the counter
 * cannot balance — `(value: string) => void` closes a `>` that was never
 * opened — is refused rather than split into whatever the negative depth
 * produced.
 */
function splitParameters(list: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if (QUOTES.has(char)) {
      const end = endOfString(list, i);
      current += list.slice(i, end);
      i = end - 1;
      continue;
    }
    if (char === "<" || char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === ">" || char === "}" || char === "]" || char === ")")
      depth -= 1;
    assert.ok(
      depth >= 0,
      `declared-shape: cannot read the parameter list "${list.trim()}" — a type closing a bracket it never opened (an arrow type such as \`=> void\`) is out of scope, so pin this signature by hand`,
    );
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/**
 * `fn`'s `name` parameter is declared, required, and typed `type`.
 *
 * Three claims, because the interesting failure is different for each: the
 * parameter renamed away, the parameter made optional, and the parameter
 * retyped to something that lets the shape back in. `at` pins its position when
 * the position is the point — `localesDeclaring(declarations, …)` is a rule
 * about what the function is HANDED, and a second parameter of the same type
 * would satisfy a presence check while changing nothing.
 *
 * `why` is required and is the message: a case that fails here fails on someone
 * else's edit, and "expected /x/ to match" tells them the regex and not the
 * reason.
 */
export function assertRequiredParameter(options: {
  readonly module: string;
  readonly fn: string;
  readonly name: string;
  readonly type: string;
  /** Zero-based position, when the position is part of the rule. */
  readonly at?: number;
  readonly why: string;
}): void {
  const { module, fn, name, type, at, why } = options;
  const list = parameterList(declaredSource(module), fn);
  assert.ok(
    list !== null,
    `${module} declares no function ${fn} — the rule "${why}" is pinned to a signature that is not there`,
  );
  const parameters = splitParameters(list);
  const found = parameters.findIndex((parameter) =>
    new RegExp(`^${name}\\s*:`).test(parameter),
  );
  assert.ok(
    !parameters.some((parameter) => new RegExp(`^${name}\\s*\\?\\s*:`).test(parameter)),
    `${module}: ${fn}'s ${name} became optional — ${why}`,
  );
  assert.ok(found >= 0, `${module}: ${fn} no longer takes ${name} — ${why}`);
  assert.match(
    parameters[found],
    new RegExp(`^${name}\\s*:\\s*${type}\\s*(=|$)`),
    `${module}: ${fn}'s ${name} is no longer ${type} — ${why}`,
  );
  if (at !== undefined) {
    assert.equal(
      found,
      at,
      `${module}: ${fn}'s ${name} moved to position ${String(found)} — ${why}`,
    );
  }
}

/**
 * The members of one named type or interface, as source text.
 *
 * Exported for the same reason `parameterList` is: "the module declares no such
 * type" is a fact a case may want to state on its own, and a caller reading two
 * members of one type should not pay for two scans.
 *
 * Throws when the name is declared twice — two `interface` blocks merge in
 * TypeScript, so this is legal source that a first-hit read answers half of.
 */
export function declarationBody(source: string, declaration: string): string | null {
  const openings = [
    ...occurrences(source, `type ${declaration} = {`),
    ...occurrences(source, `interface ${declaration} {`),
  ];
  assert.ok(
    openings.length <= 1,
    `declared-shape: ${declaration} is declared ${String(openings.length)} times (merged interfaces, most likely) — its members are spread across blocks this reads only the first of, so pin them by hand`,
  );
  const start = openings[0];
  if (start === undefined) return null;
  const body = balanced(source, source.indexOf("{", start), "{", "}");
  assert.ok(
    body !== null,
    `declared-shape: ${declaration}'s body never closes — an unterminated string literal in the declaration is the only way this happens`,
  );
  return body;
}

/**
 * A type's `name` member is declared, required, and typed `type`.
 *
 * The same rule one level over, for the shape a props type has. Matched against
 * its own line — a member declaration is one line in every type in this tree,
 * and a regex that ignored line boundaries would find the member of a
 * neighbouring type and call the question answered.
 *
 * `declaration` names that type and is REQUIRED, which is the whole difference
 * from a bare module-wide search: `type Props` and `type Row` can both carry a
 * `label`, one required and one optional, and a module-wide read answers from
 * whichever the module happens to declare first. Naming the type costs the
 * caller four words and is the difference between a claim about a shape and a
 * claim about a file.
 */
export function assertRequiredMember(options: {
  readonly module: string;
  readonly declaration: string;
  readonly name: string;
  readonly type: string;
  readonly why: string;
}): void {
  const { module, declaration, name, type, why } = options;
  const body = declarationBody(declaredSource(module), declaration);
  assert.ok(
    body !== null,
    `${module} declares no type ${declaration} — the rule "${why}" is pinned to a shape that is not there`,
  );
  assert.doesNotMatch(
    body,
    new RegExp(`^\\s*(readonly\\s+)?${name}\\s*\\?\\s*:`, "m"),
    `${module}: ${declaration}'s ${name} became optional — ${why}`,
  );
  assert.match(
    body,
    new RegExp(`^\\s*(readonly\\s+)?${name}\\s*:\\s*${type}\\s*;`, "m"),
    `${module}: ${declaration}'s ${name} is no longer a required ${type} — ${why}`,
  );
}
