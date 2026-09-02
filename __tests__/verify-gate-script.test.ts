import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";

import { PUBLISHED_ELSEWHERE_NOTE } from "@/lib/audit-baseline";

import { gateScriptPaths, networkMarkerHit } from "./helpers/gate-legs";
import { readRepoFile as read } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";
import { SUITES_REL } from "./helpers/suite-files";

/**
 * Pins `npm run verify` as the ONE command that runs the full gate.
 *
 * Before this existed the gate was four entry points (`typecheck`,
 * `lint:all`, `test`, `build`) chained only by convention: `lint:ci` covered
 * three of them and omitted the build, so every run re-assembled the sequence
 * by hand and any run could quietly drop a leg. Every task entry in
 * `.tasks/.tasks.md` ends by reciting the same four results, which is the
 * shape of a checklist, not a gate.
 *
 * `verify` composes rather than re-lists: `npm run lint:ci && npm run build`.
 * That matters because the alternative — spelling the four legs out again —
 * creates a second definition of the gate that can drift from `lint:ci`, and
 * `lint:ci` is the one ci.yml's ordering was reasoned about against.
 *
 * The assertions below cover three separate failure modes:
 *   1. a leg dropped from `verify` (or from `lint:ci` underneath it),
 *   2. `verify` and ci.yml drifting apart, so green locally stops meaning
 *      green on CI — the exact class the Node 20 outage belonged to,
 *   3. the chain losing its fail-fast `&&`, which would let a red leg be
 *      masked by a later green one.
 */

const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

/**
 * Expands `npm run <script>` / `npm test` references until only real commands
 * remain, so an assertion can ask "does verify reach tsc?" without caring how
 * many script layers sit in between. Cycles are impossible to run but easy to
 * write, so the visited set is a guard against hanging the suite rather than
 * a correctness detail.
 */
const resolveScript = (name: string, seen = new Set<string>()): string => {
  if (seen.has(name)) return "";
  seen.add(name);
  const body = pkg.scripts[name];
  if (!body) return "";
  return body.replace(
    /npm\s+(?:run\s+)?([\w:-]+)/g,
    (match, referenced: string) => {
      // `npm test` and `npm run test` both reach the `test` script; anything
      // else npm-shaped (npm ci, npm audit) is not a script reference here.
      if (!pkg.scripts[referenced]) return match;
      const expanded = resolveScript(referenced, seen);
      // The pretest hook is invoked by npm, not written in the command, so it
      // has to be spliced in for the expansion to reflect what actually runs.
      const hook = pkg.scripts[`pre${referenced}`]
        ? `${resolveScript(`pre${referenced}`, seen)} && `
        : "";
      return `${hook}${expanded}`;
    },
  );
};

