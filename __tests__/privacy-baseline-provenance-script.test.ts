import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  formatBaselineProvenanceFailure,
  formatBaselineRevisionUnparseable,
} from "../lib/privacy-baseline-provenance";
import { PRIVACY_BODY_BASELINES } from "../lib/privacy-body-baselines";
import { PROVENANCE_TABLES } from "../lib/provenance-tables";

import { readRepoFile, REPO_ROOT, repoPath } from "./helpers/repo-file";

/**
 * End-to-end cover for the GIT half of the baseline-provenance guard.
 *
 * `classifyBaselineRevision` is unit-tested in all three states next door, and
 * until this suite existed the wiring that feeds it — `git cat-file -e` for the
 * presence bit, then `git show` for the text — was covered by a probe run once
 * by hand. `merge-base` is what makes the obvious local test impossible: a
 * scratch commit here that deletes or mangles `lib/privacy-body-baselines.ts`
 * resolves back to the fork point, which still holds a good table, so `absent`
 * and `unparseable` cannot be reached from inside this repository at all.
 *
 * So each case gets a throwaway repository containing precisely the history it
 * needs, and the script is pointed at it with `PRIVACY_BASELINE_REPO_ROOT`. The
 * table under test is still this checkout's `PRIVACY_BODY_BASELINES` — only the
 * history moves — which is why the drift case can assert an exact failure
 * message built from the real `en` entry.
 */

const CHECK_NAME = "check-privacy-baseline-provenance";
const SCRIPT = repoPath("scripts", "check-privacy-baseline-provenance.ts");
const BASELINE_MODULE = "lib/privacy-body-baselines.ts";
/** The second table the guard covers — see the case that drifts it. */
const TRANSLATION_MODULE = "lib/privacy-translated-section.ts";

const REAL_BASELINE_SOURCE = readRepoFile(BASELINE_MODULE);

const scratchRepos: string[] = [];
after(() => {
  for (const repo of scratchRepos) {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `git ${args.join(" ")} failed in ${cwd}: ${run.stderr}`,
  );
  return (run.stdout ?? "").trim();
}

function write(root: string, relative: string, contents: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/**
 * A two-commit repository: `baseFiles` land in the first commit, and the second
 * touches an unrelated file so `HEAD` is genuinely ahead of the base.
 *
 * The unrelated second commit matters — it is what makes `git diff --name-only
 * <base>` return something that is not a policy file, so the drift case's
 * `policy_unchanged` finding is a fact about the fixture rather than an empty
 * diff being read as "nothing was touched".
 */
function repoWithBase(baseFiles: Readonly<Record<string, string>>): {
  readonly root: string;
  readonly base: string;
} {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "baseline-provenance-")),
  );
  scratchRepos.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "guard@example.test");
  git(root, "config", "user.name", "Baseline Provenance Test");
  git(root, "config", "commit.gpgsign", "false");
  for (const [relative, contents] of Object.entries(baseFiles)) {
    write(root, relative, contents);
  }
  write(root, "README.md", "base revision\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base revision");
  const base = git(root, "rev-parse", "HEAD");
  write(root, "README.md", "head revision\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "head revision");
  return { root, base };
}

type GuardRun = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

function runGuard(
  root: string,
  base: string,
  overrides: Readonly<Record<string, string>> = {},
): GuardRun {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", SCRIPT, "--base", base],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PRIVACY_BASELINE_REPO_ROOT: root,
        // Cleared so a CI run's own PR context cannot pick the base out from
        // under the fixture; `--base` wins over both, and this pins that.
        PRIVACY_BASELINE_BASE_REF: "",
        GITHUB_BASE_REF: "",
        ...overrides,
      },
    },
  );
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  };
}

/** The real module with `en`'s count rewritten, so the drift half has a move. */
function baselineSourceWithEnglishWords(words: number): string {
  const source = REAL_BASELINE_SOURCE.replace(
    `words: ${PRIVACY_BODY_BASELINES.en.words},`,
    `words: ${words},`,
  );
  assert.notEqual(
    source,
    REAL_BASELINE_SOURCE,
    "fixture could not rewrite the English word count — the table's formatting changed",
  );
  return source;
}

