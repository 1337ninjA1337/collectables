import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

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

const ROOT = process.cwd();

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

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

  const CI_STEPS = ["npm run typecheck", "npm run lint:all", "npm test", "npm run build"];

  for (const step of CI_STEPS) {
    it(`ci.yml still runs \`${step}\``, () => {
      assert.ok(
        ciCommands.includes(step),
        `ci.yml must keep running \`${step}\` as a named step — the named steps are what make a red run readable`,
      );
    });
  }

  it("runs nothing in CI's gate that `npm run verify` would skip locally", () => {
    const expanded = resolveScript("verify");
    const missing = CI_STEPS.filter((step) => {
      const script = step.replace(/^npm (run )?/, "");
      const body = pkg.scripts[script];
      // Compare on the resolved command, not the npm spelling: `verify`
      // reaches `test` through `lint:ci`, never by naming it.
      return body ? !expanded.includes(resolveScript(script)) : false;
    });
    assert.deepEqual(
      missing,
      [],
      `these CI steps are not reachable from \`npm run verify\`: ${missing.join(", ")}`,
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
