/**
 * Where `lint:chunked-items`' trust is earned, checked.
 *
 * The chunked-list guard accepts `const { archivedItems } = useCollections()`
 * as a stable reference because a provider memoizes it. It reads the CALL SITE,
 * so the day one of those arrays is recomputed inside the value factory
 * instead, every call site still passes and the bug ships. That is the gap this
 * rule closes, and it is a real one: the only thing standing there today is a
 * five-line comment above `wishlistItems` in `lib/collections-context.tsx`.
 *
 * THE DISTINCTION THE RULE IS ABOUT is not "is there a memo" but "whose memo".
 * The value factory IS a `useMemo`, so an array built inside it looks memoized —
 * on the factory's dependency list, which for `CollectionsContextValue` has
 * twenty names in it. A currency refresh or a realtime row arriving then hands
 * every consumer a new array, and a consumer's `useChunkedList` window snaps
 * back to page one on a context update that had nothing to do with its list.
 * So most of these cases are about the difference between two things that are
 * both `useMemo`.
 *
 * Fixtures are spelled out: this file is in `__tests__/`, which the guard does
 * not walk, for exactly this reason.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT_VALUE_SUFFIX,
  arrayFields,
  bindingInScope,
  contextArrayAnnotations,
  contextValueType,
  findContextArrayRisks,
  formatContextArrayReport,
  supplyOf,
  valueFactoryBody,
} from "@/lib/check-context-array-stability";
import { declarations, scannableCode } from "@/lib/declaration-scan";
import { isAnnotationLine } from "@/lib/github-annotations";
import { LINT_GUARDS } from "@/lib/lint-guards";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";

import { readRepoFile } from "./helpers/repo-file";

/** A provider whose one array field is lifted to its own memo — the good shape. */
const LIFTED = [
  "type ThingContextValue = {",
  "  ready: boolean;",
  "  rows: Row[];",
  "  getRow: (id: string) => Row[];",
  "};",
  "",
  "export function ThingProvider() {",
  "  const rows = useMemo(() => all.filter(isLive), [all]);",
  "  const value = useMemo<ThingContextValue>(",
  "    () => ({",
  "      ready,",
  "      rows,",
  "      getRow: (id) => rows.filter((r) => r.id === id),",
  "    }),",
  "    [ready, rows, other, another],",
  "  );",
  "  return value;",
  "}",
].join("\n");

/** The same provider with the array built in the factory — the shape it refuses. */
const IN_FACTORY = LIFTED.replace(
  "      rows,",
  "      rows: all.filter(isLive),",
).replace("  const rows = useMemo(() => all.filter(isLive), [all]);\n", "");

describe("what the rule catches", () => {
  it("catches an array built inside the value factory", () => {
    const found = findContextArrayRisks("lib/thing-context.tsx", IN_FACTORY);
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "computed-in-factory");
    assert.equal(found[0].field, "rows");
    assert.equal(found[0].valueType, "ThingContextValue");
    assert.match(found[0].detail, /all\.filter\(isLive\)/);
  });

  it("catches a name bound to a fresh array one line above the factory", () => {
    const perRender = LIFTED.replace(
      "  const rows = useMemo(() => all.filter(isLive), [all]);",
      "  const rows = all.filter(isLive);",
    );
    const [finding] = findContextArrayRisks("lib/thing-context.tsx", perRender);
    assert.equal(finding.kind, "unstable-binding");
    assert.match(finding.detail, /new value every render/);
  });

  it("catches a field no named property supplies, rather than passing it", () => {
    // A spread is exactly how a field leaves this rule's sight, so an
    // unresolved field is a finding and not a pass.
    const spread = LIFTED.replace("      rows,", "      ...lists,");
    const [finding] = findContextArrayRisks("lib/thing-context.tsx", spread);
    assert.equal(finding.kind, "unsupplied");
    assert.match(finding.detail, /spread would hide/);
  });
});

