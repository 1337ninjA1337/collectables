/**
 * The other half of the context-value identity question, checked.
 *
 * `lint:context-arrays` holds array fields to their own memo and leaves
 * function fields alone, on the argument that a function rebuilding its result
 * per call has nothing to memoize. True, and it skips the function's OWN
 * identity: fifty-eight of this tree's function fields are built inside a
 * value factory, so each is a new closure whenever that factory recomputes.
 *
 * For a `useMemo` that is a wasted recompute. For a `useEffect` it is a
 * re-fire, and this repository has the incident: the shared-collection save in
 * `app/collection/[id].tsx` queued a network write and mounted a toast per
 * attempt until iOS Safari aborted the tab with "A problem repeatedly
 * occurred". That effect carries a per-id ref guard now, and nothing stopped
 * the next one from being written without one.
 *
 * Fixtures are spelled out: this file is in `__tests__/`, which the guard does
 * not walk, for exactly this reason.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SANCTIONED_EFFECT_DEPS,
  dependencyArray,
  effectDepAnnotations,
  effectDepProblems,
  effectDepsNaming,
  formatEffectDepReport,
  functionFieldsOf,
} from "@/lib/context-function-deps";
import { isAnnotationLine } from "@/lib/github-annotations";
import { LINT_GUARDS } from "@/lib/lint-guards";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";
import { RUNTIME_CODE_DIRS } from "@/lib/source-dirs";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/** A provider with one function built in the factory and one lifted out of it. */
const PROVIDER = [
  "type ThingContextValue = {",
  "  rows: Row[];",
  "  refresh: () => Promise<void>;",
  "  getRow: (id: string) => Row | null;",
  "};",
  "",
  "export function ThingProvider() {",
  "  const refresh = useCallback(async () => reload(), []);",
  "  const value = useMemo<ThingContextValue>(",
  "    () => ({",
  "      rows,",
  "      refresh,",
  "      getRow: (id) => rows.find((r) => r.id === id) ?? null,",
  "    }),",
  "    [rows, refresh, a, b, c],",
  "  );",
  "  return <ThingContext.Provider value={value}>{children}</ThingContext.Provider>;",
  "}",
].join("\n");

describe("which functions a factory recompute replaces", () => {
  it("calls the lifted one stable and the inline one factory-built", () => {
    const fields = functionFieldsOf("lib/thing-context.tsx", PROVIDER);
    assert.deepEqual(
      fields.map((f) => [f.field, f.supply]),
      [
        ["refresh", "stable"],
        ["getRow", "factory-built"],
      ],
    );
  });

  it("leaves array fields to the rule that owns them", () => {
    const fields = functionFieldsOf("lib/thing-context.tsx", PROVIDER);
    assert.equal(
      fields.find((f) => f.field === "rows"),
      undefined,
      "`rows` is an array field and belongs to lint:context-arrays",
    );
  });

  it("says nothing about a module with no readable provider", () => {
    assert.deepEqual(functionFieldsOf("lib/x.ts", "export const x = 1;"), []);
  });
});

describe("dependencyArray", () => {
  it("takes the LAST top-level array, not a bracket inside the callback", () => {
    assert.deepEqual(dependencyArray("() => { setRows([]); }, [a, b]"), ["a", "b"]);
    assert.deepEqual(dependencyArray("() => rows.filter((r) => r.ids[0]), [rows]"), ["rows"]);
  });

  it("reads an empty dependency array as a dependency array, not as absence", () => {
    assert.deepEqual(dependencyArray("() => { run(); }, []"), []);
  });

  it("returns null for a call with no array at all", () => {
    assert.equal(dependencyArray("() => { run(); }"), null);
  });
});

describe("effectDepsNaming", () => {
  const consumer = [
    "export default function Screen() {",
    "  const { getRow, refresh } = useThing();",
    "  const row = useMemo(() => getRow(id), [getRow, id]);",
    "  useEffect(() => {",
    "    void refresh();",
    "  }, [refresh]);",
    "  useEffect(() => {",
    "    void save(getRow(id));",
    "  }, [getRow, id]);",
    "}",
  ].join("\n");

  it("reports the effect and not the memo, with the line the effect starts on", () => {
    const found = effectDepsNaming("app/screen.tsx", consumer, new Set(["getRow"]));
    assert.equal(found.length, 1);
    assert.deepEqual([...found[0].fields], ["getRow"]);
    assert.equal(found[0].line, 7);
  });

  it("says nothing when the dependency is a function the provider memoized", () => {
    assert.deepEqual(effectDepsNaming("app/screen.tsx", consumer, new Set(["refresh"])).length, 1);
    assert.deepEqual(effectDepsNaming("app/screen.tsx", consumer, new Set(["nothing"])), []);
  });

  it("ignores a value type written out in a comment or a string", () => {
    const prose = [
      "// useEffect(() => { go(); }, [getRow]);",
      'export const note = "useEffect(() => { go(); }, [getRow])";',
    ].join("\n");
    assert.deepEqual(effectDepsNaming("app/x.tsx", prose, new Set(["getRow"])), []);
  });
});