describe("npm run verify is the whole gate in one command", () => {
  it("declares a `verify` script", () => {
    assert.ok(
      pkg.scripts.verify,
      "package.json must declare a `verify` script — the single pre-commit gate",
    );
  });

  it("composes lint:ci and the build instead of re-listing their legs", () => {
    const verify = pkg.scripts.verify;
    assert.match(
      verify,
      /npm run lint:ci\b/,
      "`verify` must delegate to `lint:ci` so the gate has one definition, not two",
    );
    assert.match(
      verify,
      /npm run build\b/,
      "`verify` must add the web build — the leg `lint:ci` deliberately omits",
    );
  });

  it("runs the cheap legs before the slow build", () => {
    const verify = pkg.scripts.verify;
    assert.ok(
      verify.indexOf("lint:ci") < verify.indexOf("run build"),
      "`verify` must gate on lint:ci first — a type error should cost seconds, not a full expo export",
    );
  });

  it("chains fail-fast so a red leg cannot be masked by a later green one", () => {
    const verify = pkg.scripts.verify;
    assert.match(
      verify,
      /&&/,
      "`verify` legs must be chained with && — `;` or `&` would report the last leg's status only",
    );
    assert.doesNotMatch(
      verify,
      /(^|[^&])(;|\|\|)/,
      `\`verify\` must not swallow a failing leg; got "${verify}"`,
    );
  });

  it("reaches all four legs of the gate once expanded", () => {
    const expanded = resolveScript("verify");
    const LEGS: Array<[string, RegExp]> = [
      ["typecheck", /\btsc\b[^&]*--noEmit/],
      ["code-style guards", /lint-all\.ts/],
      ["test suites", /--test\b/],
      ["web build", /expo export/],
    ];
    for (const [label, pattern] of LEGS) {
      assert.match(
        expanded,
        pattern,
        `\`npm run verify\` must reach the ${label} leg; expanded to: ${expanded}`,
      );
    }
  });

  it("does not shadow or absorb the unrelated verify:bundle-inlining script", () => {
    // `verify` and `verify:bundle-inlining` are separate npm scripts (npm
    // matches names exactly, so there is no collision), but folding the
    // bundle check into the gate would make every local run pay for a
    // dist/ scan that only makes sense after a deploy build.
    assert.ok(
      pkg.scripts["verify:bundle-inlining"],
      "verify:bundle-inlining must survive as its own script",
    );
    assert.doesNotMatch(
      pkg.scripts.verify,
      /verify:bundle-inlining/,
      "the gate must not run the post-deploy bundle scan",
    );
  });

  it("keeps `verify` free of npm lifecycle hooks that would run it implicitly", () => {
    // A `preverify`/`postverify` would make the gate do something the script
    // body does not say, which is the ambiguity `verify` exists to remove.
    for (const hook of ["preverify", "postverify"]) {
      assert.equal(
        pkg.scripts[hook],
        undefined,
        `${hook} would run work that \`verify\`'s definition does not show`,
      );
    }
  });
});

describe("the local gate matches what CI runs", () => {
  const ciYml = read(path.join(".github", "workflows", "ci.yml"));
  // Comments are allowed to name a command while explaining it; only
  // executable lines count as "CI runs this".
  const ciCommands = ciYml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  /**
   * Every npm script ci.yml actually runs, READ FROM ci.yml.
   *
   * This was a hand-written list of four, and that is precisely how a green
   * `verify` came to precede a red CI: `lint:secrets:bundle`,
   * `lint:bundle-size` and `lint:bundle-smoke` run after the build on CI and
   * were in nobody's list, so the case below compared `verify` against a copy
   * of the four legs it already ran. A list restating the thing it checks
   * cannot notice a fifth.
   *
   * Derived, so the day somebody adds a tenth step the gate either grows or
   * goes red — and the failure names the step rather than the number.
   */
  const CI_SCRIPTS = [
    ...new Set(
      [...ciCommands.matchAll(/run:\s*npm\s+(?:run\s+)?([\w:-]+)/g)].map((m) => m[1]),
    ),
  ].filter((name) => pkg.scripts[name] !== undefined);

  /**
   * CI steps deliberately outside the local gate, each because it needs the
   * NETWORK and would turn an offline `verify` red for a reason that is not
   * the contributor's change.
   *
   * `lint:expo-install` degrades to a skip on an unreachable registry, which
   * is exactly why it is worth nothing locally, and it is advisory in ci.yml
   * so a green CI never depended on it.
   *
   * `lint:audit-baseline` used to sit here too, on the second half of that
   * reasoning: it was `npm audit --audit-level=high` with
   * `continue-on-error: true`. It BLOCKS now, so it joined the gate instead —
   * an exclusion is only ever for a step whose failure CI itself ignores.
   */
  const NOT_IN_THE_LOCAL_GATE = ["lint:expo-install"];

  it("finds a real list of scripts in ci.yml rather than an empty one", () => {
    // The sweep hazard this file's own subject has: a walk that stops matching
    // satisfies "nothing is missing" perfectly.
    assert.ok(
      CI_SCRIPTS.length >= 6,
      `only ${String(CI_SCRIPTS.length)} npm scripts found in ci.yml — the reader stopped matching, which passes the case below vacuously`,
    );
  });

  for (const step of ["npm run typecheck", "npm run lint:all", "npm test", "npm run build"]) {
    it(`ci.yml still runs \`${step}\``, () => {
      assert.ok(
        ciCommands.includes(step),
        `ci.yml must keep running \`${step}\` as a named step — the named steps are what make a red run readable`,
      );
    });
  }

  it("runs nothing in CI's gate that `npm run verify` would skip locally", () => {
    const expanded = resolveScript("verify");
    const missing = CI_SCRIPTS.filter(
      (script) =>
        !NOT_IN_THE_LOCAL_GATE.includes(script) &&
        !expanded.includes(resolveScript(script)),
    );
    assert.deepEqual(
      missing,
      [],
      `these CI steps are not reachable from \`npm run verify\`: ${missing.join(", ")} — a green verify has to mean a green CI or it means nothing`,
    );
  });

  it("keeps every deliberate exclusion a step CI still runs", () => {
    // An exclusion for a step that has left ci.yml is a hole with nothing
    // about it looking stale.
    const gone = NOT_IN_THE_LOCAL_GATE.filter((script) => !CI_SCRIPTS.includes(script));
    assert.deepEqual(
      gone,
      [],
      `these are excluded from the local gate and CI no longer runs them: ${gone.join(", ")}`,
    );
  });
});

