/**
 * The list of read rules, and the two things it stopped being a literal for.
 *
 * `TRIAGED_RULES` lived in `scripts/check-eslint-gate.ts` as a hand-written
 * array pairing a rule id with a registry's `findingsByFile()`. Two
 * suggestions had been carried about that for a week: a third reading meant
 * two edits rather than one, and nothing stopped a registry being wired to
 * the WRONG rule id — a complete reading of a rule it had never looked at,
 * which the gate would have reported as green.
 *
 * Both registries declare their own `RULE` now and the list is built from it,
 * so the pairing is not a thing to get right. These cases hold the parts of
 * that which are still statements somebody could break: that every entry's
 * rule id comes from its own module, that the registry paths point at files
 * that exist, and that the totals the snapshot takes from here are the sums
 * of the per-file maps rather than a second copy of them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as exhaustiveDeps from "@/lib/exhaustive-deps-triage";
import * as setStateInEffect from "@/lib/set-state-in-effect-triage";
import { TRIAGED_RULES, registryTotals } from "@/lib/triaged-rules";

import { readRepoFile } from "./helpers/repo-file";

describe("TRIAGED_RULES", () => {
  it("holds the two readings, each named by its own module", () => {
    assert.deepEqual(
      TRIAGED_RULES.map((rule) => rule.rule),
      [setStateInEffect.RULE, exhaustiveDeps.RULE],
    );
  });

  it("names a registry file that exists and declares that rule", () => {
    // The miswiring case, from the only direction still open: the path is a
    // string in this list, and it is what the gate's failure message tells a
    // contributor to go and edit.
    for (const rule of TRIAGED_RULES) {
      const source = readRepoFile(rule.registry);
      assert.ok(
        source.includes(`export const RULE = "${rule.rule}"`),
        `${rule.registry} does not declare RULE = "${rule.rule}"`,
      );
    }
  });

  it("accounts for at least one live finding per entry", () => {
    // A registry whose entries are all `fixed` is a reading of a population
    // that has gone, and it should leave the list rather than sit in it at
    // zero — which would also put a 0 row nowhere useful.
    for (const rule of TRIAGED_RULES) {
      assert.ok(rule.expected.size > 0, `${rule.registry} accounts for no files`);
    }
  });

  it("builds its rule ids from the modules rather than spelling them", () => {
    // The literal is what was wrong with the old list, so its absence is the
    // fix and is worth holding.
    const source = readRepoFile("lib/triaged-rules.ts");
    assert.ok(!source.includes('rule: "react-hooks/'), source);
  });
});

describe("registryTotals", () => {
  it("sums each registry's per-file counts", () => {
    const totals = registryTotals(TRIAGED_RULES);
    for (const rule of TRIAGED_RULES) {
      const summed = [...rule.expected.values()].reduce((a, b) => a + b, 0);
      assert.equal(totals.get(rule.rule), summed, rule.rule);
    }
  });

  it("is the report's two populations at 30 and 11", () => {
    // The numbers CLAUDE.md states, reached from the registries rather than
    // from a terminal. `exhaustive-deps` is 11 entries standing for 13
    // findings and the live sum is 11, because two of the entries are `fixed`
    // — which is exactly the arithmetic the snapshot used to restate.
    assert.deepEqual(
      Object.fromEntries(registryTotals(TRIAGED_RULES)),
      { "react-hooks/set-state-in-effect": 30, "react-hooks/exhaustive-deps": 11 },
    );
  });

  it("defaults to the committed list", () => {
    assert.deepEqual(
      Object.fromEntries(registryTotals()),
      Object.fromEntries(registryTotals(TRIAGED_RULES)),
    );
  });

  it("is zero for a registry with nothing live left", () => {
    assert.deepEqual(
      Object.fromEntries(
        registryTotals([{ rule: "read/rule", registry: "lib/none.ts", expected: new Map() }]),
      ),
      { "read/rule": 0 },
    );
  });
});

describe("the gate reads the list from here", () => {
  it("check-eslint-gate imports it rather than holding its own", () => {
    const wrapper = readRepoFile("scripts/check-eslint-gate.ts");
    assert.match(wrapper, /import \{ TRIAGED_RULES, registryTotals \} from "\.\.\/lib\/triaged-rules"/);
    assert.match(wrapper, /untriagedFindings\(findings, TRIAGED_RULES\)/);
    // And no longer builds the pairing itself, which is the edit a third
    // reading used to need.
    assert.ok(!wrapper.includes("findingsByFile"), "the gate still wires a registry up by hand");
  });
});
