import {
  BARE_IDENTIFIER,
  type Declaration,
  declarations,
  matchingBracket,
  scannableCode,
} from "./declaration-scan";
import { annotation } from "./github-annotations";

/**
 * Where `lint:chunked-items`' trust is earned.
 *
 * THE RULE ONE DIRECTORY OVER ASSUMES THIS ONE. `check-chunked-list-items`
 * accepts `const { archivedItems } = useCollections()` as a stable reference on
 * the grounds that a provider memoizes it, and `lib/collections-context.tsx`
 * does. It reads the CALL SITE, so the day one of those arrays is recomputed
 * inside the value factory instead, every call site still passes and the bug
 * ships. The comment above `wishlistItems` is the only thing standing there
 * today, and it is the whole argument for this rule, so it is worth quoting the
 * shape of it rather than paraphrasing:
 *
 *   Memoized separately from the big `value` memo below so the array keeps a
 *   stable identity while `localItems` is unchanged.
 *
 * WHY "INSIDE THE VALUE MEMO" IS NOT GOOD ENOUGH, which is the part that is
 * easy to get wrong. The value factory IS a `useMemo`, so an array built inside
 * it looks memoized. It is — on the value memo's dependencies, and
 * `CollectionsContextValue`'s has twenty names in it. Any one of them changing
 * rebuilds every array in the factory, so a currency refresh, a theme change or
 * a realtime row arriving hands every consumer a new `wishlistItems`. A
 * consumer's `useChunkedList` window then snaps back to page one on a context
 * update that had nothing to do with its list — which is the bug that
 * reproduces for one person and for nobody else, because it depends on what
 * else the app happened to be doing.
 *
 * SO THE RULE IS ABOUT WHERE THE MEMO IS, not whether there is one: an
 * array-typed field of a context value is supplied by a binding memoized on its
 * OWN dependencies, not computed in the factory.
 *
 * WHAT COUNTS, and why this list is longer than the chunked rule's three. A
 * provider is allowed things a screen is not:
 *
 *   - `useMemo` — the narrow dependency list, which is the point.
 *   - `useState` — a row list the provider owns and sets.
 *   - `useRef` / `useConstant` — a value constructed once.
 *   - another `use*()` hook's result — a provider composing a provider.
 *   - a MODULE-LEVEL `const` — one array for the life of the process. Inside a
 *     component the same spelling is a new array per render, so the scope is
 *     the whole difference and indentation is how it is read (see
 *     `Declaration.indent` for why that signal and not a parser).
 *
 * WHAT IT DOES NOT LOOK AT. Function-valued fields, even ones returning arrays:
 * `getItemsForCollection(id)` rebuilds its result per call by design and its
 * identity question belongs to the value memo, not here. Fields spread in from
 * another object are reported rather than guessed at — a spread is exactly how
 * a field would leave this rule's sight.
 *
 * STRING BODIES ARE BLANKED, as everywhere in `declaration-scan`: this header
 * names three field names and a type, and the registry description names the
 * rule.
 */

/** The value-type suffix a provider's context type is expected to carry. */
export const CONTEXT_VALUE_SUFFIX = "ContextValue";

/** How an array-typed context field failed to prove itself memoized on its own deps. */
export type ContextArrayKind =
  /** Built by an expression inside the value factory, so it rides the factory's whole dep list. */
  | "computed-in-factory"
  /** Supplied by a name bound to something that is a new value per render. */
  | "unstable-binding"
  /** Not supplied by a named property of the factory's object — a spread, or nothing. */
  | "unsupplied";

/** One array-typed field of one context value. */
export interface ContextArrayFinding {
  /** Repo-relative path of the provider module. */
  readonly file: string;
  /** The context value type, e.g. `CollectionsContextValue`. */
  readonly valueType: string;
  /** The field, e.g. `wishlistItems`. */
  readonly field: string;
  readonly kind: ContextArrayKind;
  /** What was found instead, for the report. */
  readonly detail: string;
}

/** An array type and nothing else: `T[]`, `readonly T[]`, `Array<T>`. */
const ARRAY_TYPE = /^(?:readonly\s+)?(?:[\w$.<>,\s[\]|]*\[\]|Array<[\s\S]*>)$/;