/**
 * Which legs of the gate can change their answer while the tree does not.
 *
 * `PUBLISHED_ELSEWHERE_NOTE` rides every failure of the audit gate and says
 * the thing a contributor needs to hear on a red run they did not cause: this
 * is "the one check here whose answer can change while the repository does
 * not". That sentence was true when it was written and nothing checked it.
 *
 * A tenth leg that shelled out to a registry would make it false silently, in
 * the one message written to be trusted — and the failure would land on
 * whoever met the audit gate next, not on whoever added the leg.
 *
 * ## What is scanned, and what that leaves out
 *
 * The CLI wrappers under `scripts/` that the gate reaches: the ones named in
 * `verify`'s expanded chain, plus every `LINT_GUARDS` entry, which `lint:all`
 * spawns one at a time. That is where every shell-out and every HTTP call in
 * this repository lives.
 *
 * The suites are out of scope for the SCAN even though `npm test` is a leg.
 * They stub `fetch` by name in dozens of files, and a marker scan cannot tell
 * a stub from a call — the scan would report a hundred hits and get read as
 * noise, which is the failure every guard here is written against.
 *
 * They are not out of scope for the CLAIM. Whether a call goes out is a
 * runtime fact rather than a textual one, so `__tests__/test-globals.ts`
 * replaces `globalThis.fetch` in every test process before any suite loads and
 * a request nobody stubbed throws. `network-refusal.test.ts` owns that; the
 * case below only checks the wiring is still there, because this file is where
 * the note's claim is measured and a leg covered somewhere else is still a leg
 * this file is answering for.
 */