describe("check-privacy-baseline-provenance against a scratch repository", () => {
  it("announces the redirected history on every run", () => {
    const { root, base } = repoWithBase({
      [BASELINE_MODULE]: REAL_BASELINE_SOURCE,
    });
    const run = runGuard(root, base);
    assert.match(
      run.stdout,
      new RegExp(`${CHECK_NAME}: history read from ${root} `),
      `override was not announced:\n${run.stdout}${run.stderr}`,
    );
  });

  it("compares against a base revision that holds a table", () => {
    const { root, base } = repoWithBase({
      [BASELINE_MODULE]: REAL_BASELINE_SOURCE,
    });
    const run = runGuard(root, base);
    assert.equal(run.status, 0, `expected a pass:\n${run.stdout}${run.stderr}`);
    assert.ok(
      run.stdout.includes(`compared against ${base}`),
      `the drift half did not report a comparison:\n${run.stdout}`,
    );
    assert.ok(
      !run.stdout.includes("drift half skipped"),
      `the drift half skipped when the table was right there:\n${run.stdout}`,
    );
  });

  it("prints one report per registered table, in the order the registry declares", () => {
    // The order became load-bearing when the guard stopped having one pass per
    // table: reports print in `PROVENANCE_TABLES` order, and an array literal is
    // a much easier thing to reorder by accident than two statements were.
    // Derived from the registry rather than from a list of names, so a fourth
    // table is covered by this on the commit that adds it.
    const { root, base } = repoWithBase({});
    const run = runGuard(root, base);
    assert.equal(run.status, 0, `expected a pass:\n${run.stdout}${run.stderr}`);

    const positions = PROVENANCE_TABLES.map((table) => {
      const outcome = table.run(CHECK_NAME, {
        ref: null,
        present: false,
        source: null,
        changedFiles: [],
      });
      assert.equal(outcome.kind, "evaluated", `${table.id} did not evaluate`);
      const report = outcome.kind === "evaluated" ? outcome.report : "";
      const at = run.stdout.indexOf(report);
      assert.notEqual(
        at,
        -1,
        `${table.id} is registered and its report is not in the output:\n${report}\n---\n${run.stdout}`,
      );
      return at;
    });
    assert.deepEqual(
      positions,
      [...positions].sort((left, right) => left - right),
      `the reports printed out of registry order:\n${run.stdout}`,
    );
  });

  it("skips the drift half when the module did not exist at the base", () => {
    const { root, base } = repoWithBase({});
    const run = runGuard(root, base);
    assert.equal(run.status, 0, `expected a pass:\n${run.stdout}${run.stderr}`);
    assert.ok(
      run.stdout.includes(
        `drift half skipped — ${BASELINE_MODULE} did not exist at ${base}, so the guard predates it.`,
      ),
      `expected the predates-it skip:\n${run.stdout}`,
    );
  });

  it("fails when the module existed at the base and yields no table", () => {
    const { root, base } = repoWithBase({
      [BASELINE_MODULE]:
        "// The table was moved, renamed or reformatted past the parser.\nexport const PRIVACY_BODY_BASELINE_WORDS = {};\n",
    });
    const run = runGuard(root, base);
    assert.equal(
      run.status,
      1,
      `a removed table has to fail, not skip:\n${run.stdout}${run.stderr}`,
    );
    assert.ok(
      run.stderr.includes(
        formatBaselineRevisionUnparseable(CHECK_NAME, BASELINE_MODULE, base),
      ),
      `expected the unparseable message:\n${run.stderr}`,
    );
    assert.ok(
      !run.stdout.includes("drift half skipped"),
      `an unparseable revision must not read as a skip:\n${run.stdout}`,
    );
    // And no OTHER table's report either. The hard failure means one table's
    // drift half is off, and a pass line printed beside it is a report from a
    // guard running on one leg — which is the whole reason the loop checks every
    // table for this before printing anything.
    assert.ok(
      !run.stdout.includes("well-formed"),
      `a table reported a pass alongside the unparseable failure:\n${run.stdout}`,
    );
  });

  it("runs the translation-checksum table against its own previous revision", () => {
    // The second table this guard covers. Its `current` is always this
    // checkout's imported object — only history moves — so the fixture supplies
    // a BASE revision whose checksums differ while the note and date match the
    // shipped ones. That is the paste this table's note column exists to refuse,
    // and it reaches the script through the same base-ref resolution the
    // baselines table uses, which is the whole reason the two share a guard.
    const drifted = readRepoFile(TRANSLATION_MODULE).replace(
      /sourceChecksum: "[0-9a-f]{16}"/g,
      'sourceChecksum: "0000000000000000"',
    );
    const { root, base } = repoWithBase({
      [BASELINE_MODULE]: REAL_BASELINE_SOURCE,
      [TRANSLATION_MODULE]: drifted,
    });
    const run = runGuard(root, base);
    assert.equal(
      run.status,
      1,
      `a checksum that moved with its note standing still has to fail:\n${run.stdout}${run.stderr}`,
    );
    assert.match(run.stderr, /PRIVACY_TRANSLATION_SOURCES\["de"\]/);
    assert.match(run.stderr, /same note and date/);
    assert.ok(
      run.stdout.includes("baseline(s) well-formed"),
      `the other table's pass must still be reported on stdout:\n${run.stdout}`,
    );
  });

  it("names the redirected history on the pass line, not only before the run", () => {
    const { root, base } = repoWithBase({
      [BASELINE_MODULE]: REAL_BASELINE_SOURCE,
    });
    const run = runGuard(root, base);
    assert.equal(run.status, 0, `expected a pass:\n${run.stdout}${run.stderr}`);
    assert.ok(
      run.stdout.includes(
        `that pass read history from ${root}, not from this checkout.`,
      ),
      `the green summary did not say where it read from:\n${run.stdout}`,
    );
  });

  it("fails when the root is not a git work tree, rather than skipping as an empty repository", () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "baseline-provenance-bare-")),
    );
    scratchRepos.push(root);
    fs.writeFileSync(path.join(root, "README.md"), "an exported copy\n");
    const run = runGuard(root, "0000000000000000000000000000000000000000");
    assert.equal(
      run.status,
      1,
      `a directory with no history must not pass:\n${run.stdout}${run.stderr}`,
    );
    assert.ok(
      run.stderr.includes(`${root} is not a git work tree`),
      `expected the not-a-work-tree error:\n${run.stderr}`,
    );
    assert.ok(
      !run.stdout.includes("no commits in this work tree yet"),
      `a non-repository was mistaken for an unborn HEAD:\n${run.stdout}`,
    );
  });

  it("refuses a redirected history that was given no explicit base", () => {
    const { root } = repoWithBase({
      [BASELINE_MODULE]: REAL_BASELINE_SOURCE,
    });
    // No `--base`, and both base env vars cleared: exactly the shape of a
    // workflow that exported PRIVACY_BASELINE_REPO_ROOT once and left the
    // guard to guess. HEAD~1 resolves in that repository, so without this the
    // run would compare the table against an unrelated commit and pass.
    const run = spawnSync(process.execPath, ["--import", "tsx", SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PRIVACY_BASELINE_REPO_ROOT: root,
        PRIVACY_BASELINE_BASE_REF: "",
        GITHUB_BASE_REF: "",
      },
    });
    assert.equal(
      run.status,
      1,
      `a guessed base in a redirected repository must not pass:\n${run.stdout}${run.stderr}`,
    );
    assert.ok(
      (run.stderr ?? "").includes(
        "PRIVACY_BASELINE_REPO_ROOT is set without an explicit base",
      ),
      `expected the explicit-base error:\n${run.stderr}`,
    );
  });

  it("fails when git cannot be run, rather than reading its absence as an empty repository", () => {
    const { root, base } = repoWithBase({
      [BASELINE_MODULE]: REAL_BASELINE_SOURCE,
    });
    // An empty PATH is the cheapest honest ENOENT: node was launched by
    // absolute path and tsx resolves out of this checkout, so the only thing
    // it takes away is the `git` the guard shells out to.
    const run = runGuard(root, base, { PATH: "" });
    assert.equal(
      run.status,
      1,
      `a missing git must not report a pass:\n${run.stdout}${run.stderr}`,
    );
    assert.ok(
      run.stderr.includes("could not be run in"),
      `expected the git-unavailable error:\n${run.stderr}`,
    );
    assert.ok(
      !run.stdout.includes("no commits in this repository yet"),
      `a missing git was mistaken for an empty repository:\n${run.stdout}`,
    );
  });

  it("reports a words change whose provenance and policy file did not move", () => {
    const previousWords = 900;
    const { root, base } = repoWithBase({
      [BASELINE_MODULE]: baselineSourceWithEnglishWords(previousWords),
    });
    const run = runGuard(root, base);
    assert.equal(
      run.status,
      1,
      `expected the drift half to fail:\n${run.stdout}${run.stderr}`,
    );

    const move = `${previousWords} → ${PRIVACY_BODY_BASELINES.en.words}`;
    for (const failure of [
      {
        language: "en",
        code: "policy_unchanged" as const,
        detail: `${move}, but PRIVACY.md is untouched`,
      },
      {
        language: "en",
        code: "provenance_unchanged" as const,
        detail: `${move}, still dated ${PRIVACY_BODY_BASELINES.en.recordedOn}`,
      },
    ]) {
      assert.ok(
        run.stderr.includes(
          formatBaselineProvenanceFailure(CHECK_NAME, failure),
        ),
        `missing the ${failure.code} finding:\n${run.stderr}`,
      );
    }
  });
});
