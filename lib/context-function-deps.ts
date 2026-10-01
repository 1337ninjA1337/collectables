import {
  bindingInScope,
  contextValueType,
  functionFields,
  supplyOf,
  valueFactoryBody,
} from "./check-context-array-stability";
import { BARE_IDENTIFIER, declarations, matchingBracket, scannableCode } from "./declaration-scan";
import { annotation } from "./github-annotations";

/**
 * The other half of the context-value identity question, and the half that can
 * do WORK.
 *
 * `lint:context-arrays` holds array-typed fields to their own memo and leaves
 * function fields alone on purpose: `getItemsForCollection(id)` rebuilds its
 * result per call by design, so there is nothing to memoize about the result.
 * What that argument skips is the FUNCTION's own identity. Fifty-eight of the
 * eighty-four function fields in this tree are built inside their value
 * factory — thirty-three of `CollectionsContextValue`'s thirty-four — so each
 * of them is a new closure every time the factory recomputes, on a dependency
 * list with twenty names in it.
 *
 * FOR A `useMemo` OR A `useCallback` THAT IS A COST. The consumer recomputes
 * something it did not need to recompute, on a context update that had nothing
 * to do with it. Forty-three consumer dependency arrays in `app/`,
 * `components/` and `lib/` name one of these functions, and most of them are
 * this case.
 *
 * FOR A `useEffect` IT IS A BUG WITH AN INCIDENT BEHIND IT. An effect re-fires,
 * and an effect does things: a network write, a toast, a navigation.
 * `app/collection/[id].tsx` saves a shared collection for a user who opened it
 * by link, and the comment above that effect is the whole reason this module
 * exists:
 *
 *   that was the iOS Safari crash path: each attempt mounted a toast and
 *   queued a network write, blowing the memory budget until Safari aborted
 *   with "A problem repeatedly occurred".
 *
 * It carries a per-id ref guard now. Nothing stops the next effect from being
 * written without one, and nothing told anybody the hazard was a class rather
 * than one screen's accident.
 *
 * SO THE RULE IS: a `useEffect` dependency array may not name a factory-built
 * context function field unless the pairing is SANCTIONED here with the reason
 * re-firing is safe. No threshold, because a threshold would be invented: a
 * provider's factory dep list is the real measure of how often these change,
 * and it ranges from two names (`I18nProvider`) to twenty
 * (`CollectionsProvider`) with nothing principled in between. An argued list
 * says which is which in the place the next person reads.
 */

