import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { repoPath, readRepoFile } from "./helpers/repo-file";

/**
 * The `STATUS AUDIT` tables in `.tasks/`, held to the files they cite.
 *
 * ## Why these tables exist
 *
 * Three planning documents — `.security-upgrade.md`, `.be-suggestions.md`,
 * `.design.md` — describe work as TO DO that has since shipped in full. A run
 * picking work off one re-derives that from the code: this session spent two
 * passes on the security document before auditing it, and stated one item as
 * open before checking properly. Each now opens with a table naming the file
 * that implements each item.
 *
 * ## Why they need a guard
 *
 * A table of paths is a claim about the tree, and it goes stale exactly the
 * way the prose it replaced did — silently, at the next rename. That is the
 * whole failure being fixed, so shipping three new instances of it without a
 * check would be replacing a stale document with a stale document.
 *
 * The rule is narrow on purpose: every backticked token in an audit table that
 * LOOKS like a repo path must exist. It says nothing about whether the
 * evidence is convincing, only that it is real.
 */

/** The audited plans. A document with no audit block is simply not covered. */
const PLANS = [
  ".tasks/.security-upgrade.md",
  ".tasks/.be-suggestions.md",
  ".tasks/.design.md",
] as const;

const AUDIT_HEADING = "## STATUS AUDIT";

/**
 * The audit block: from its heading to the first line that leaves the
 * blockquote.
 *
 * Every audit is written as a `>` quote so it reads as an editorial note
 * rather than as part of the plan, which also makes its extent unambiguous.
 */
function auditBlock(markdown: string): string | null {
  const start = markdown.indexOf(AUDIT_HEADING);
  if (start < 0) return null;
  const lines = markdown.slice(start).split("\n");
  const block: string[] = [];
  for (const line of lines) {
    if (block.length > 0 && !line.startsWith(">")) break;
    block.push(line);
  }
  return block.join("\n");
}

/**
 * Backticked tokens that look like repo paths.
 *
 * A directory segment or a known source extension — enough to catch
 * `lib/fonts.ts` and `supabase/tests/01_core_tables_rls.sql` while ignoring
 * `EXPO_PUBLIC_REALTIME_DISABLED`, `lint:migration-docs` and `gen_random_uuid`,
 * which are cited as evidence and are not files. A token with a `/` that is
 * NOT a file is the case this would wrongly flag; none is cited today, and the
 * failure message says to quote such a thing without backticks.
 */
function citedPaths(block: string): readonly string[] {
  const found = new Set<string>();
  for (const [, token] of block.matchAll(/`([^`]+)`/g)) {
    const looksLikePath =
      /^[\w./@[\]-]+$/.test(token) &&
      (token.includes("/") || /\.(ts|tsx|sql|md|json|yml)$/.test(token));
    if (looksLikePath) found.add(token);
  }
  return [...found];
}

describe("STATUS AUDIT tables cite files that exist", () => {
  it("finds an audit block in every plan that is supposed to carry one", () => {
    // A parse that found nothing reads exactly like a clean tree, which is the
    // failure mode every derived rule in this repo has had at least once.
    for (const plan of PLANS) {
      const block = auditBlock(readRepoFile(plan));
      assert.ok(block !== null, `${plan} has no ${AUDIT_HEADING} block — add one or drop it here`);
      assert.ok(
        block.length > 200,
        `${plan}'s audit block is ${String(block.length)} characters — that is not a table`,
      );
    }
  });

  it("cites at least a dozen real paths across the three plans", () => {
    // A floor, so a regex that stopped matching cannot pass as "nothing to
    // check". The exact count is not the point and would churn on every edit.
    const total = PLANS.reduce((sum, plan) => {
      const block = auditBlock(readRepoFile(plan));
      return sum + (block === null ? 0 : citedPaths(block).length);
    }, 0);
    assert.ok(
      total >= 12,
      `only ${String(total)} path-shaped citations found across the audits — the reader has probably stopped matching`,
    );
  });

  for (const plan of PLANS) {
    it(`${plan}: every cited path is in the tree`, () => {
      const block = auditBlock(readRepoFile(plan));
      assert.ok(block !== null);
      const missing = citedPaths(block).filter((cited) => !existsSync(repoPath(cited)));
      assert.deepEqual(
        missing,
        [],
        `${plan}'s audit cites paths that do not exist: ${missing.join(", ")} — a renamed file makes the audit exactly as wrong as the prose it replaced. If one of these is not a file, quote it without backticks.`,
      );
    });
  }
});
