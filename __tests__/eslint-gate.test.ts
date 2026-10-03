/**
 * The tenth leg, and the decision it encodes.
 *
 * `npm run lint` arrived as a report on 2026-09-25: 251 findings, gating
 * nothing, with the fourth piece of that task carrying the question of whether
 * it should. The answer is not "yes" and not "no": five rules fail the run
 * and the rest are counted on every run.
 *
 * What makes that an answer rather than a compromise is which five. Each is a
 * violation the tree is at ZERO for, and the first three got there by work
 * that found a real bug on the way: a scroll lock written to a ref and read as
 * a prop, a listing screen that re-fetched a missing listing forever, and the
 * hook-order crash on the path that fix made reachable. `react-hooks/globals`
 * and `import/export` joined on 2026-10-03, when the four ERRORS nobody had
 * ever read were read. Gating them is a ratchet on work that has been paid
 * for. Gating `set-state-in-effect` would mean 26 disables written to make a
 * gate green, against a triage that says those 26 are correct as written.
 *
 * These cases are about the SHAPE of that: that the gate fails on what it says
 * it fails on, that it counts what it says it counts, and that a rule cannot
 * sit on the gated list while the config has it switched off.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GATED_RULES,
  formatGateReport,
  gateFails,
  partitionFindings,
  ruleTally,
  untriagedFindings,
  type EslintFinding,
} from "@/lib/eslint-gate";
import { findingsByFile as exhaustiveDepsByFile } from "@/lib/exhaustive-deps-triage";
import { findingsByFile as setStateByFile } from "@/lib/set-state-in-effect-triage";
import { LINT_ALL_EXEMPT } from "@/lib/lint-guards";

import { GATE_LEG_LABELS, gateLegs } from "./helpers/gate-legs";
import { readRepoFile } from "./helpers/repo-file";

const finding = (over: Partial<EslintFinding> = {}): EslintFinding => ({
  file: "app/index.tsx",
  line: 1,
  rule: "@typescript-eslint/array-type",
  message: "…",
  severity: 1,
  ...over,
});

describe("what the gate fails on", () => {
  it("fails on a gated rule and not on anything else", () => {
    const findings = [
      finding({ rule: "react-hooks/refs", severity: 2 }),
      finding({ rule: "react-hooks/set-state-in-effect", severity: 2 }),
    ];
    const split = partitionFindings(findings);
    assert.deepEqual(
      split.gated.map((f) => f.rule),
      ["react-hooks/refs"],
    );
    assert.deepEqual(
      split.reported.map((f) => f.rule),
      ["react-hooks/set-state-in-effect"],
    );
    assert.equal(gateFails(split), true);
  });

  it("fails on a gated rule at WARNING severity too", () => {
    // Deliberate, and the reason is in the module: a gated rule is one this
    // tree is at zero for. A finding from it that arrives as a warning is
    // still the shape coming back, and a config that downgraded it is a
    // change to argue with rather than a way through the gate.
    const split = partitionFindings([finding({ rule: "react-hooks/purity", severity: 1 })]);
    assert.equal(gateFails(split), true);
  });

  it("is green when the gated rules are silent, however loud the rest are", () => {
    const split = partitionFindings([
      finding({ rule: "@typescript-eslint/no-unused-vars" }),
      finding({ rule: "react-hooks/set-state-in-effect", severity: 2 }),
      finding({ rule: null }),
    ]);
    assert.equal(gateFails(split), false);
    assert.equal(split.reported.length, 3);
  });

  it("keeps a directive message out of the gated half, having no rule to be gated by", () => {
    const split = partitionFindings([finding({ rule: null, message: "Unused eslint-disable directive" })]);
    assert.deepEqual(split.gated, []);
    assert.equal(ruleTally(split.reported)[0].rule, "(directive)");
  });
});

describe("what the gate reports", () => {
  it("prints the ungated tally on the GREEN path as well as the red one", () => {
    // The half that stops this quietly covering less and less of what the
    // linter finds. An exemption nobody sees is the silence this repository's
    // other gates were built to end.
    const green = formatGateReport(
      partitionFindings([finding({ rule: "react-hooks/set-state-in-effect", severity: 2 })]),
      900,
    );
    // The count comes from the list rather than a copy of it — a sixth gated
    // rule should not make this case red for having been added.
    assert.match(
      green,
      new RegExp(`0 finding\\(s\\) from ${String(GATED_RULES.length)} gated rule\\(s\\)`),
    );
    assert.match(green, /reporting 1 error\(s\) and 0 warning\(s\)/);
    assert.match(green, /react-hooks\/set-state-in-effect {2}1 error\(s\)/);
  });

  it("names the file, the rule and the reason when it fails", () => {
    const red = formatGateReport(
      partitionFindings([
        finding({ file: "app/wishlist.tsx", line: 42, rule: "react-hooks/refs", severity: 2 }),
      ]),
      900,
    );
    assert.match(red, /app\/wishlist\.tsx:42 {2}react-hooks\/refs/);
    assert.match(red, /scroll lock that never locked anything/);
    // And not the other two rules' sentences: a failure that recites the whole
    // list is a failure nobody reads to the end.
    assert.doesNotMatch(red, /Rendered more hooks/);
  });

  it("orders the tally by how much there is of it", () => {
    const tally = ruleTally([
      finding({ rule: "a" }),
      finding({ rule: "b" }),
      finding({ rule: "b" }),
      finding({ rule: "c", severity: 2 }),
      finding({ rule: "c", severity: 2 }),
      finding({ rule: "c" }),
    ]);
    assert.deepEqual(
      tally.map((r) => r.rule),
      ["c", "b", "a"],
    );
    assert.deepEqual(tally[0], { rule: "c", errors: 2, warnings: 1 });
  });
});

describe("the list itself", () => {
  it("gives every gated rule a date it reached zero and a sentence about what breaks", () => {
    // The bar for joining: the tree is at zero for it AND somebody can say what
    // goes wrong in terms of behaviour. "It is untidy" is the report's job.
    assert.ok(GATED_RULES.length >= 3);
    for (const rule of GATED_RULES) {
      assert.match(rule.rule, /^[\w@/-]+$/);
      assert.match(rule.since, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(rule.why.length > 60, `${rule.rule} needs a reason in terms of what breaks`);
    }
    assert.equal(new Set(GATED_RULES.map((r) => r.rule)).size, GATED_RULES.length);
  });

  it("gates only rules the tree is actually at zero for", () => {
    // Not re-run here — `npm run lint:eslint-gate` IS that assertion, and
    // running ESLint twice over 1011 files to say it again would add a minute
    // to every suite run. What this pins is the pairing: a rule on the list
    // whose findings the tree still carries makes the gate leg red, which is
    // the whole design.
    const guarded = GATED_RULES.map((r) => r.rule);
    assert.ok(guarded.includes("react-hooks/refs"));
    assert.ok(guarded.includes("react-hooks/rules-of-hooks"));
    assert.ok(guarded.includes("react-hooks/purity"));
    assert.ok(guarded.includes("react-hooks/globals"));
    assert.ok(guarded.includes("import/export"));
    assert.ok(
      !guarded.includes("react-hooks/set-state-in-effect"),
      "30 findings the triage calls correct cannot be gated without 26 disables written to make a gate green",
    );
  });

  it("leaves the rule it drove to zero OFF the list, which is the bar doing something", () => {
    // `react-hooks/preserve-manual-memoization` was one of the four unread
    // errors read on 2026-10-03 and the fix was taken: `app/listing/[id].tsx`
    // hoisted one string above a `useMemo`, the compiler could not prove the
    // hoisted value would not be mutated after the memo read it, and it
    // declined to compile the 763-line screen at all.
    //
    // It is still not gated, and that is the first time the bar in
    // `lib/eslint-gate.ts` has excluded a rule rather than described one.
    // What the rule reports is a MISSED OPTIMIZATION, and nothing in this tree
    // turns React Compiler on — no `reactCompiler` experiment, no compiler
    // plugin in the Babel config — so a `why` sentence for it would have to
    // describe a cost this build does not pay.
    assert.ok(
      !GATED_RULES.map((r) => r.rule).includes("react-hooks/preserve-manual-memoization"),
      "a rule whose cost this build does not pay is the report's job, not the gate's",
    );
    assert.equal(readRepoFile("app.json").includes("reactCompiler"), false);
    assert.equal(readRepoFile("babel.config.js").includes("react-compiler"), false);
  });

  it("refuses a zero from a rule the config has switched off", () => {
    // The anti-vacuous half, and the way a ratchet becomes decoration: drop
    // the react-hooks plugin and four of the five gated rules report nothing,
    // forever, green. The wrapper asks ESLint for the resolved config first.
    const wrapper = readRepoFile("scripts/check-eslint-gate.ts");
    assert.match(wrapper, /calculateConfigForFile/);
    assert.match(wrapper, /gated but not enabled by the resolved config/);
    assert.match(wrapper, /const CONFIG_PROBE = "lib\/use-latest-ref\.ts";/);
  });

  it("fails rather than passes when ESLint lints nothing", () => {
    // The same floor every guard here keeps: a walk that read nothing proves
    // its negative over an empty tree.
    assert.match(readRepoFile("scripts/check-eslint-gate.ts"), /linted 0 files/);
  });
});

describe("it is a leg of the gate, not a script beside it", () => {
  it("runs inside npm run verify, in the chain and in the labels", () => {
    const legs = gateLegs().map((leg) => leg.script);
    assert.ok(legs.includes("lint:eslint-gate"), "the gate must actually reach it");
    assert.equal(GATE_LEG_LABELS["lint:eslint-gate"], "eslint gate");
    assert.equal(legs.length, 10);
  });

  it("runs after the text guards, which are the fast half", () => {
    // ESLint's walk behind the text guards': 22s against 13s on CI, ~60s
     // against ~2s in the dev sandbox. A contributor should hear about an
     // inline hex literal before waiting for a parse of 1012 files.
    const legs = gateLegs().map((leg) => leg.script);
    assert.ok(legs.indexOf("lint:eslint-gate") > legs.indexOf("lint:all"));
    assert.ok(legs.indexOf("lint:eslint-gate") < legs.indexOf("test"));
  });

  it("is in ci.yml too, which is what verify-gate-script.test.ts compares against", () => {
    assert.match(readRepoFile(".github/workflows/ci.yml"), /run: npm run lint:eslint-gate/);
  });

  it("is documented as exempt from lint:all rather than missing from it", () => {
    // It runs ESLint, not a text scan; `lint:all`'s registry is the text
    // guards, and a leg that is neither in it nor documented is the shape
    // lint-guards.test.ts refuses.
    assert.ok(LINT_ALL_EXEMPT["lint:eslint-gate"]);
    assert.match(LINT_ALL_EXEMPT["lint:eslint-gate"], /tenth leg/);
  });
});

describe("the two read rules stay read", () => {
  const finding = (file: string, rule: string): EslintFinding => ({
    file,
    line: 1,
    rule,
    message: "whatever the rule says",
    severity: 1,
  });
  const RULE = "react-hooks/exhaustive-deps";
  const triaged = [
    { rule: RULE, registry: "lib/exhaustive-deps-triage.ts", expected: new Map([["lib/a.ts", 2]]) },
  ];

  it("says nothing when the run and the registry agree", () => {
    assert.deepEqual(
      untriagedFindings([finding("lib/a.ts", RULE), finding("lib/a.ts", RULE)], triaged),
      [],
    );
  });

  it("reports a finding nobody has read, which is the whole point", () => {
    const problems = untriagedFindings(
      [finding("lib/a.ts", RULE), finding("lib/a.ts", RULE), finding("lib/b.ts", RULE)],
      triaged,
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /lib\/b\.ts reports 1 finding\(s\) and lib\/exhaustive-deps-triage\.ts accounts for 0/);
    assert.match(problems[0], /give it a verdict/);
  });

  it("reports an entry describing a finding that has gone, from the other side", () => {
    const problems = untriagedFindings([finding("lib/a.ts", RULE)], triaged);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /verdict about nothing/);
  });

  it("ignores findings from every other rule", () => {
    assert.deepEqual(
      untriagedFindings(
        [finding("lib/a.ts", RULE), finding("lib/a.ts", RULE), finding("lib/z.ts", "import/first")],
        triaged,
      ),
      [],
    );
  });

  it("both registries account for a tree the gate currently passes", () => {
    // The registries' own arithmetic, held here as well as by the gate: a
    // `fixed` verdict contributes nothing, because the finding it describes
    // is gone. 30 live set-state findings from 31 entries, 11 live
    // exhaustive-deps findings from 11 entries of which two are fixed and one
    // stands for three.
    const sum = (counts: ReadonlyMap<string, number>) =>
      [...counts.values()].reduce((total, n) => total + n, 0);
    assert.equal(sum(setStateByFile()), 30);
    assert.equal(sum(exhaustiveDepsByFile()), 11);
  });
});
