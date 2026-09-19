/**
 * The twelfth copy, refused.
 *
 * `const xRef = useRef(x); xRef.current = x;` was in eight files, eleven times,
 * for three different reasons, and `useLatestRef` now owns it. What stops it
 * coming back is `npm run lint:latest-ref` — and what makes it worth a guard
 * rather than a header is the failure mode: when the assignment is the line
 * that gets omitted nothing crashes, the ref keeps the first render's value,
 * and the component is correct right up until that value changes.
 *
 * THE INTERESTING CASES ARE ALL NEGATIVES. Ordinary ref usage looks almost
 * identical — `fooRef.current = null` is a reset, `timerRef.current =
 * setTimeout(...)` stores a handle, `mountedRef.current = false` is a lifecycle
 * flag, and `app/chat/[id].tsx` alone has six of them. Every one of those is
 * correct code, so most of this suite is about what the rule must NOT say.
 *
 * Fixtures are spelled out: this file is in `__tests__/`, which is the one
 * source root the guard deliberately does not walk, for exactly this reason.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LATEST_REF_OWNER,
  findLatestRefSyncs,
  formatLatestRefReport,
  latestRefAnnotations,
} from "@/lib/check-latest-ref";
import { isAnnotationLine } from "@/lib/github-annotations";
import { LINT_GUARDS } from "@/lib/lint-guards";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/** The idiom, as it appeared in all eleven places. */
const OFFENDER = [
  "export function Screen({ value }: { value: string }) {",
  "  const valueRef = useRef(value);",
  "  valueRef.current = value;",
  "  return null;",
  "}",
].join("\n");

describe("what the rule catches", () => {
  it("catches the idiom it replaced", () => {
    const found = findLatestRefSyncs("app/screen.tsx", OFFENDER);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], { file: "app/screen.tsx", line: 3, ref: "valueRef", value: "value" });
  });

  it("catches each of several in one file, with its own line", () => {
    const three = [
      "function C({ a, b, c }) {",
      "  aRef.current = a;",
      "  bRef.current = b;",
      "  cRef.current = c;",
      "}",
    ].join("\n");
    assert.deepEqual(
      findLatestRefSyncs("components/c.tsx", three).map((f) => `${f.ref}@${f.line}`),
      ["aRef@2", "bRef@3", "cRef@4"],
    );
  });
});

describe("what it deliberately does not catch", () => {
  it("leaves a reset alone", () => {
    assert.deepEqual(findLatestRefSyncs("a.tsx", "  timerRef.current = null;"), []);
    assert.deepEqual(findLatestRefSyncs("a.tsx", "  mountedRef.current = false;"), []);
  });

  it("leaves a stored handle alone", () => {
    assert.deepEqual(findLatestRefSyncs("a.tsx", "  timerRef.current = setTimeout(go, 5);"), []);
    assert.deepEqual(findLatestRefSyncs("a.tsx", "  typingSubRef.current = sub;"), []);
  });

  it("leaves an assignment inside an effect or a handler alone", () => {
    // Four or more spaces means it is a statement somebody chose to run, not a
    // per-render sync. `use-transition-event` writes its prevRef from inside
    // its effect, correctly, and a rule that argued with that would be wrong.
    assert.deepEqual(findLatestRefSyncs("a.tsx", "    prevRef.current = prev;"), []);
    assert.deepEqual(findLatestRefSyncs("a.tsx", "      valueRef.current = value;"), []);
  });

  it("requires the same name either side", () => {
    // `fooRef.current = bar` is somebody storing one thing in another thing's
    // ref, which is not the idiom and may well be deliberate.
    assert.deepEqual(findLatestRefSyncs("a.tsx", "  fooRef.current = bar;"), []);
  });

  it("requires the Ref suffix, which is what makes the shape recognisable", () => {
    assert.deepEqual(findLatestRefSyncs("a.tsx", "  fooReference.current = fooReference;"), []);
  });

  it("ignores the line written out in prose", () => {
    // This rule's own header writes it out four times and so does
    // lib/use-latest-ref.ts. A scan that read comments would report every file
    // that documents the rule, starting with the rule.
    const documented = [
      "// The idiom:",
      "//   valueRef.current = value;",
      "/** `fooRef.current = foo;` is what this replaces. */",
      "export const x = 1;",
    ].join("\n");
    assert.deepEqual(findLatestRefSyncs("lib/x.ts", documented), []);
  });

  it("reports the real line after the comment strip", () => {
    const withPreamble = ["/**", " *   valueRef.current = value;", " */", OFFENDER].join("\n");
    const [finding] = findLatestRefSyncs("app/screen.tsx", withPreamble);
    assert.equal(finding.line, 6);
    assert.match(withPreamble.split("\n")[finding.line - 1], /valueRef\.current = value;/);
  });
});

