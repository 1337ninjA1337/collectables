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
 * WHAT IT COULD NOT READ, AND NOW SAYS SO. The first version matched one
 * shape of each half — a `*ContextValue` type and
 * `const value = useMemo(() => ({ … }))` — and returned NO FINDINGS for
 * anything else. Three of the eleven providers in `lib/` were anything else:
 * `lib/auth-context.tsx` and `lib/realtime-status-context.tsx` write a
 * block-bodied factory with a `return`, and `lib/toast-context.tsx` calls its
 * value `api` and its type `ToastApi`. A fourth, `lib/i18n-context.tsx`,
 * spells the whole value type inline in its `createContext<…>` call and has
 * had an array field in it the whole time. Both readers are widened — the JSX
 * `value={…}` names the binding rather than a magic name, a block body's first
 * top-level `return` is read, and a `createContext` type argument counts as a
 * value type — and `readProvider` now returns one of THREE answers where there
 * used to be two: checked, could not read, or no context value here. The
 * middle one is a finding.
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
  | "unsupplied"
  /** The value type is here and its factory is not readable, so the rule has no opinion at all. */
  | "unreadable-factory";

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

/**
 * An array type and nothing else: `T[]`, `readonly T[]`, `Array<T>`.
 *
 * The element may be written inline — `lib/i18n-context.tsx` declares
 * `languageOptions: { code: AppLanguage; label: string }[]`, which is as much
 * an array field as `Collection[]` is and was read as "not an array" by a
 * character class that had no `{` in it. Function types never reach here:
 * `arrayFields` drops anything containing `=>` first, which is the exclusion
 * that matters and the one this pattern must not be asked to make.
 */