/** A binding form that keeps one identity across a factory recompute. */
const STABLE_BINDING = /^(useCallback|useMemo|useRef|useConstant)\s*(?:<[^;()]*>)?\s*\(/;

/** How a function-valued context field gets its identity. */
export type FunctionFieldSupply =
  /** An expression inside the value factory: a new closure per factory recompute. */
  | "factory-built"
  /** A `useCallback`/`useMemo` binding of its own: one identity until its own deps move. */
  | "stable"
  /** Neither — not supplied by a named property, or bound to something unreadable. */
  | "unread";

/** One function-valued field of one context value. */
export interface FunctionField {
  /** Repo-relative path of the provider module. */
  readonly file: string;
  readonly valueType: string;
  readonly field: string;
  readonly supply: FunctionFieldSupply;
}

/** One `useEffect` whose dependency array names a factory-built context function. */
export interface EffectDepFinding {
  /** Repo-relative path of the consumer module. */
  readonly file: string;
  /** 1-based line of the `useEffect` keyword, for the annotation. */
  readonly line: number;
  /** The fields it names, in the order the dependency array lists them. */
  readonly fields: readonly string[];
}

/** Every function-valued field of this provider's context value, classified. */
export function functionFieldsOf(file: string, source: string): FunctionField[] {
  const code = scannableCode(source);
  const valueType = contextValueType(code);
  if (!valueType) return [];
  const factory = valueFactoryBody(code);
  if (factory === null) return [];
  const bindings = declarations(code);
  return functionFields(valueType.body).map((field) => {
    const supply = supplyOf(factory.body, field);
    if (!supply) return { file, valueType: valueType.name, field, supply: "unread" as const };
    if (!BARE_IDENTIFIER.test(supply.value)) {
      return { file, valueType: valueType.name, field, supply: "factory-built" as const };
    }
    const binding = bindingInScope(bindings, supply.value, factory.at);
    return {
      file,
      valueType: valueType.name,
      field,
      supply: binding && STABLE_BINDING.test(binding.rhs) ? ("stable" as const) : ("unread" as const),
    };
  });
}

/**
 * The dependency array of a hook call: the LAST top-level `[…]` inside it.
 *
 * Last and top-level, because `useEffect(() => { setRows([]) }, [a, b])` has a
 * `[` in its body and `useMemo(() => rows.filter(…), [rows])` has one in a
 * type argument. Depth is what tells the dependency array from the brackets
 * the callback happens to contain.
 */
export function dependencyArray(call: string): string[] | null {
  let depth = 0;
  let last: number | null = null;
  for (let i = 0; i < call.length; i += 1) {
    const ch = call[i];
    if (ch === "{" || ch === "(") depth += 1;
    else if (ch === "}" || ch === ")") depth -= 1;
    else if (ch === "[") {
      if (depth === 0) last = i;
      depth += 1;
    } else if (ch === "]") depth -= 1;
  }
  if (last === null) return null;
  const close = matchingBracket(call, last);
  if (close === null) return null;
  return call
    .slice(last + 1, close)
    .split(",")
    .map((dep) => dep.trim())
    .filter((dep) => dep.length > 0);
}

/** Every `useEffect` in this module whose dependency array names one of `volatile`. */
export function effectDepsNaming(
  file: string,
  source: string,
  volatile: ReadonlySet<string>,
): EffectDepFinding[] {
  const code = scannableCode(source);
  const found: EffectDepFinding[] = [];
  for (const match of code.matchAll(/\buseEffect\s*\(/g)) {
    const open = code.indexOf("(", match.index);
    const close = matchingBracket(code, open);
    if (close === null) continue;
    const deps = dependencyArray(code.slice(open + 1, close));
    if (deps === null) continue;
    const named = deps.filter((dep) => volatile.has(dep));
    if (named.length === 0) continue;
    found.push({ file, line: code.slice(0, match.index).split("\n").length, fields: named });
  }
  return found;
}

/** One sanctioned pairing: this effect may depend on these fields, for this reason. */
export interface SanctionedEffectDep {
  /** Repo-relative path of the consumer module. */
  readonly file: string;
  /** The field the effect depends on. */
  readonly field: string;
  /** Why re-firing on a fresh closure is safe here. */
  readonly why: string;
}

/**
 * The effects that may name a factory-built context function, each argued.
 *
 * Two kinds, and the difference is the whole content of the list. `t` belongs
 * to `I18nContextValue`, whose factory has two dependencies — the language and
 * whether its chunk has loaded — so a fresh `t` means the language CHANGED,
 * and an effect that re-runs on that is doing what it was written to do. The
 * one entry that is not that kind is the one with an incident behind it, and
 * it is in the list because it carries its own guard, not because re-firing is
 * harmless.
 */
export const SANCTIONED_EFFECT_DEPS: readonly SanctionedEffectDep[] = [
  {
    file: "app/auth/callback.tsx",
    field: "t",
    why: "the message it shows is translated; a language change should restate it",
  },
  {
    file: "app/collection/[id].tsx",
    field: "saveSharedCollection",
    why: "guarded by hasAttemptedShareSaveRef, keyed on the collection id — one attempt per opened collection, whatever the closure does. The guard is there BECAUSE this re-fired: each attempt mounted a toast and queued a network write until iOS Safari aborted the tab",
  },
  {
    file: "app/collection/[id].tsx",
    field: "t",
    why: "rides with saveSharedCollection in the same guarded effect, and in one other that sets a translated screen title",
  },
  {
    file: "app/profile/[id].tsx",
    field: "t",
    why: "sets a translated screen title, which a language change should re-set",
  },
  {
    file: "components/bottom-nav.tsx",
    field: "t",
    why: "the premium intent it consumes is announced with a translated toast",
  },
  {
    file: "lib/social-context.tsx",
    field: "t",
    why: "a dev-only warning toast behind a module-level once-flag — the second firing returns before it does anything",
  },
  {
    file: "components/search-overlay.tsx",
    field: "t",
    why: "a translated placeholder and an announcement, both of which a language change should re-state",
  },
];

/** A pairing the registry does not cover, or an entry covering nothing. */
export interface EffectDepProblem {
  readonly kind: "unsanctioned" | "stale-sanction";
  readonly file: string;
  readonly field: string;
  /** 1-based line of the effect, for an unsanctioned pairing. */
  readonly line: number | null;
}

/**
 * Both directions, which is the half an exemption list usually lacks.
 *
 * An effect naming a factory-built field with no entry is a finding — that is
 * the rule. An ENTRY naming a pairing that no longer exists is also a finding,
 * because a sanction for an effect somebody deleted is a sentence that reads
 * as a decision and covers nothing.
 */
export function effectDepProblems(
  findings: readonly EffectDepFinding[],
  sanctioned: readonly SanctionedEffectDep[] = SANCTIONED_EFFECT_DEPS,
): EffectDepProblem[] {
  const problems: EffectDepProblem[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    for (const field of finding.fields) {
      seen.add(`${finding.file}\u0000${field}`);
      const covered = sanctioned.some((s) => s.file === finding.file && s.field === field);
      if (!covered) {
        problems.push({ kind: "unsanctioned", file: finding.file, field, line: finding.line });
      }
    }
  }
  for (const entry of sanctioned) {
    if (!seen.has(`${entry.file}\u0000${entry.field}`)) {
      problems.push({ kind: "stale-sanction", file: entry.file, field: entry.field, line: null });
    }
  }
  return problems;
}

/** Human-readable failure report; empty string when there is nothing to say. */
export function formatEffectDepReport(problems: readonly EffectDepProblem[]): string {
  if (problems.length === 0) return "";
  const lines = [
    `Found ${problems.length} problem(s) with useEffect dependencies on context functions.`,
    `A function field built inside a provider's value factory is a NEW CLOSURE every time that factory recomputes — for CollectionsProvider that is any of twenty dependencies moving. An effect listing one re-fires on context updates that have nothing to do with it, and an effect does things: a network write, a toast, a navigation.`,
    `Either give the function its own useCallback in the provider, guard the effect so re-firing is a no-op, or add the pairing to SANCTIONED_EFFECT_DEPS with the reason re-firing is safe.`,
  ];
  for (const problem of problems) {
    lines.push(
      problem.kind === "unsanctioned"
        ? `  ${problem.file}:${problem.line}  useEffect depends on \`${problem.field}\`, which its provider rebuilds in the value factory`
        : `  ${problem.file}  sanctions \`${problem.field}\` and no effect there depends on it any more — the entry covers nothing`,
    );
  }
  return lines.join("\n");
}

/** The same problems as GitHub Actions annotations. */
export function effectDepAnnotations(problems: readonly EffectDepProblem[]): string[] {
  return problems.map((problem) =>
    annotation(
      "error",
      problem.kind === "unsanctioned"
        ? `useEffect depends on \`${problem.field}\`, a context function rebuilt in its provider's value factory, so this effect re-fires on unrelated context updates. Guard it, memoize the function, or sanction the pairing.`
        : `SANCTIONED_EFFECT_DEPS still names \`${problem.field}\` here and no effect depends on it any more.`,
      {
        file: problem.file,
        line: problem.line ?? undefined,
        title: "useEffect depends on a factory-built context function",
      },
    ),
  );
}
