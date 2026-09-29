/**
 * The contract that was prose in six places and checked in none.
 *
 * `useChunkedList` resets its window when the `items` reference changes, so a
 * caller that rebuilds the array every render resets the window every render:
 * `count` never grows and "Load more" is a button that responds to the press
 * and changes nothing. The hook's header has asked callers to memoize since it
 * was written, and four of the five call sites then restated the same sentence
 * in their own words — which is what a contract looks like when nothing
 * enforces it. `npm run lint:chunked-items` enforces it.
 *
 * WHY THE FAILURE NEEDED A GUARD RATHER THAN A HEADER. It is invisible from
 * every direction: the types cannot see it (`T[]` is `T[]` however it was
 * built), the hook cannot see it (React hands it an array, not the expression
 * that made one), and a rendering test only catches it if somebody thought to
 * press Load more twice. Nothing throws and nothing logs.
 *
 * THE INTERESTING CASES ARE THE POSITIVES AND THE PROSE. Three binding forms
 * are stable and each of the five real call sites uses one of them, so most of
 * what follows is fixtures for the two shapes the rule exists to refuse and for
 * the sentences ABOUT those shapes that it must not.
 *
 * Fixtures are spelled out: this file is in `__tests__/`, the one source root
 * the guard deliberately does not walk, for exactly this reason.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CHUNKED_LIST_HOOK,
  chunkedItemsAnnotations,
  chunkedListCalls,
  classifyItemsArgument,
  findChunkedItemsRisks,
  formatChunkedItemsReport,
  stableBindingFor,
} from "@/lib/check-chunked-list-items";
import { scannableCode } from "@/lib/declaration-scan";
import { isAnnotationLine } from "@/lib/github-annotations";
import { LINT_GUARDS } from "@/lib/lint-guards";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";

import { readRepoFile } from "./helpers/repo-file";

/** The shape the rule is for: a fresh array built one line above the call. */
const REBUILT = [
  "export default function Screen() {",
  "  const { items } = useCollections();",
  "  const owned = items.filter((i) => i.role === \"owner\");",
  "  const { visibleItems, loadMore } = useChunkedList(owned, 20);",
  "  return null;",
  "}",
].join("\n");

/** The same bug written inline, which is the version that reads as obviously fine. */
const INLINE = [
  "export default function Screen() {",
  "  const { items } = useCollections();",
  "  const w = useChunkedList(items.filter((i) => i.role === \"owner\"), 20);",
  "  return null;",
  "}",
].join("\n");

describe("what the rule catches", () => {
  it("catches an array rebuilt in the render body", () => {
    const found = findChunkedItemsRisks("app/screen.tsx", REBUILT);
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "unstable-binding");
    assert.equal(found[0].line, 4);
    assert.equal(found[0].argument, "owned");
    assert.match(found[0].detail, /items\.filter/);
  });

  it("catches the inline expression, commas and parens and all", () => {
    const found = findChunkedItemsRisks("app/screen.tsx", INLINE);
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "inline-expression");
    // The argument is read with a depth-aware scan, so the arrow's own comma
    // and close paren do not end it. A pattern wildcarding to the first of
    // either would report `items.filter((i` and name the wrong thing.
    assert.equal(found[0].argument, 'items.filter((i) => i.role === "owner")');
  });

  it("catches a name this file does not bind, rather than assuming a parent memoized it", () => {
    const prop = [
      "export function Rows({ rows }: { rows: Item[] }) {",
      "  const w = useChunkedList(rows, 40);",
      "  return null;",
      "}",
    ].join("\n");
    const [finding] = findChunkedItemsRisks("components/rows.tsx", prop);
    assert.equal(finding.kind, "unresolved-binding");
    assert.match(finding.detail, /not bound in this file/);
  });

  it("reports each call in a file with its own line", () => {
    const two = [
      "export default function Home() {",
      "  const a = build();",
      "  const b = build();",
      "  const first = useChunkedList(a, 12);",
      "  const second = useChunkedList(b, 12);",
      "  return null;",
      "}",
    ].join("\n");
    assert.deepEqual(
      findChunkedItemsRisks("app/index.tsx", two).map((f) => `${f.argument}@${f.line}`),
      ["a@4", "b@5"],
    );
  });
});

describe("the three stable forms", () => {
  it("accepts a useMemo result", () => {
    const code = scannableCode("  const rows = useMemo(() => items.filter(f), [items]);");
    assert.equal(stableBindingFor(code, "rows"), "useMemo");
    assert.equal(classifyItemsArgument(code, "rows"), null);
  });

  it("accepts a provider-held array destructured from a use*() hook", () => {
    const code = scannableCode("  const { archivedItems, refresh } = useCollections();");
    assert.equal(stableBindingFor(code, "archivedItems"), "hook-result");
  });

  it("accepts a destructure whose hook call is on the next line", () => {
    // app/archive.tsx wraps exactly this way, and the first version of the
    // walk lost the declaration entirely: a regex ending in a fixed-width
    // tail consumed sixty characters past the `=` and swallowed the `const {`
    // of the declaration after it. matchAll cannot overlap, so the eleven-name
    // useCollections() destructure on the home screen was invisible and its
    // argument was reported as unresolved.
    const code = scannableCode(
      ["  const { archivedItems, unarchiveItem, deleteItem, refresh } =", "    useCollections();"].join("\n"),
    );
    assert.equal(stableBindingFor(code, "archivedItems"), "hook-result");
  });

  it("finds a declaration that follows another destructure", () => {
    const code = scannableCode(
      [
        "  const { user, signOut, pending } = useAuth();",
        "  const {",
        "    collections,",
        "    subscribedCollections,",
        "  } = useCollections();",
      ].join("\n"),
    );
    assert.equal(stableBindingFor(code, "subscribedCollections"), "hook-result");
  });

  it("accepts a useState value", () => {
    const code = scannableCode("  const [rows, setRows] = useState<Item[]>([]);");
    assert.equal(stableBindingFor(code, "rows"), "useState");
  });

  it("refuses a plain call, a literal and a spread", () => {
    for (const line of [
      "  const rows = buildRows(items);",
      "  const rows = [];",
      "  const rows = [...items].sort(byTitle);",
      "  const rows = items.slice(0, 10);",
    ]) {
      const code = scannableCode(line);
      assert.equal(stableBindingFor(code, "rows"), null, line);
      assert.equal(classifyItemsArgument(code, "rows")?.kind, "unstable-binding", line);
    }
  });

  it("does not take a lowercase helper for a hook", () => {
    // `use` plus an uppercase letter is the rule: `useCollections()` is a hook
    // whose result React owns, `used(items)` is a function call.
    const code = scannableCode("  const { rows } = used(items);");
    assert.equal(stableBindingFor(code, "rows"), null);
  });
});