const ARRAY_TYPE = /^(?:readonly\s+)?(?:[\w$.<>,;\s[\]|{}:'"&?-]*\[\]|Array<[\s\S]*>)$/;

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

/** Index of the `>` closing the `<` at `open`, or `null` when unterminated. */
export function matchingAngle(code: string, open: number): number | null {
  let angles = 0;
  let brackets = 0;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{" || ch === "[" || ch === "(") brackets += 1;
    else if (ch === "}" || ch === "]" || ch === ")") brackets -= 1;
    else if (brackets === 0 && ch === "<") angles += 1;
    // `=>` is not a closing angle, and an arrow is the commonest thing inside
    // a context value's type argument.
    else if (brackets === 0 && ch === ">" && code[i - 1] !== "=") {
      angles -= 1;
      if (angles === 0) return i;
    }
  }
  return null;
}

/** Members of a top-level union, so `{ a: "x" | "y" } | null` splits into two and not three. */
export function unionMembers(type: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= type.length; i += 1) {
    const ch = type[i];
    if (ch === "{" || ch === "[" || ch === "(" || ch === "<") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")" || (ch === ">" && type[i - 1] !== "=")) depth -= 1;
    else if ((ch === "|" && depth === 0) || i === type.length) {
      const member = type.slice(start, i).trim();
      start = i + 1;
      if (member) members.push(member);
    }
  }
  return members;
}

/** The body of the first `type X<suffix> = { … }` in the file, with its name. */
function namedValueType(code: string): { name: string; body: string } | null {
  const pattern = new RegExp(`\\b(?:type|interface)\\s+(\\w*${CONTEXT_VALUE_SUFFIX})\\b[^{]*(\\{)`);
  const match = pattern.exec(code);
  if (!match) return null;
  const open = code.indexOf("{", match.index + match[1].length);
  const close = matchingBracket(code, open);
  if (close === null) return null;
  return { name: match[1], body: code.slice(open + 1, close) };
}

/** The body of `type X = { … }` or `interface X { … }` declared in this file. */
function declaredTypeBody(code: string, name: string): string | null {
  const pattern = new RegExp(`\\b(?:type|interface)\\s+${name}\\b[^{]*(\\{)`);
  const match = pattern.exec(code);
  if (!match) return null;
  const open = code.indexOf("{", match.index);
  const close = matchingBracket(code, open);
  return close === null ? null : code.slice(open + 1, close);
}

/**
 * The type argument of `createContext<…>`, for a provider that never spells
 * `ContextValue`.
 *
 * `lib/i18n-context.tsx` writes the whole shape inline in the `createContext`
 * call and `lib/toast-context.tsx` calls its type `ToastApi`; neither matches
 * the suffix, and for the life of this rule both read as "nothing here" —
 * which is the same answer it gives for a file that genuinely holds no
 * context, and `languageOptions: { code; label }[]` was sitting in the first
 * of them the whole time. The `| null` every one of these carries is dropped
 * because it is the "outside the provider" case and says nothing about the
 * value's shape.
 */
function createContextValueType(code: string): { name: string; body: string } | null {
  const match = /\b(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?createContext\s*</.exec(code);
  if (!match) return null;
  const openAngle = match.index + match[0].length - 1;
  const closeAngle = matchingAngle(code, openAngle);
  if (closeAngle === null) return null;
  const shapes = unionMembers(code.slice(openAngle + 1, closeAngle)).filter(
    (member) => member !== "null" && member !== "undefined",
  );
  if (shapes.length !== 1) return null;
  const [shape] = shapes;
  const name = match[1] ?? "createContext";
  if (shape.startsWith("{")) {
    const open = code.indexOf("{", openAngle);
    const close = matchingBracket(code, open);
    return close === null ? null : { name, body: code.slice(open + 1, close) };
  }
  if (!BARE_IDENTIFIER.test(shape)) return null;
  const body = declaredTypeBody(code, shape);
  return body === null ? null : { name: shape, body };
}

/**
 * This file's context value type, by either of the two spellings in the tree.
 *
 * The named `*ContextValue` first, because eight of the eleven providers use
 * it and it is the convention; the `createContext` type argument second, for
 * the three that do not.
 */
export function contextValueType(code: string): { name: string; body: string } | null {
  return namedValueType(code) ?? createContextValueType(code);
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

/**
 * The name the provider hands to its own `<X.Provider value={…}>`.
 *
 * "The binding called `value`" was the first version of this and it was a
 * magic name: `lib/toast-context.tsx` calls its one `api`, so the rule read
 * the provider that owns every toast in the app as having no factory. The JSX
 * is the honest statement of which binding is the context value, and every
 * provider in this tree has to write it.
 */
export function providerValueName(code: string): string | null {
  const match = /<\s*[\w$.]*Provider\s+value=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(code);
  return match ? match[1] : null;
}

/**
 * The object a block-bodied factory returns, at the block's OWN top level.
 *
 * The first top-level `return` and not the last: `lib/auth-context.tsx`
 * returns its value object first and then has nine more `return`s inside the
 * async methods it declares, every one of them a different object. Depth is
 * what tells them apart, and a top-level `return` of anything other than an
 * object literal is `null` here — an unreadable factory, which the caller
 * reports rather than guesses at.
 */
export function returnedObjectBody(block: string): string | null {
  let depth = 0;
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    else if (depth === 0 && block.startsWith("return", i) && !/[\w$]/.test(block[i - 1] ?? "") && !/[\w$]/.test(block[i + 6] ?? "")) {
      const open = /^\s*\(?\s*\{/.exec(block.slice(i + 6));
      if (!open) return null;
      const at = i + 6 + open[0].length - 1;
      const close = matchingBracket(block, at);
      return close === null ? null : block.slice(at + 1, close);
    }
  }
  return null;
}

/**
 * The object body of the provider's value factory, in either arrow form.
 *
 * `() => ({ … })` is the common one; `() => { return { … }; }` is what
 * `lib/auth-context.tsx` and `lib/realtime-status-context.tsx` write, and for
 * the life of this rule a block body read as "no factory here".
 */
export function valueFactoryBody(code: string): { body: string; at: number } | null {
  const name = providerValueName(code);
  if (name === null) return null;
  const head = new RegExp(
    `\\bconst\\s+${name}\\s*=\\s*useMemo\\s*(?:<[^;()]*>)?\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*`,
  ).exec(code);
  if (!head) return null;
  const after = head.index + head[0].length;
  const inline = /^\(\s*\{/.exec(code.slice(after));
  if (inline) {
    const open = after + inline[0].length - 1;
    const close = matchingBracket(code, open);
    return close === null ? null : { body: code.slice(open + 1, close), at: head.index };
  }
  if (code[after] === "{") {
    const close = matchingBracket(code, after);
    if (close === null) return null;
    const body = returnedObjectBody(code.slice(after + 1, close));
    return body === null ? null : { body, at: head.index };
  }
  return null;
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

/** What a module turned out to be, from this rule's point of view. */
export type ProviderVerdict =
  /** No context value type here at all, so the rule has no subject — not a hole. */
  | "no-context-value"
  /** A value type, and a factory this rule cannot read. Reported, not assumed fine. */
  | "unreadable-factory"
  /** A value type and a factory, both read: every array field below has a verdict. */
  | "read";

/** One provider module, read. */
export interface ProviderReading {
  /** Repo-relative path of the module. */
  readonly file: string;
  readonly verdict: ProviderVerdict;
  /** The context value type's name, or `null` when there is none. */
  readonly valueType: string | null;
  /** The array-typed fields of that value, which is the rule's subject here. */
  readonly fields: readonly string[];
  readonly findings: readonly ContextArrayFinding[];
}

/**
 * Read one provider, and SAY WHICH OF THE THREE ANSWERS this is.
 *
 * `findContextArrayRisks` returned `[]` for "there is nothing of mine here"
 * and for "I could not read this", and those are not the same answer. Three
 * of the eleven providers in `lib/` were the second one — two with a
 * block-bodied factory, one calling its value `api` — and the rule reported
 * the same clean run for them as for the eight it actually checked. Both
 * readers have since been widened, so the tree has no unreadable provider
 * today; what this type adds is that the next one is a FINDING rather than a
 * silent pass, which is the `unusedUncountedExcuses` shape this repository has
 * taken three times: a check with no stated subject is green forever.
 *
 * An unreadable factory is a finding whether or not the value declares an
 * array field, and that is the deliberate half. A rule that only complained
 * when it could see something worth complaining about would be deciding the
 * question it just said it could not read.
 */
export function readProvider(file: string, source: string): ProviderReading {
  const code = scannableCode(source);
  const valueType = contextValueType(code);
  if (!valueType) {
    return { file, verdict: "no-context-value", valueType: null, fields: [], findings: [] };
  }
  const fields = arrayFields(valueType.body);
  const factory = valueFactoryBody(code);
  if (factory === null) {
    const detail = providerValueName(code) === null
      ? "no `<X.Provider value={…}>` names the context value, so the factory cannot be found"
      : `\`${providerValueName(code)}\` is not a \`useMemo\` this rule can read, so none of its fields have been checked`;
    return {
      file,
      verdict: "unreadable-factory",
      valueType: valueType.name,
      fields,
      findings: [
        {
          file,
          valueType: valueType.name,
          field: fields.length === 0 ? "(the whole value)" : fields.join(", "),
          kind: "unreadable-factory",
          detail,
        },
      ],
    };
  }
  return {
    file,
    verdict: "read",
    valueType: valueType.name,
    fields,
    findings: fieldFindings(file, valueType, factory, code),
  };
}

/** Every array-typed field of this file's context value that is not provably memoized. */
export function findContextArrayRisks(file: string, source: string): ContextArrayFinding[] {
  return [...readProvider(file, source).findings];
}

function fieldFindings(
  file: string,
  valueType: { name: string; body: string },
  factory: { body: string; at: number },
  code: string,
): ContextArrayFinding[] {
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
  const unreadable = findings.filter((f) => f.kind === "unreadable-factory");
  if (unreadable.length === findings.length) {
    return [
      `Found ${unreadable.length} provider(s) whose value factory this rule cannot read, so nothing in them has been checked.`,
      `A provider the rule cannot read is reported rather than passed: returning "no findings" for it is the same answer as for a module that holds no context at all, and those are different answers.`,
      `Either give the factory a shape the reader knows — \`const value = useMemo(() => ({ … }), deps)\` or a block body whose first top-level \`return\` is the object — or widen \`valueFactoryBody\` on purpose.`,
      ...unreadable.map((f) => `  ${f.file}  ${f.valueType} (${f.field}) — ${f.detail}`),
    ].join("\n");
  }
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