describe("the report and its annotations", () => {
  it("is empty when there is nothing to say", () => {
    assert.equal(formatLatestRefReport([]), "");
    assert.deepEqual(latestRefAnnotations([]), []);
  });

  it("prints the replacement line rather than describing it", () => {
    // The fix is one substitution, so the report may as well be the patch.
    const report = formatLatestRefReport(findLatestRefSyncs("app/screen.tsx", OFFENDER));
    assert.match(report, /app\/screen\.tsx:3 {2}const valueRef = useLatestRef\(value\);/);
    assert.ok(report.includes(LATEST_REF_OWNER));
    assert.match(report, /keeps the first render's value/);
  });

  it("emits one well-formed annotation per finding", () => {
    const lines = latestRefAnnotations(findLatestRefSyncs("app/screen.tsx", OFFENDER));
    assert.equal(lines.length, 1);
    assert.ok(isAnnotationLine(lines[0]));
    assert.match(lines[0], /file=app\/screen\.tsx,line=3/);
    assert.match(lines[0], /useLatestRef\(value\)/);
  });
});

describe("the guard is wired in, and the tree is clean", () => {
  it("is a LINT_GUARDS entry pointing at its own wrapper", () => {
    const guard = LINT_GUARDS.find((g) => g.npmScript === "lint:latest-ref");
    assert.ok(guard, "lint:latest-ref must be in the registry so lint:all runs it");
    assert.equal(guard.scriptPath, "scripts/check-latest-ref.ts");
  });

  it("declares a scanned floor over the roots its wrapper walks", () => {
    const floor = SCANNED_FLOORS["check-latest-ref"];
    assert.ok(floor?.count, "a walk with no floor proves its negative over any tree");
    assert.deepEqual(floor.count.roots, ["app", "components", "lib"]);
    assert.match(
      readRepoFile("scripts/check-latest-ref.ts"),
      /const SCANNED_DIRS = \["app", "components", "lib"\] as const;/,
    );
  });

  it("finds nothing in the tree it guards", () => {
    // The same sweep that turned this into a rule, kept here as well as in the
    // guard: a suite reports which file and line, and `lint:all` reports that
    // something is wrong.
    const offenders = sourceFiles("app", "components", "lib").flatMap((file) =>
      findLatestRefSyncs(file, readRepoFile(file)),
    );
    assert.deepEqual(
      offenders.map((f) => `${f.file}:${f.line}`),
      [],
      "these should be useLatestRef(...)",
    );
  });

  it("does not attempt the half it cannot decide", () => {
    // A `.current` read during render is a genuine React violation and the
    // hook makes it one line shorter to write — but telling a render-body read
    // from a callback's is a question about scope, not text. A rule that
    // caught nine of ten would be worse than none, because the tenth would
    // read as cleared.
    const rule = readRepoFile("lib/check-latest-ref.ts");
    assert.match(rule, /WHAT THIS RULE DOES NOT TRY TO SAY/);
    assert.doesNotMatch(rule, /export function findRenderReads/);
  });
});
