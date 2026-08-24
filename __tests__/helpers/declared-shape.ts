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
 * WHAT THIS IS NOT. It is not a parser. The parameter list is taken between a
 * function's opening parenthesis and its balanced closing one, and split on
 * top-level commas — enough for every signature in this tree and not enough for
 * a parameter whose type contains a parenthesis (a callback type). A signature
 * that shape should be pinned by hand with a comment saying why, rather than
 * quietly matched by a splitter that would get it wrong.
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
 * The text between a function's parentheses, or null when it has no such
 * declaration.
 *
 * Balanced on parentheses so a default value with a call in it (`= resolve()`)
 * does not end the list early. Exported because the shape of "no such function"
 * is a thing a case may want to assert directly.
 */
export function parameterList(source: string, fn: string): string | null {
  const start = source.indexOf(`function ${fn}(`);
  if (start < 0) return null;
  const open = source.indexOf("(", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Top-level commas only, so `Pick<Console, "log">` stays one parameter. */
function splitParameters(list: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "<" || char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === ">" || char === "}" || char === "]" || char === ")")
      depth -= 1;
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
 * A type's `name` member is declared, required, and typed `type`.
 *
 * The same rule one level over, for the shape a props type has. Matched against
 * its own line — a member declaration is one line in every type in this tree,
 * and a regex that ignored line boundaries would find the member of a
 * neighbouring type and call the question answered.
 */
export function assertRequiredMember(options: {
  readonly module: string;
  readonly name: string;
  readonly type: string;
  readonly why: string;
}): void {
  const { module, name, type, why } = options;
  const source = declaredSource(module);
  assert.doesNotMatch(
    source,
    new RegExp(`^\\s*(readonly\\s+)?${name}\\s*\\?\\s*:`, "m"),
    `${module}: ${name} became optional — ${why}`,
  );
  assert.match(
    source,
    new RegExp(`^\\s*(readonly\\s+)?${name}\\s*:\\s*${type}\\s*;`, "m"),
    `${module}: ${name} is no longer a required ${type} — ${why}`,
  );
}