describe("what it deliberately does not catch", () => {
  it("ignores the hook's own declaration", () => {
    const declaration = [
      "export function useChunkedList<T>(",
      "  items: T[],",
      "  pageSize: number = 20,",
      "): ChunkedList<T> {",
      "  return null as never;",
      "}",
    ].join("\n");
    assert.deepEqual(chunkedListCalls(declaration), []);
    assert.deepEqual(findChunkedItemsRisks("lib/use-chunked-list.ts", declaration), []);
  });

  it("ignores a call written out in a comment", () => {
    const documented = [
      "// useChunkedList(items.filter(f), 20) is the shape this refuses.",
      "/** `useChunkedList(rows, 12)` resets on the identity of `rows`. */",
      "export const x = 1;",
    ].join("\n");
    assert.deepEqual(findChunkedItemsRisks("lib/x.ts", documented), []);
  });

  it("ignores a call written out inside a string, which is how the guard failed its own first run", () => {
    // lib/lint-guards.ts describes this guard by writing `useChunkedList(items)`
    // in its registry description, and lib/scanned-floor.ts writes the bare
    // call in its floor note. Both were reported on the first run: a rule
    // about a call has to tell a call from a sentence about one.
    const prose = [
      'export const description = "Every useChunkedList(items) call passes a stable reference";',
      'export const note = "a run matching no useChunkedList( call at all has lost its subject";',
    ].join("\n");
    assert.deepEqual(findChunkedItemsRisks("lib/lint-guards.ts", prose), []);
  });

  it("reports the real line after the comment strip", () => {
    const withPreamble = ["/**", " * useChunkedList(rebuilt, 20) is the bug.", " */", REBUILT].join("\n");
    const [finding] = findChunkedItemsRisks("app/screen.tsx", withPreamble);
    assert.equal(finding.line, 7);
    assert.match(withPreamble.split("\n")[finding.line - 1], /useChunkedList\(owned, 20\)/);
  });
});

describe("the report and its annotations", () => {
  it("is empty when there is nothing to say", () => {
    assert.equal(formatChunkedItemsReport([]), "");
    assert.deepEqual(chunkedItemsAnnotations([]), []);
  });

  it("names the failure, not just the rule", () => {
    const report = formatChunkedItemsReport(findChunkedItemsRisks("app/screen.tsx", REBUILT));
    assert.match(report, /loadMore\(\) {0,1}` {0,1}does nothing|does nothing/);
    assert.match(report, /useMemo/);
    assert.match(report, /app\/screen\.tsx:4/);
  });

  it("emits one well-formed annotation per finding", () => {
    const lines = chunkedItemsAnnotations(findChunkedItemsRisks("app/screen.tsx", REBUILT));
    assert.equal(lines.length, 1);
    assert.ok(isAnnotationLine(lines[0]));
    assert.match(lines[0], /file=app\/screen\.tsx/);
    assert.match(lines[0], /line=4/);
  });
});

describe("the tree it guards", () => {
  it("has the five call sites the guard's subject floor is about, all stable", () => {
    const callers = [
      "app/index.tsx",
      "app/wishlist.tsx",
      "app/archive.tsx",
      "app/collection/[id].tsx",
    ];
    let calls = 0;
    for (const file of callers) {
      const source = readRepoFile(file);
      calls += chunkedListCalls(source).length;
      assert.deepEqual(findChunkedItemsRisks(file, source), [], file);
    }
    assert.equal(calls, 5, "the home screen holds two of the five");
  });

  it("is registered as a guard, so lint:all runs it", () => {
    const entry = LINT_GUARDS.find((g) => g.npmScript === "lint:chunked-items");
    assert.ok(entry, "lint:chunked-items is not in LINT_GUARDS");
    assert.equal(entry.scriptPath, "scripts/check-chunked-list-items.ts");
  });

  it("declares a walk floor, so a lost scan root fails by name", () => {
    const floor = SCANNED_FLOORS["check-chunked-list-items"];
    assert.ok(floor, "no SCANNED_FLOORS entry");
    assert.deepEqual([...(floor.count?.roots ?? [])], ["app", "components", "lib"]);
  });

  it("is named by the hook it enforces, so the contract points at what checks it", () => {
    // The header asked callers to memoize for as long as the hook existed and
    // named nothing that would notice. That sentence is the reason this suite
    // exists, so it is the one thing here asserted about the hook itself.
    const source = readRepoFile("lib/use-chunked-list.ts");
    assert.match(source, /lint:chunked-items/);
    assert.equal(CHUNKED_LIST_HOOK, "useChunkedList");
  });
});