describe("only one leg of the gate reads anything outside the tree", () => {
  /**
   * The markers and the scanned set both live in `helpers/gate-legs.ts`.
   *
   * They were written here and moved when the leg COUNT needed them too:
   * "the other eight legs read the tree" is this scan's answer subtracted
   * from the number of legs, and `gate-legs-restated.test.ts` checks that
   * sentence wherever it is written down. Two copies of the marker list would
   * have let the two rules disagree about which legs are hermetic — the exact
   * shape of drift both files exist to catch.
   */
  const GATE_SCRIPTS = gateScriptPaths();

  /** The files in a set whose source reaches something outside the tree. */
  const reachOut = (files: readonly string[]): { file: string; why: string }[] =>
    files.flatMap((file) => {
      const why = networkMarkerHit(read(file));
      return why === undefined ? [] : [{ file, why }];
    });

  it("finds a real population of gate scripts rather than an empty one", () => {
    // The sweep hazard the file above already carries: a walk that stopped
    // matching would satisfy "nothing reaches the network" perfectly.
    assert.ok(
      GATE_SCRIPTS.length >= 20,
      `only ${String(GATE_SCRIPTS.length)} gate scripts found — the resolver stopped matching, which passes the case below vacuously`,
    );
    assert.ok(
      GATE_SCRIPTS.includes("scripts/check-audit-baseline.ts"),
      "the audit gate is a leg of `verify` and must be in the scanned set",
    );
  });

  it("detects a network call at all, on scripts the gate does NOT run", () => {
    // The other half of anti-vacuous: the markers have to fire on something.
    // `db:find-duplicates` and `sentry:check` are standalone scripts that both
    // call `fetch`, and neither is reachable from `verify` — so they prove the
    // scan works without being findings.
    const everyScript = sourceFiles("scripts");
    const outsideTheGate = reachOut(everyScript)
      .map((found) => found.file)
      .filter((file) => !GATE_SCRIPTS.includes(file));
    assert.ok(
      outsideTheGate.length >= 2,
      `the markers found no network call anywhere outside the gate, so they would not find one inside it either; scanned ${String(everyScript.length)} scripts`,
    );
  });

  it("names the audit gate as the only leg that reads a live feed", () => {
    assert.deepEqual(
      reachOut(GATE_SCRIPTS),
      [
        {
          file: "scripts/check-audit-baseline.ts",
          why: "an `npm audit` of the registry",
        },
      ],
      "a second leg of `verify` now reads something outside the tree, which makes PUBLISHED_ELSEWHERE_NOTE's \"the one check here\" false — either keep the new leg hermetic, or rewrite that sentence and this case together",
    );
  });

  it("keeps the note claiming singularity, which is what this case measures", () => {
    // Pinned against the note rather than a paraphrase: a rewrite that dropped
    // the claim would leave this suite asserting a property nothing depends on.
    assert.match(
      PUBLISHED_ELSEWHERE_NOTE,
      /the one check here whose answer can change while the repository does not/,
      "the note no longer claims to be the only non-hermetic leg — the case above is measuring nothing",
    );
  });

  it("covers the one leg the scan cannot read, at runtime instead", () => {
    // `npm test` is a leg and the scan skips all 1420 of its files. The
    // bootstrap is what makes the note's claim true about them; without it,
    // "the one check here" would rest on the biggest leg being unexamined.
    const bootstrap = read(path.join(SUITES_REL, "test-globals.ts"));
    assert.match(
      bootstrap,
      /globalThis\.fetch = /,
      "__tests__/test-globals.ts no longer refuses an unstubbed request — the `test` leg is unexamined again, by this scan and by anything else",
    );
    assert.match(
      pkg.scripts.test,
      /--import \.\/__tests__\/test-globals\.ts/,
      "`npm test` no longer preloads the bootstrap, so nothing installs the refusal",
    );
  });

  it("leaves the excluded network step out of the gate, where it can stay", () => {
    // `lint:expo-install` is the one that would have to join this list, and it
    // is excluded from the local gate for exactly this reason.
    assert.ok(
      !GATE_SCRIPTS.includes("scripts/check-expo-install.ts"),
      "`check-expo-install` reaches the registry; a `verify` that ran it would make the note wrong",
    );
  });
});

describe("the gate is documented where a contributor will look", () => {
  it("CLAUDE.md names `npm run verify` as the command to run", () => {
    const claudeMd = read("CLAUDE.md");
    assert.match(
      claudeMd,
      /npm run verify/,
      "CLAUDE.md's Commands block must document the gate",
    );
  });

  it("the PR checklist asks for verify rather than a hand-assembled sequence", () => {
    const template = read(path.join(".github", "PULL_REQUEST_TEMPLATE.md"));
    assert.match(
      template,
      /npm run verify/,
      "the PR template checklist must ask for `npm run verify`",
    );
    assert.doesNotMatch(
      template,
      /`npm run lint:ci` is green/,
      "the checklist's old two-line spelling omitted no leg but invited running only one of them",
    );
  });
});