describe("the registry, in both directions", () => {
  const finding = { file: "app/screen.tsx", line: 7, fields: ["getRow"] as const };

  it("reports a pairing nothing sanctions", () => {
    const [problem] = effectDepProblems([finding], []);
    assert.equal(problem.kind, "unsanctioned");
    assert.equal(problem.field, "getRow");
    assert.equal(problem.line, 7);
  });

  it("accepts the pairing once an entry argues it", () => {
    const sanctioned = [{ file: "app/screen.tsx", field: "getRow", why: "guarded by a ref" }];
    assert.deepEqual(effectDepProblems([finding], sanctioned), []);
  });

  it("reports an entry that covers nothing, which is the half a list usually lacks", () => {
    const sanctioned = [{ file: "app/gone.tsx", field: "getRow", why: "deleted since" }];
    const problems = effectDepProblems([], sanctioned);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].kind, "stale-sanction");
    assert.equal(problems[0].file, "app/gone.tsx");
  });
});

describe("the report and its annotations", () => {
  it("is empty when there is nothing to say", () => {
    assert.equal(formatEffectDepReport([]), "");
  });

  it("names the consequence, not just the rule", () => {
    const report = formatEffectDepReport([
      { kind: "unsanctioned", file: "app/screen.tsx", field: "getRow", line: 7 },
    ]);
    assert.match(report, /re-fires on context updates/);
    assert.match(report, /app\/screen\.tsx:7/);
  });

  it("emits one well-formed annotation per problem", () => {
    const lines = effectDepAnnotations([
      { kind: "unsanctioned", file: "app/screen.tsx", field: "getRow", line: 7 },
      { kind: "stale-sanction", file: "app/gone.tsx", field: "getRow", line: null },
    ]);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.ok(isAnnotationLine(line), line);
    assert.match(lines[0], /line=7/);
  });
});

describe("the tree it guards", () => {
  const files = sourceFiles(...RUNTIME_CODE_DIRS);
  const fields = files
    .filter((file) => file.endsWith("-context.tsx"))
    .flatMap((file) => functionFieldsOf(file, readRepoFile(file)));

  it("reads 84 function-valued context fields, 58 of them factory-built", () => {
    // The subject, taken on 2026-10-01. A provider lifting a function to its
    // own useCallback moves the second number down and is an improvement; both
    // moving at once is the rule losing its reach.
    assert.equal(fields.length, 84, "the subject moved — re-read before trusting the negative");
    assert.equal(fields.filter((f) => f.supply === "factory-built").length, 58);
  });

  it("finds every effect that depends on one, and all seven are argued", () => {
    const volatileNames = new Set(
      fields.filter((f) => f.supply === "factory-built").map((f) => f.field),
    );
    const findings = files.flatMap((file) =>
      effectDepsNaming(file, readRepoFile(file), volatileNames),
    );
    assert.deepEqual(effectDepProblems(findings), []);
    assert.equal(findings.length, 7);
  });

  it("holds the guard the one dangerous sanction rests on", () => {
    // The entry says "guarded by hasAttemptedShareSaveRef". If that ref leaves
    // the screen, the sanction is a sentence about something that is no longer
    // there — and the effect is the one that aborted an iOS Safari tab.
    const entry = SANCTIONED_EFFECT_DEPS.find((s) => s.field === "saveSharedCollection");
    assert.ok(entry, "the shared-collection save is no longer sanctioned");
    assert.match(entry.why, /hasAttemptedShareSaveRef/);
    const screen = readRepoFile(entry.file);
    assert.match(screen, /hasAttemptedShareSaveRef\.current === params\.id/);
    assert.match(screen, /A problem repeatedly occurred/);
  });

  it("is registered as a guard, so lint:all runs it", () => {
    const entry = LINT_GUARDS.find((g) => g.npmScript === "lint:context-fn-deps");
    assert.ok(entry, "lint:context-fn-deps is not in LINT_GUARDS");
    assert.equal(entry.scriptPath, "scripts/check-context-function-deps.ts");
  });

  it("declares the shared runtime-code walk floor, because its two halves are in different roots", () => {
    const floor = SCANNED_FLOORS["check-context-function-deps"];
    assert.ok(floor, "no SCANNED_FLOORS entry");
    assert.deepEqual([...(floor.count?.roots ?? [])], [...RUNTIME_CODE_DIRS]);
  });
});