/** A binding form a PROVIDER may supply an array from. */
const PROVIDER_HOOKS = /^(useMemo|useState|useRef|useConstant|use[A-Z][\w$]*)\s*(?:<[^;()]*>)?\s*\(/;

/**
 * The declaration of `name` that is actually in scope where the value factory
 * is, or `null` when this file binds no such name before it.
 *
 * "The first match in the file" is wrong here and `lib/collections-context.tsx`
 * is why: it spells `const { collections, items } = selectOwnedForImport(…)`
 * inside an import callback six hundred lines above the provider's own
 * `const collections = useMemo(…)`. A scan taking the first binding reported
 * two of the five fields as unstable while naming a line no consumer can see.
 *
 * So: only declarations before the factory, and of those the OUTERMOST — module
 * level or the provider body — with the last one winning a tie. Indentation is
 * the scope signal for the reason `Declaration.indent` gives.
 */
export function bindingInScope(
  bindings: readonly Declaration[],
  name: string,
  before: number,
): Declaration | null {
  const candidates = bindings.filter((d) => d.names.includes(name) && d.at < before);
  if (candidates.length === 0) return null;
  const outermost = Math.min(...candidates.map((d) => d.indent));
  return candidates.filter((d) => d.indent === outermost).at(-1) ?? null;
}

/** The body of the first `type X<suffix> = { … }` in the file, with its name. */
export function contextValueType(code: string): { name: string; body: string } | null {
  const pattern = new RegExp(`\\b(?:type|interface)\\s+(\\w*${CONTEXT_VALUE_SUFFIX})\\b[^{]*(\\{)`);
  const match = pattern.exec(code);
  if (!match) return null;
  const open = code.indexOf("{", match.index + match[1].length);
  const close = matchingBracket(code, open);
  if (close === null) return null;
  return { name: match[1], body: code.slice(open + 1, close) };
}

/**
 * Top-level fields of a type body whose type is an array and nothing else.
 *
 * Read by walking the body and skipping whatever a nested bracket opens, so a
 * field declared inside an inline object or a function signature is not
 * mistaken for a field of the value. A function returning an array is excluded
 * by the type test, not by the walk.
 */
export function arrayFields(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= body.length; i += 1) {
    const ch = body[i];
    // Angle brackets are NOT counted. `(a: number) => boolean` closes a `>`
    // that never opened, which drives the depth negative and corrupts the rest
    // of the walk — `CollectionsContextValue` declares eleven function fields
    // and the first version of this saw five of its fourteen arrays.
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if ((ch === ";" || ch === undefined) && depth === 0) {
      const member = body.slice(start, i).trim();
      start = i + 1;
      const colon = member.indexOf(":");
      if (colon === -1) continue;
      const name = member.slice(0, colon).trim().replace(/\?$/, "");
      if (!BARE_IDENTIFIER.test(name)) continue;
      const type = member.slice(colon + 1).trim();
      if (type.includes("=>")) continue;
      if (ARRAY_TYPE.test(type)) fields.push(name);
    }
  }
  return fields;
}

/** The object body of `const value = useMemo…(() => ({ … }), …)`, or `null`. */
export function valueFactoryBody(code: string): { body: string; at: number } | null {
  const match = /\bconst\s+value\s*=\s*useMemo\s*(?:<[^;()]*>)?\s*\(\s*\(\s*\)\s*=>\s*\(\s*\{/.exec(code);
  if (!match) return null;
  const open = code.lastIndexOf("{", match.index + match[0].length);
  const close = matchingBracket(code, open);
  if (close === null) return null;
  return { body: code.slice(open + 1, close), at: match.index };
}

/** How `field` is supplied at the top level of a factory object body. */
export function supplyOf(body: string, field: string): { shorthand: boolean; value: string } | null {
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= body.length; i += 1) {
    const ch = body[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if ((ch === "," && depth === 0) || i === body.length) {
      const entry = body.slice(start, i).trim();
      start = i + 1;
      if (entry === field) return { shorthand: true, value: field };
      if (entry.startsWith(`${field}:`)) {
        return { shorthand: false, value: entry.slice(field.length + 1).trim() };
      }
    }
  }
  return null;
}

/** Every array-typed field of this file's context value that is not provably memoized. */
export function findContextArrayRisks(file: string, source: string): ContextArrayFinding[] {
  const code = scannableCode(source);
  const valueType = contextValueType(code);
  if (!valueType) return [];
  const factory = valueFactoryBody(code);
  if (factory === null) return [];

  const bindings = declarations(code);
  const found: ContextArrayFinding[] = [];
  for (const field of arrayFields(valueType.body)) {
    const supply = supplyOf(factory.body, field);
    if (!supply) {
      found.push({
        file,
        valueType: valueType.name,
        field,
        kind: "unsupplied",
        detail: "no named property of the value factory supplies it — a spread would hide exactly this",
      });
      continue;
    }
    if (!BARE_IDENTIFIER.test(supply.value)) {
      found.push({
        file,
        valueType: valueType.name,
        field,
        kind: "computed-in-factory",
        detail: `built in the factory as \`${supply.value.replace(/\s+/g, " ").slice(0, 60)}\`, so it rides the value memo's whole dependency list`,
      });
      continue;
    }
    const binding = bindingInScope(bindings, supply.value, factory.at);
    if (binding && (PROVIDER_HOOKS.test(binding.rhs) || (binding.indent === 0 && binding.rhs.startsWith("[")))) {
      continue;
    }
    found.push({
      file,
      valueType: valueType.name,
      field,
      kind: "unstable-binding",
      detail: binding
        ? `\`${supply.value}\` is bound to \`${binding.rhs.slice(0, 50)}\`, which is a new value every render`
        : `\`${supply.value}\` is not bound in this file, so its identity cannot be read here`,
    });
  }
  return found;
}

/** Human-readable failure report; empty string when there is nothing to say. */
export function formatContextArrayReport(findings: readonly ContextArrayFinding[]): string {
  if (findings.length === 0) return "";
  const lines = [
    `Found ${findings.length} array-typed context field(s) that are not memoized on their own dependencies.`,
    `The value factory is itself a useMemo, so an array built inside it is memoized on the FACTORY's dependency list — twenty names, for CollectionsContextValue. Any of them changing hands every consumer a new array, and a consumer's useChunkedList window snaps back to page one on a context update that had nothing to do with its list.`,
    `Lift it to its own \`useMemo\` beside the others, on the narrowest dependencies that actually change it.`,
  ];
  for (const f of findings) {
    lines.push(`  ${f.file}  ${f.valueType}.${f.field} — ${f.detail}`);
  }
  return lines.join("\n");
}

/** The same findings as GitHub Actions annotations. */
export function contextArrayAnnotations(findings: readonly ContextArrayFinding[]): string[] {
  return findings.map((f) =>
    annotation("error", `${f.valueType}.${f.field} — ${f.detail}. Give it its own useMemo on its own dependencies.`, {
      file: f.file,
      title: "Context array not memoized on its own dependencies",
    }),
  );
}