describe("whose memo it is, which is the whole rule", () => {
  it("accepts the array's own useMemo and refuses the factory's", () => {
    assert.deepEqual(findContextArrayRisks("lib/thing-context.tsx", LIFTED), []);
    assert.equal(findContextArrayRisks("lib/thing-context.tsx", IN_FACTORY).length, 1);
  });

  it("accepts useState, useRef and useConstant", () => {
    for (const binding of [
      "  const [rows, setRows] = useState<Row[]>([]);",
      "  const rows = useRef<Row[]>([]).current;",
      "  const rows = useConstant(() => buildRows());",
    ]) {
      const source = LIFTED.replace(
        "  const rows = useMemo(() => all.filter(isLive), [all]);",
        binding,
      );
      assert.deepEqual(findContextArrayRisks("lib/thing-context.tsx", source), [], binding);
    }
  });

  it("accepts a MODULE-LEVEL const array and refuses the same spelling inside the provider", () => {
    // The scope is the whole difference: one array for the life of the process
    // against a new one per render, spelled identically.
    const atModule = LIFTED.replace(
      "  const rows = useMemo(() => all.filter(isLive), [all]);",
      "",
    ).replace("export function ThingProvider() {", "const rows = [];\n\nexport function ThingProvider() {");
    assert.deepEqual(findContextArrayRisks("lib/thing-context.tsx", atModule), []);

    const inProvider = LIFTED.replace(
      "  const rows = useMemo(() => all.filter(isLive), [all]);",
      "  const rows = [];",
    );
    assert.equal(findContextArrayRisks("lib/thing-context.tsx", inProvider)[0].kind, "unstable-binding");
  });
});

describe("what it deliberately does not look at", () => {
  it("leaves a function field alone even when it returns an array", () => {
    // `getRow` returns `Row[]` and rebuilds it per call by design. Its identity
    // question belongs to the value memo, not here.
    assert.deepEqual(arrayFields("  rows: Row[];\n  getRow: (id: string) => Row[];\n"), ["rows"]);
  });

  it("reads fields of the value and not fields of a nested object or signature", () => {
    const body = [
      "  rows: Row[];",
      "  page: { items: Item[]; cursor: string };",
      "  load: (opts: { ids: string[] }) => Promise<void>;",
      "  tags?: readonly string[];",
      "  count: number;",
    ].join("\n");
    assert.deepEqual(arrayFields(body), ["rows", "tags"]);
  });

  it("does not let an arrow's `>` corrupt the walk after it", () => {
    // `(a: number) => boolean` closes a `>` that never opened. Counting angle
    // brackets as depth drove this negative and hid every field after the first
    // function one — which is how the first version of this saw five of
    // CollectionsContextValue's fourteen array-typed members.
    const body = [
      "  first: A[];",
      "  fn: (a: number) => boolean;",
      "  second: B[];",
      "  third: Array<C>;",
    ].join("\n");
    assert.deepEqual(arrayFields(body), ["first", "second", "third"]);
  });

  it("ignores a value type written out in a comment or a string", () => {
    const prose = [
      "// type FakeContextValue = { rows: Row[] };",
      'export const note = "type OtherContextValue = { rows: Row[] }";',
      "export const x = 1;",
    ].join("\n");
    assert.deepEqual(findContextArrayRisks("lib/x.ts", prose), []);
  });

  it("says nothing about a module with no context value or no value factory", () => {
    assert.deepEqual(findContextArrayRisks("lib/x.ts", "export const x = 1;"), []);
    assert.deepEqual(
      findContextArrayRisks("lib/x.ts", "type AContextValue = {\n  rows: Row[];\n};\n"),
      [],
    );
  });
});

