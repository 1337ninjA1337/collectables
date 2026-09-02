import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACCEPTED_HIGH_ADVISORIES } from "@/lib/audit-baseline";

import { readRepoFile } from "./helpers/repo-file";

const CI = readRepoFile(".github/workflows/ci.yml");
const SECURITY = readRepoFile("SECURITY.md");

/**
 * SEC-8's CI policy, which changed on 2026-08-31.
 *
 * This suite used to pin the OPPOSITE arrangement — a bare
 * `npm audit --audit-level=high` that had to carry `continue-on-error: true`
 * — and it was right to, given the step that existed. What neither the step
 * nor this suite could see is that a permanently-red check reports the same
 * red for an advisory somebody triaged and one nobody has ever seen: the
 * recorded state said "0 high/critical" while thirteen accumulated.
 *
 * The cases below pin the replacement and, more importantly, the property
 * that makes it worth having: the gate is SILENT on the accepted set and
 * BLOCKING on anything else, so it can be blocking at all.
 */
describe("SEC-8: dependency advisory baseline", () => {
  it("CI runs the baseline gate", () => {
    assert.match(CI, /^\s*run: npm run lint:audit-baseline$/m);
  });

  it("the gate is blocking, which is the whole change", () => {
    // A step that is red every run gets `continue-on-error` and then gets
    // ignored. This one is quiet until the advisory set changes, so it can
    // fail the build — and it must not inherit the old escape hatch.
    const idx = CI.indexOf("npm run lint:audit-baseline");
    assert.ok(idx >= 0, "expected the baseline step in CI");
    const stepStart = CI.lastIndexOf("- name:", idx);
    const block = CI.slice(stepStart, idx);
    assert.ok(
      !/continue-on-error:\s*true/.test(block),
      "the baseline step must block — it is silent unless something changed",
    );
  });

  it("no bare audit-level step remains beside it", () => {
    // A `run:` line, not any mention: the comment above the step explains what
    // it replaced and names the old command.
    assert.ok(
      !/^\s*run: npm audit --audit-level=/m.test(CI),
      "two audit steps means the always-red one is back",
    );
  });

  it("SECURITY.md documents the gate and that it blocks", () => {
    assert.match(SECURITY, /##\s+Dependency advisory triage/i);
    assert.match(SECURITY, /npm run lint:audit-baseline/);
    assert.match(SECURITY, /\*\*blocking\*\*/i);
  });

  it("tables every accepted advisory, with whether it reaches the client", () => {
    // The claim that was wrong for two months was not a severity number: it
    // was the sentence saying every remaining advisory was dev/build-time,
    // while `nanoid` shipped to every user. So the reachability answer is the
    // column this asserts, per package, rather than a prose summary.
    assert.match(SECURITY, /Ships to client\?/i);
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      assert.ok(
        SECURITY.includes(`\`${entry.package}\``),
        `triage must table the accepted advisory for ${entry.package}`,
      );
    }
  });

  it("keeps the record of what the previous pass resolved", () => {
    // The 2026-06-28 `npm audit fix` pass really did clear a critical and four
    // highs; deleting that history would make the next reader think the tree
    // has never been cleaned.
    assert.match(SECURITY, /2026-06-28/);
    assert.match(SECURITY, /1 critical \+ 4 high/i);
    for (const pkg of ["shell-quote", "xmldom", "undici", "ws", "protobufjs"]) {
      assert.ok(
        SECURITY.includes(pkg),
        `the resolved-advisory history must keep ${pkg} — a security record is not tidied away`,
      );
    }
  });

  it("says how the record went stale, so the next reader can spot the shape", () => {
    assert.match(SECURITY, /continue-on-error/i);
    assert.match(SECURITY, /13 high|thirteen high/i);
  });

  it("documents that the fix rule reads every severity and the triage list does not", () => {
    // Two scopes in one gate is the thing a reader gets wrong, and getting it
    // wrong in the safe-looking direction ("it only cares about highs") is
    // what left three moderate/low roots fixable for a month. The table in
    // SECURITY.md is where that split is stated to a human.
    assert.match(SECURITY, /at every severity/i);
    assert.match(SECURITY, /\|\s*Question\s*\|\s*Severities\s*\|/i);
    assert.match(SECURITY, /\*\*all five\*\*/i);
  });

  it("records the three sub-high roots the widened rule found", () => {
    // The measurement is the evidence for the rule, and a rule whose evidence
    // is deleted is a rule the next reader narrows again.
    for (const pkg of ["dompurify", "esbuild"]) {
      assert.ok(SECURITY.includes(pkg), `the 2026-09-02 measurement must keep ${pkg}`);
    }
    assert.match(
      SECURITY,
      /not always an update of the package the advisory names/i,
      "`npm update esbuild` moved nothing; `npm update tsx` did, and that surprise is worth keeping",
    );
  });
});