describe("bindingInScope", () => {
  const source = [
    "export function Provider() {",
    "  const onImport = () => {",
    "    const { rows } = selectOwnedForImport(payload);",
    "    return rows;",
    "  };",
    "  const rows = useMemo(() => all.filter(isLive), [all]);",
    "  const value = useMemo(() => ({ rows }), [rows]);",
    "}",
  ].join("\n");

  it("takes the outermost binding before the factory, not the first in the file", () => {
    // `lib/collections-context.tsx` spells `const { collections, items } =
    // selectOwnedForImport(…)` inside an import callback six hundred lines
    // above the provider's own `const collections = useMemo(…)`. A scan taking
    // the first match reported two of its fields as unstable and named a line
    // no consumer can see.
    const code = scannableCode(source);
    const factory = valueFactoryBody(code);
    assert.ok(factory);
    const binding = bindingInScope(declarations(code), "rows", factory.at);
    assert.ok(binding);
    assert.equal(binding.indent, 2);
    assert.match(binding.rhs, /^useMemo\(/);
  });

  it("ignores a binding that only appears after the factory", () => {
    const code = scannableCode("const value = useMemo(() => ({ rows }), []);\nconst rows = [];");
    assert.equal(bindingInScope(declarations(code), "rows", code.indexOf("const value")), null);
  });
});

describe("supplyOf", () => {
  it("reads a shorthand and an explicit property, and only at the top level", () => {
    const body = "  ready,\n  rows: sorted,\n  load: (o) => f({ rows: o.rows }),\n";
    assert.deepEqual(supplyOf(body, "ready"), { shorthand: true, value: "ready" });
    assert.deepEqual(supplyOf(body, "rows"), { shorthand: false, value: "sorted" });
  });

  it("returns null for a field the factory never names", () => {
    assert.equal(supplyOf("  ready,\n  ...rest,\n", "rows"), null);
  });
});

describe("the report and its annotations", () => {
  it("is empty when there is nothing to say", () => {
    assert.equal(formatContextArrayReport([]), "");
    assert.deepEqual(contextArrayAnnotations([]), []);
  });

  it("names the consequence, not just the rule", () => {
    const report = formatContextArrayReport(findContextArrayRisks("lib/thing-context.tsx", IN_FACTORY));
    assert.match(report, /useChunkedList/);
    assert.match(report, /ThingContextValue\.rows/);
    assert.match(report, /its own/);
  });

  it("emits one well-formed annotation per finding", () => {
    const lines = contextArrayAnnotations(findContextArrayRisks("lib/thing-context.tsx", IN_FACTORY));
    assert.equal(lines.length, 1);
    assert.ok(isAnnotationLine(lines[0]));
    assert.match(lines[0], /file=lib\/thing-context\.tsx/);
  });
});

describe("the tree it guards", () => {
  it("reads all four context values that declare an array field, and finds none unstable", () => {
    const providers = [
      "lib/collections-context.tsx",
      "lib/social-context.tsx",
      "lib/marketplace-context.tsx",
      "lib/chat-context.tsx",
    ];
    let fields = 0;
    for (const file of providers) {
      const source = readRepoFile(file);
      const valueType = contextValueType(scannableCode(source));
      assert.ok(valueType, `${file} declares no ${CONTEXT_VALUE_SUFFIX}`);
      fields += arrayFields(valueType.body).length;
      assert.deepEqual(findContextArrayRisks(file, source), [], file);
    }
    assert.equal(fields, 19, "the subject moved — re-read the fields before trusting the negative");
  });

  it("holds the one field whose comment is this rule's whole argument", () => {
    // If this stops being a separately-memoized `wishlistItems`, the rule has
    // either caught it or lost its most-cited example.
    const source = readRepoFile("lib/collections-context.tsx");
    assert.match(source, /const wishlistItems = useMemo\(/);
    assert.match(source, /Memoized separately from the big `value` memo/);
  });

  it("is registered as a guard, so lint:all runs it", () => {
    const entry = LINT_GUARDS.find((g) => g.npmScript === "lint:context-arrays");
    assert.ok(entry, "lint:context-arrays is not in LINT_GUARDS");
    assert.equal(entry.scriptPath, "scripts/check-context-array-stability.ts");
  });

  it("declares a one-root walk floor, which is the only one in the table", () => {
    const floor = SCANNED_FLOORS["check-context-array-stability"];
    assert.ok(floor, "no SCANNED_FLOORS entry");
    assert.deepEqual([...(floor.count?.roots ?? [])], ["lib"]);
  });
});
