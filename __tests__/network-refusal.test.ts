/**
 * The suites cannot reach the network, and this is where that is checked.
 *
 * WHAT THIS IS ABOUT. `PUBLISHED_ELSEWHERE_NOTE` rides every failure of the
 * audit gate telling a contributor it is "the one check here whose answer can
 * change while the repository does not". `verify-gate-script.test.ts` measures
 * that claim by scanning the gate's CLI wrappers for a remote read, and it
 * says out loud what it skips: the suites. `npm test` runs 1420 files, they
 * stub `fetch` by name in dozens of places, and a marker scan cannot tell a
 * stub from a call — so the leg with the most code in it, and the one most
 * likely to acquire a real request, was the leg nothing looked at.
 *
 * That was filed twice as a follow-up and both times as a gap in the SCAN. It
 * is not a scan problem. Whether a call goes out is a runtime fact, and the
 * runtime is right there: `__tests__/test-globals.ts` is preloaded into every
 * test process by `--import`, before any suite loads, so it can replace the
 * global and make a request that nobody stubbed throw instead of leave.
 *
 * ## Why stubbing is not a hole in it
 *
 * A suite that assigns `globalThis.fetch` has said what the response is; the
 * request never leaves either way. What the refusal catches is the call NOBODY
 * stubbed — a helper that grew a real request, a module that fetches on
 * import, a stub installed for one case and reached from another. Those are
 * the shapes that would send a request to a real host, and they are exactly
 * the ones no reader would spot in a diff.
 */

import assert from "node:assert/strict";
// The default import, deliberately: `import * as` compiles to a namespace COPY
// under `tsx`, and `optionsPassedBy` below has to replace the methods on the
// object a call site actually reads — the same live module the bootstrap
// patches to refuse a spawned network tool.
import childProcess from "node:child_process";
import { execFileSync, execSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { request } from "node:https";
import { describe, it } from "node:test";

import { arguedFloor, measuredFloor } from "./helpers/coverage-floor";
import { MARKER_ID_SHAPE, NETWORK_MARKERS } from "./helpers/gate-legs";
// The bootstrap's own reduction from a spawn argument to the tool it names, so
// the case below asks the refusal's question rather than a copy of it.
import {
  bootstrapInstances,
  networkTool,
  refusalAt,
  refusalPoints,
  refusalVerbAt,
  rewrappedRefusals,
} from "./test-globals";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The refusal as the bootstrap left it, captured before any case runs.
 *
 * A suite is free to stub the global — that is the point — so a case that read
 * `globalThis.fetch` at call time would be asking about whatever ran last.
 * This is the value every OTHER suite starts its life with.
 */
const installed = globalThis.fetch;

/**
 * What bounds a call when the refusal it is probing has gone.
 *
 * Two of the four probes ask a real `npm` and a real `npx` to do something, and
 * rely entirely on `NETWORK_TOOLS` refusing them before the process starts. If
 * it stopped covering either name, the probe would not fail — it would RUN, and
 * `npm audit` against the registry is slow, needs a network, and is precisely
 * what this whole file exists to prevent. The failure mode of the case that
 * guards the refusal would be a hang.
 *
 * A killed spawn turns that back into an assertion: the child gets a
 * millisecond and SIGKILL, `execFileSync` throws for the wrong reason, and
 * `assert.throws` reports a message that is not the refusal's. Nothing here is
 * load-bearing while the refusal works — it never reaches a spawn at all.
 *
 * At file scope rather than inside the probe describe, because the wiring
 * describe at the bottom calls every registered refusal directly and needs the
 * same bound for the same reason: those calls are spawns too when the thing
 * they are checking is the thing that broke.
 */
const BOUNDED = { timeout: 1, killSignal: "SIGKILL", stdio: "ignore" } as const;

describe("a test that reaches the network fails instead", () => {
  it("throws rather than returning a promise, so nothing awaits a real host", () => {
    // Synchronous on purpose: a rejected promise is something a suite can
    // swallow with a `.catch`, and half the value here is that the failure
    // lands in the case that made the call.
    assert.throws(
      () => installed("https://registry.npmjs.org/postcss"),
      /tried to fetch https:\/\/registry\.npmjs\.org\/postcss/,
    );
  });

  it("names what was being fetched, however the caller spelled it", () => {
    // The three shapes `fetch` takes. A message that said "a request" would
    // send the reader looking through 1420 files for the caller.
    assert.throws(() => installed(new URL("https://example.test/a")), /https:\/\/example\.test\/a/);
    assert.throws(
      () => installed({ url: "https://example.test/b" } as unknown as Request),
      /https:\/\/example\.test\/b/,
    );
    assert.throws(() => installed(undefined as unknown as string), /an unnamed request/);
  });

  it("says where the refusal came from and what to do instead", () => {
    // A failure nobody can act on gets worked around. This one names the file
    // that installed it and the one legitimate way past it.
    assert.throws(() => installed("https://example.test"), {
      message: /Stub the call for the case that needs a response/,
    });
    assert.throws(() => installed("https://example.test"), {
      message: /__tests__\/test-globals\.ts/,
    });
  });

  it("lets a suite stub the global, because a stub never leaves the process", () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (() =>
        Promise.resolve({ ok: true })) as unknown as typeof globalThis.fetch;
      assert.doesNotThrow(() => globalThis.fetch("https://example.test"));
    } finally {
      globalThis.fetch = original;
    }
    // And restoring puts the refusal back, which is what every suite that
    // saves and restores the global is relying on without knowing it.
    assert.throws(() => globalThis.fetch("https://example.test"), /tried to fetch/);
  });
});

describe("the other ways out of the tree", () => {
  // The audit gate's scan names four shapes for a read outside the tree: a
  // `fetch`, an http/https client, an `npm audit` and an `npx expo install`.
  // The refusal shipped covering the first, and a refusal that covered one of
  // four would leave the other three exactly as invisible as `fetch` was on
  // the morning the case for it was made.

  it("refuses http and https, through the module object", () => {
    for (const client of [http, https]) {
      assert.throws(
        () => client.request("http://example.test/x"),
        /open an http connection to http:\/\/example\.test\/x/,
      );
      assert.throws(() => client.get("http://example.test/y"), /example\.test\/y/);
    }
  });

  it("refuses a NAMED import of the same function", () => {
    // The shape the patch is not obviously able to reach, and the reason it
    // does: `tsx` transpiles these suites to CommonJS, so a named import
    // compiles to a property read at CALL time. Under a native-ESM runner the
    // binding would be made when the builtin was evaluated and this case would
    // go red — which is the point of pinning it rather than assuming it.
    assert.throws(() => request("https://example.test/named"), /example\.test\/named/);
  });

  it("refuses a spawned network tool, whatever path it is given as", () => {
    for (const spawnCurl of [
      () => execFileSync("curl", ["https://example.test"]),
      () => execFileSync("/usr/bin/curl", ["https://example.test"]),
      () => execSync("wget https://example.test -O -"),
      () => execFileSync("npm", ["audit"]),
      () => execFileSync("npx", ["expo", "install", "--check"]),
    ]) {
      assert.throws(spawnCurl, /tried to spawn (?:curl|wget|npm|npx)/);
    }
  });

  it("lets the spawns this repository actually makes through", () => {
    // Refusing spawning outright would break the guard-fixture suites, which
    // run `node`, `tsx` and `git` dozens of times — and those are reads of
    // THIS TREE, which is the thing the whole rule is about.
    assert.equal(execFileSync(process.execPath, ["-e", "process.stdout.write('ok')"], {
      encoding: "utf8",
    }), "ok");
  });
});

/**
 * The scan and the refusal describe the same property and were written apart.
 *
 * `NETWORK_MARKERS` is what `verify-gate-script.test.ts` looks for in a gate
 * script's TEXT; the bootstrap's patches are what a suite is refused at
 * RUNTIME. They agreed on the day the second was written from the first by
 * hand, which is the arrangement every "two copies" entry in `.tasks/` is
 * about — so the population comes from the scan's list here, and a fifth
 * marker with no runtime probe is a red run rather than a quiet asymmetry.
 */
describe("every marker the scan reads is refused at runtime", () => {
  /**
   * The http client a specifier names, so a probe can take it the way the
   * marker's pattern reads it.
   *
   * The other three markers describe a CALL, which a probe body can simply
   * be. This one describes an import specifier, and a probe cannot import at
   * call time — so it names the module the same way an import would and the
   * lookup happens at runtime. That is what lets `patternPerformedBy` below
   * relate this probe to its own marker instead of to any of the others; it
   * is not evidence that an import of `node:https` is refused, which is a
   * claim nothing here makes and nothing here needs.
   */
  function httpClient(specifier: "node:http" | "node:https"): {
    request: (url: string) => unknown;
  } {
    return specifier === "node:https" ? https : http;
  }

  // Keyed by the marker's `id`, not by its sentence. The sentence is written
  // to be read in a failure message and rewording one for clarity used to
  // break this parity case — a red run about nothing, fixed by a copy-paste.
  //
  // Each body is written as the SHAPE its marker's pattern reads, because the
  // key relates the two by name and only the text relates them by meaning.
  // `fetch` is taken off `globalThis` at call time rather than through the
  // captured `installed`, which is both what the pattern reads and what a real
  // suite would do; the cases above are the ones that need the capture.
  const PROBES: Readonly<Record<string, () => unknown>> = {
    "npm-audit": () => execFileSync("npm", ["audit", "--json"], BOUNDED),
    "expo-install-check": () => execFileSync("npx", ["expo", "install", "--check"], BOUNDED),
    fetch: () => globalThis.fetch("https://example.test"),
    "http-client": () => httpClient("node:https").request("https://example.test"),
  };

  /** The markers whose pattern fires on this probe's own source text. */
  function patternPerformedBy(probe: () => unknown): readonly string[] {
    const source = probe.toString();
    return NETWORK_MARKERS.filter((marker) => marker.pattern.test(source)).map((m) => m.id);
  }

  /**
   * Every way `node:child_process` starts a process, asked of the module.
   *
   * This was six names typed out, chosen because they covered the two probes
   * that spawned the day it was written — `fork` was not among them, and a
   * probe that forked would have read as not spawning at all. The module knows
   * its own surface: what it exports and what a suite can call are the same
   * list, so the only thing left to write down is the two exports that are not
   * a way to start a process.
   *
   * `ChildProcess` is the class a spawn RETURNS, told apart by node's own
   * convention that a constructor is capitalised; `_forkChild` is the internal
   * entry point node calls inside a child it already made, told apart by the
   * underscore that says so. Neither starts anything.
   */
  const SPAWN_NAMES = Object.entries(childProcess)
    .filter(([name, value]) => typeof value === "function" && /^[a-z]/.test(name))
    .map(([name]) => name)
    // Longest first, so `execFileSync` is not matched as `exec` and then
    // rejected for the `F` that follows. Alternation backtracking would find
    // it anyway; ordering means the reader does not have to know that.
    .sort((a, b) => b.length - a.length);

  /**
   * A call that starts a process, as it survives `tsx`.
   *
   * A closing paren counts as well as an opening one, because `tsx` compiles
   * `execFileSync(…)` to `(0, import_node_child_process.execFileSync)(…)` —
   * the call is still there and the name is no longer against its own bracket.
   */
  const SPAWN_CALL = new RegExp(`\\b(?:${SPAWN_NAMES.join("|")})\\s*[()]`);

  /**
   * The probes whose source reads as starting a process.
   *
   * `BOUNDED` went onto the two that existed the hour it was written, and a
   * third would be written next to two that carry it and inherit nothing. The
   * population is not a list: a probe that spawns says so in the source the
   * pairing case already reads.
   */
  function probesThatSpawn(): readonly (readonly [string, () => unknown])[] {
    const spawns = Object.entries(PROBES).filter(([, probe]) => SPAWN_CALL.test(probe.toString()));
    // A detector that matched nothing would agree with every probe there is.
    assert.ok(spawns.length >= 2, measuredFloor(spawns.length, 2, "probe(s) read as spawning"));
    return spawns;
  }

  /**
   * What a recorder throws in place of starting a child, as one shared object.
   *
   * It was created fresh inside `optionsPassedBy`, which is all that function
   * needs — it compares by identity against the one it just made. A probe that
   * wants to swallow the stop and keep going cannot: it has nothing to compare
   * against, so it swallows with a bare `catch` and would swallow a REAL
   * spawn's error exactly as quietly. Naming the sentinel once is what lets a
   * probe say "the recorder's stop, and nothing else".
   */
  const RECORDER_STOP = new Error("recorded — the probe stops here rather than starting a child");

  /**
   * The arguments a probe hands its spawn, taken from the call itself.
   *
   * Every name in `SPAWN_NAMES` is replaced on the live module — the same
   * object the bootstrap patched, which is why this file imports the default
   * rather than a namespace — with a recorder that throws instead of calling
   * through, so the probe stops before a child exists. Restoring is in a
   * `finally`: leaving a recorder behind would disarm the refusal for every
   * suite that runs after this one.
   *
   * Two readers want different arguments out of the same call — the bound is
   * the last one, the tool is the first — so what this returns is the call.
   *
   * `reraise` is what the probe's OWN failure does. The restore cases need it
   * thrown: that path is their subject. A reader that only wants the recorded
   * arguments does not, and one probe here throws deliberately after its spawn
   * — asking it what it called would otherwise mean catching its failure at
   * every call site. The recorded call is complete either way; the probe had
   * already made it.
   */
  function spawnCallOf(probe: () => unknown, reraise = true): readonly unknown[] {
    const mutable = childProcess as unknown as Record<string, unknown>;
    const saved = SPAWN_NAMES.map((name) => [name, mutable[name]] as const);
    const recorded: unknown[][] = [];
    try {
      for (const name of SPAWN_NAMES) {
        mutable[name] = (...args: unknown[]) => {
          recorded.push(args);
          throw RECORDER_STOP;
        };
      }
      try {
        probe();
      } catch (error) {
        if (error !== RECORDER_STOP && reraise) throw error;
      }
    } finally {
      for (const [name, value] of saved) mutable[name] = value;
    }
    assert.equal(
      recorded.length,
      1,
      `a probe that reads as spawning made ${String(recorded.length)} calls into \`node:child_process\` — the recorder is on the wrong object, or the source and the runtime disagree about what this probe does`,
    );
    return recorded[0] ?? [];
  }

  /**
   * The options a probe hands its spawn.
   *
   * The bound used to be checked by matching `BOUNDED` in the probe's source,
   * which proves the word is in the text and not that the object reached the
   * spawn: a probe naming it in a comment, or handing it to the wrong
   * parameter, read exactly the same. The property is that the child cannot
   * outlive the case, and the only thing carrying it is the options argument.
   *
   * Every probe here spawns synchronously, and a sync spawn's options are its
   * last argument. An async one would end in a callback and fail this, which is
   * correct: what bounds an async child is a different question.
   */
  function optionsPassedBy(probe: () => unknown): unknown {
    return spawnCallOf(probe).at(-1);
  }

  /**
   * The tool a probe's spawn would have started, as the bootstrap names it.
   *
   * The first argument of the recorded call, put through the bootstrap's own
   * `networkTool` — the function the refusal uses to decide what a spawn is
   * asking for. This was a second reduction written here (first token, then
   * basename), correct on the day it was written and load-bearing only while it
   * agreed with the one that matters; the two-copies arrangement four entries in
   * `.tasks/` are about.
   *
   * `undefined` means the probe's spawn names nothing the refusal covers, which
   * is not a tool-naming problem but a probe that would never have been refused.
   */
  function spawnToolOf(probe: () => unknown): string {
    const called = spawnCallOf(probe, false)[0];
    const tool = networkTool(called);
    assert.ok(
      tool !== undefined,
      `a probe that spawns names \`${String(called)}\`, which the bootstrap does not count as a network tool — it would run rather than be refused, and the case below would be asking which refusal it let through when there was never going to be one`,
    );
    return tool;
  }

  /** The module's spawn methods as they stand right now, in `SPAWN_NAMES` order. */
  function spawnMethods(): readonly unknown[] {
    const mutable = childProcess as unknown as Record<string, unknown>;
    return SPAWN_NAMES.map((name) => mutable[name]);
  }

  /**
   * That every spawn method is the one `before` held, name by name.
   *
   * Three cases below make this comparison — after each spawning probe, and
   * after each of the two paths a probe can throw on. They were three copies of
   * one loop differing only in the sentence, which is the arrangement that lets
   * a fourth reader be written slightly wrong.
   */
  function assertRestored(before: readonly unknown[], why: (name: string) => string): void {
    const mutable = childProcess as unknown as Record<string, unknown>;
    for (const [index, name] of SPAWN_NAMES.entries()) {
      assert.equal(mutable[name], before[index], why(name));
    }
  }

  /** What the probes below throw as their OWN failure, told apart by identity. */
  const PROBE_BOOM = new Error("the probe's own failure, not the recorder's stop");

  /**
   * The probes that fail on purpose, named so their source can be read.
   *
   * Two things want them. The cases below ask whether `optionsPassedBy` restores
   * the module on each of the paths a probe can throw on; the swallow rule asks
   * whether a probe that catches a spawn's throw catches the right one. The
   * second cannot ask that of a closure written inside a case body, which is
   * where both of these lived — and the hole it exists to close was live in
   * exactly such a closure for one commit.
   */
  const THROWING_PROBES: Readonly<Record<string, () => unknown>> = {
    // Never reaches a spawn: recorders installed, nothing recorded.
    "before-spawning": () => {
      throw PROBE_BOOM;
    },
    // The state a real probe fails in: recorders installed, one call recorded,
    // and a throw of its own after the spawn's throw was swallowed.
    "after-recording": () => {
      try {
        // Hits a recorder, which throws rather than starting anything. The
        // bound rides along because a probe that reached a real spawn here
        // would be the failure this whole file is about.
        execFileSync("npm", ["audit", "--json"], BOUNDED);
      } catch (error) {
        // By identity, not with a bare `catch`: a bare one swallows the
        // bootstrap's refusal too, so if no recorder were installed this probe
        // would spawn a real `npm audit`, drop whatever came back, and still
        // throw its own error — the case passing while a child had started,
        // which is the one outcome this file exists to make impossible.
        if (error !== RECORDER_STOP) throw error;
      }
      throw PROBE_BOOM;
    },
  };

  /**
   * Every probe in the file, from the two tables that hold them.
   *
   * The swallow rule spread them together — `{ ...PROBES, ...THROWING_PROBES }`
   * — which silently keeps ONE probe when an id appears in both, and the one it
   * keeps is the throwing one. A marker's probe could be shadowed out of the
   * rule that judges it while the parity case, which reads `PROBES` alone, went
   * on passing. Two tables keyed by strings deserve better than a reader that
   * assumes they are disjoint, so this says so.
   */
  function allProbes(): readonly (readonly [string, () => unknown])[] {
    const shared = Object.keys(PROBES).filter((id) => id in THROWING_PROBES);
    assert.deepEqual(
      shared,
      [],
      `\`${shared.join("`, `")}\` is an id in both probe tables — merging them drops one, so a rule that reads the merge would judge the wrong body under that name`,
    );
    return [...Object.entries(PROBES), ...Object.entries(THROWING_PROBES)];
  }

  /**
   * The probes whose source reads as swallowing something.
   *
   * The population the swallow rules ask their question of, with the floor
   * inside it: a detector that matched nothing would agree with every probe
   * there is.
   */
  function probesThatCatch(): readonly (readonly [string, () => unknown])[] {
    const catching = allProbes().filter(([, probe]) => /\bcatch\b/.test(probe.toString()));
    assert.ok(
      catching.length >= 1,
      measuredFloor(catching.length, 1, "probe(s) read as catching anything"),
    );
    return catching;
  }

  /**
   * A `catch` that binds what it caught, as it survives `tsx`.
   *
   * The shape a probe needs in order to be ABLE to tell the recorder's stop
   * from a real spawn's error. `catch {}` — no binding — cannot, which is the
   * whole of the hole.
   */
  const CATCH_BINDING = /catch\s*\(\s*[A-Za-z_$][\w$]*\s*\)/;

  /**
   * A function written to be READ, for the premise the source rules share.
   *
   * Three rules in this describe judge a probe by its transpiled text —
   * `patternPerformedBy` runs the markers over it, `SPAWN_CALL` finds the
   * probes that start a process, `CATCH_BINDING` finds the ones that can tell
   * what they swallowed. All rest on `Function.prototype.toString` still
   * handing back the source somebody wrote, and each stated that dependency in
   * its own comment before anything asserted it.
   *
   * It is never called. Its body carries one of each shape the three readers
   * look for — two marker literals, a spawn call name, and a `catch` that
   * binds — so a runner that minified these suites, or a `toString` that
   * answered `[native code]`, is named by this case rather than by the cases
   * below whose messages all blame the probes.
   */
  function sourcePremiseControl(): void {
    try {
      execFileSync("npm", ["audit"], BOUNDED);
    } catch (error) {
      if (error !== RECORDER_STOP) throw error;
    }
    void fetch("https://example.test");
  }

  it("reads a function's source as the text somebody wrote, which the rules below assume", () => {
    const source = sourcePremiseControl.toString();
    assert.ok(
      !source.includes("[native code]"),
      "`Function.prototype.toString` no longer returns a body — every rule here that reads a probe's source is now asking a question about the string `[native code]`",
    );
    // The marker reader, given a body that performs two of the four shapes:
    // an exact answer no single probe produces, so a pattern that had stopped
    // firing and a pattern that fired on everything both show up here.
    assert.deepEqual(
      patternPerformedBy(sourcePremiseControl),
      ["npm-audit", "fetch"],
      "the marker patterns no longer read this source the way they read a gate script's text — the pairing case below would report that as probes filed under the wrong markers",
    );
    assert.match(
      source,
      SPAWN_CALL,
      "a spawn call in the source is no longer found by name — the bound case below would report that as no probe spawning at all",
    );
    assert.match(
      source,
      CATCH_BINDING,
      "a `catch` that binds what it caught is no longer found in a body that has one — the swallow rule below would read every probe as catching nothing and pass on all of them",
    );
  });

  it("has a probe for every marker, and no probe for a marker that has gone", () => {
    const markers = NETWORK_MARKERS.map((marker) => marker.id).sort();
    assert.deepEqual(
      Object.keys(PROBES).sort(),
      markers,
      "the scan's markers and the runtime probes have drifted — a marker with no probe is a shape the suites can still perform, and a probe with no marker is a refusal nothing asks for",
    );
  });

  it("refuses each of them, so the two describe one property", () => {
    for (const marker of NETWORK_MARKERS) {
      // Reported by the sentence, keyed by the id: the failure names the shape
      // a reader recognises and the wiring names something stable.
      assert.throws(PROBES[marker.id], /A test tried to/, `${marker.why} is not refused at runtime`);
    }
  });

  it("performs the shape its own marker's pattern reads, and no other", () => {
    // The gap this closes: the parity case compares two key sets and the
    // refusal case looks a probe up by the same key, so `fetch` could be the
    // id on the http-client marker and every case would still pass. A key
    // relates the two by NAME. The pair that has to agree in MEANING is the
    // pattern and the probe, and the one text both can be judged against is
    // the probe's own source — the same thing the scan reads in a script.
    for (const marker of NETWORK_MARKERS) {
      assert.deepEqual(
        patternPerformedBy(PROBES[marker.id]),
        [marker.id],
        `the \`${marker.id}\` probe is not the shape its pattern reads — a probe pointed at the wrong marker throws the same way and passes every other case here`,
      );
    }
  });

  it("would fail on the swap it exists to catch", () => {
    // The planted offender, because a rule nobody has watched refuse anything
    // is one that reads as passing whether it works or not: the two probes
    // that used to be indistinguishable here, exchanged. The mechanism names
    // the marker each one really performs, not the key it was filed under.
    const swapped: Readonly<Record<string, () => unknown>> = {
      ...PROBES,
      fetch: PROBES["http-client"],
      "http-client": PROBES.fetch,
    };
    assert.deepEqual(patternPerformedBy(swapped["http-client"]), ["fetch"]);
    assert.deepEqual(patternPerformedBy(swapped.fetch), ["http-client"]);
  });

  it("takes the ways to start a process from the module, not from a list", () => {
    // The six names this replaced, kept as the floor rather than as the rule:
    // a derivation that quietly dropped one would leave a probe reading as not
    // spawning, which is the same silence the hand list produced for `fork`.
    for (const name of ["exec", "execFile", "execSync", "execFileSync", "spawn", "spawnSync"]) {
      assert.ok(
        SPAWN_NAMES.includes(name),
        `\`${name}\` was in the hand-written list and the module no longer offers it — a probe calling it reads as not spawning, so its bound would go unchecked`,
      );
    }
    // And the one the hand list missed, which is the whole argument for asking
    // the module: nobody left it out on purpose, no probe forked that morning.
    assert.ok(
      SPAWN_NAMES.includes("fork"),
      "`fork` is a way to start a process and is not in the set — the derivation is reproducing the omission it was written to end",
    );
    // The two exports that are not a way to start anything. Including either
    // would make `SPAWN_CALL` match a probe that only handled a child.
    assert.ok(!SPAWN_NAMES.includes("ChildProcess"), "the class a spawn returns is being read as a spawn");
    assert.ok(!SPAWN_NAMES.includes("_forkChild"), "node's internal child entry point is being read as a spawn");
  });

  it("hands the bound to every spawn, rather than naming it in the source", () => {
    // This was `assert.match(probe.toString(), /\bBOUNDED\b/)`, which measures
    // that the word is in the text. A probe naming it in a comment, or handing
    // it to the wrong parameter, satisfied that and would still have started a
    // child nothing could interrupt — so the reading is of the call now, and
    // the comparison is identity: this exact options object, at the position a
    // sync spawn reads its options from.
    //
    // Which probes are asked is still a source question, and that reading is
    // the premise `sourcePremiseControl` above asserts.
    for (const [id, probe] of probesThatSpawn()) {
      assert.equal(
        optionsPassedBy(probe),
        BOUNDED,
        `the \`${id}\` probe spawns without the bound reaching the call — if its refusal went missing the case below would hang on a real process instead of failing`,
      );
    }
  });

  it("leaves the shared module exactly as it found it, after every probe that spawns", () => {
    // `optionsPassedBy` replaces every spawn name on the live module and puts
    // them back in a `finally`. That restore is the only thing standing between
    // this case and every suite that runs after it: a recorder left installed
    // does not call through, so a later spawn hits `throw stop` instead of the
    // bootstrap's refusal — and it fails for a reason with this file's name
    // nowhere in it. The `finally` is correct today and nothing watched it.
    //
    // Ran on `npm-audit` alone at first, which is a claim about one probe read
    // as a claim about the function: the other spawn probe passes a different
    // body through the same swap, and "they share `optionsPassedBy`" is the
    // very assumption a case about a shared module should not be making. The
    // population is the same derived one the bound case reads, so a third
    // spawning probe is covered by existing rather than by being remembered.
    // Snapshotted once, OUTSIDE the loop: each probe is asserted back to the
    // wrappers the bootstrap installed, not merely to whatever the probe before
    // it left behind — which a per-probe snapshot would quietly accept.
    const before = spawnMethods();
    for (const [id, probe] of probesThatSpawn()) {
      optionsPassedBy(probe);
      assertRestored(
        before,
        (name) =>
          `\`optionsPassedBy\` left \`${name}\` replaced after the \`${id}\` probe — a recorder now outlives the call, so every later suite spawns into it instead of the refusal`,
      );
    }
    // The property the identity check stands in for, measured end to end: the
    // refusal the whole file exists to install still fires after the swaps.
    assert.throws(() => execFileSync("curl", ["https://example.test"]), /tried to spawn curl/);
  });

  it("restores the module even when the probe throws something that is not the recorder's stop", () => {
    // The restore has to survive a probe that throws before it ever spawns —
    // otherwise a probe with a bug would take the refusal down with it. The
    // `finally` is what makes that true, and this is the throw that exercises
    // the path `optionsPassedBy` re-raises rather than swallows.
    const before = spawnMethods();
    assert.throws(
      () => optionsPassedBy(THROWING_PROBES["before-spawning"]),
      (error: unknown) => error === PROBE_BOOM,
      "a probe that throws before spawning is being swallowed or reported as something else",
    );
    assertRestored(
      before,
      (name) =>
        `a throwing probe left \`${name}\` replaced — the restore does not cover the path where the probe fails before it spawns`,
    );
  });

  it("restores the module when the probe throws AFTER a recorder has fired", () => {
    // The case above never reaches a spawn, so the state it leaves behind is
    // recorders installed and nothing recorded. That is not the state a real
    // probe fails in: a probe with its own `try` around its spawn swallows the
    // stop, keeps going, and throws something of its own — recorders installed,
    // one call recorded, and the re-raise path taken. Both halves of the
    // `finally`'s job were being proved on the same half of its input.
    const before = spawnMethods();
    assert.throws(
      () => optionsPassedBy(THROWING_PROBES["after-recording"]),
      (error: unknown) => error === PROBE_BOOM,
      "a probe that throws after spawning is being swallowed or reported as the recorder's own stop",
    );
    assertRestored(
      before,
      (name) =>
        `a probe that threw after recording left \`${name}\` replaced — the restore covers the path where a probe fails before its spawn and not the one where it fails after`,
    );
  });

  it("swallows the recorder's stop by identity, in every probe that swallows at all", () => {
    // The hole this closes was live for one commit. The `after-recording`
    // probe caught its spawn's throw with a bare `catch`, which swallows the
    // bootstrap's refusal exactly as quietly: with no recorder installed the
    // probe would have spawned a real `npm audit`, dropped whatever came back,
    // and still thrown its own error — green while a child had started. It was
    // found by reading the diff, fixed in the probe, and nothing in the tree
    // said so, which leaves the next probe that needs to swallow a spawn one
    // `catch {}` away from reopening it.
    //
    // Read off the source, like the marker and spawn rules, and asked of a
    // population rather than of the two bodies that exist today.
    for (const [id, probe] of probesThatCatch()) {
      const source = probe.toString();
      assert.match(
        source,
        CATCH_BINDING,
        `the \`${id}\` probe swallows with a bare \`catch\` — it cannot tell the recorder's stop from a real spawn's refusal, so a missing recorder would let it start a child and still pass`,
      );
      assert.match(
        source,
        /\bRECORDER_STOP\b/,
        `the \`${id}\` probe catches without comparing against \`RECORDER_STOP\` — whatever it swallows, it swallows the bootstrap's refusal too`,
      );
    }
  });

  it("lets a refusal through, measured by handing a swallowing probe one", () => {
    // The rule above matches the identifier `RECORDER_STOP` in a probe's
    // source, which proves the name is in the text. A probe that compared
    // against it and swallowed anyway reads exactly the same — the shape the
    // bound rule was retired for one entry ago, reappearing in the rule written
    // to close a different instance of it.
    //
    // What the probe has to DO is re-raise anything that is not the stop, and
    // the way to measure that is to hand it something else. Called directly —
    // no recorder installed, because `optionsPassedBy` is not in this call —
    // the probe's spawn meets the bootstrap's refusal, which is the error a
    // bare `catch` ate. Nothing is spawned: the refusal is why.
    const spawningCatchers = probesThatCatch().filter(([, probe]) =>
      SPAWN_CALL.test(probe.toString()),
    );
    assert.ok(
      spawningCatchers.length >= 1,
      measuredFloor(spawningCatchers.length, 1, "probe(s) both spawning and catching"),
    );
    for (const [id, probe] of spawningCatchers) {
      // The tool comes off the recorded call, so what is asserted is that the
      // refusal the probe let through is the one ITS OWN spawn earned.
      // `/A test tried to/` is the prefix of all four refusals: a probe that
      // fetched instead would have satisfied it just as well, which makes it a
      // check that some refusal happened rather than that this one did.
      const tool = spawnToolOf(probe);
      assert.throws(
        probe,
        (error: unknown) =>
          error !== PROBE_BOOM &&
          error instanceof Error &&
          new RegExp(`tried to spawn ${tool}\\b`).test(error.message),
        `the \`${id}\` probe did not let through the refusal for spawning \`${tool}\` — whatever its source says it compares against, what it does is eat the one throw that says its own spawn was attempted`,
      );
    }
  });

  it("bounds a spawn that got through, so the failure is red rather than a hang", () => {
    // The control for `BOUNDED`, measured on a spawn the refusal does not
    // touch: a node process that would never exit on its own. If the bound
    // were wrong, this case is the one that hangs — and it hangs on a spin
    // loop instead of on a suite quietly asking the npm registry a question.
    const started = Date.now();
    assert.throws(
      () => execFileSync(process.execPath, ["-e", "while (true) {}"], BOUNDED),
      (error: unknown) => error instanceof Error,
      "an unrefused spawn is unbounded again, so a probe whose refusal went missing would hang instead of failing",
    );
    assert.ok(
      Date.now() - started < 10_000,
      "the bound let a spawn run for ten seconds, which is long enough for a real `npm audit` to reach the registry",
    );
  });

  it("keeps the ids distinct and free of prose", () => {
    // An id that drifted back into being a sentence would put this suite back
    // where it started, and two markers sharing one would hide a missing probe
    // behind a passing key comparison.
    const ids = NETWORK_MARKERS.map((marker) => marker.id);
    assert.equal(new Set(ids).size, ids.length, "two markers share an id");
    for (const id of ids) {
      assert.match(id, MARKER_ID_SHAPE, `\`${id}\` is a sentence, not an identifier`);
    }
  });
});

describe("the refusal is wired into every test process", () => {
  const pkg = JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> };

  it("is preloaded by --import, before any suite can load", () => {
    // A bootstrap a suite imports itself would cover the suites that
    // remembered to. `--import` covers the ones that have not been written.
    for (const script of ["test", "test:only", "test:sentry"]) {
      assert.match(
        pkg.scripts[script],
        /--import \.\/__tests__\/test-globals\.ts/,
        `\`npm run ${script}\` runs suites without the bootstrap, so nothing refuses a request in them`,
      );
    }
  });

  it("is one instance of the bootstrap, however a suite reaches it", () => {
    // This file imports the bootstrap for `networkTool`, so the module the
    // `--import` evaluated and the module a suite names have to be the same
    // one. A second instance would wrap every spawn method around the first's
    // wrapper and re-assign `fetch` — and nothing would go red: the refusal
    // still fires, and every identity check here compares against whatever was
    // installed by the time it read the module. The `beforeEach` this
    // bootstrap registers would also run twice per test.
    //
    // It was proved once by putting a `console.error` in the module body and
    // counting lines, which is not a thing the tree can do again.
    assert.equal(
      bootstrapInstances(),
      1,
      `the bootstrap has been evaluated ${String(bootstrapInstances())} times — a suite is importing it by a specifier that resolves to a second module instance, so the refusal is wrapped around itself and every case here is measuring the copy that happened to be installed last`,
    );
  });

  it("is the outermost thing at every point it patched, not merely present", () => {
    // The instance count above says the module body ran once. That is not the
    // same question as how deep the refusal is stacked: anything that wraps a
    // patched point AFTER the bootstrap — a second bootstrap, or a helper that
    // saves and restores wrongly — leaves the count at one and puts a layer
    // between a caller and this refusal. The wrapper still refuses, so nothing
    // in this file goes red; it also gets to see, change or drop the call
    // first, and `optionsPassedBy` in the describe above is proof that code
    // here does exactly that kind of swapping.
    //
    // Every point, not the six spawn methods: `globalThis.fetch` and the four
    // http client methods come from the same module body, and until the
    // bootstrap remembered them a layer over the fetch refusal was exactly as
    // invisible as a spawn wrapper was before any of this was written. `fetch`
    // is the one the suites stub constantly, so it is both the likeliest point
    // to acquire a layer and, in this process, the one a leaked stub shows up
    // at — which is a thing worth being red about rather than an exemption.
    assert.deepEqual(
      rewrappedRefusals(),
      [],
      "a refusal is no longer the value the bootstrap installed at that point — something replaced or wrapped it and did not put it back, so every call through it now goes through that first",
    );
  });

  it("remembers a refusal for every surface, not only the spawn methods", () => {
    // The case above is an identity comparison against a registry, and a
    // registry that remembered nothing would satisfy it perfectly: no entries,
    // no differences, green. Two things make it mean something.
    //
    // First, every point it names has to REFUSE when called — read live, the
    // way a call site reads it, so a name registered against something that is
    // not a refusal is not a member. `"curl"` reaches all three surfaces with
    // one argument: it is a network tool to a spawn, and not a URL to the
    // other two. The bound rides along for the reason it rides on the probes —
    // a spawn point that had stopped refusing would otherwise run it.
    //
    // The refusal has to be THIS point's. `/A test tried to/` is the prefix all
    // four share, so it says some refusal fired and not which — a point
    // registered against another surface's wrapper reads exactly the same, and
    // that is the fault a registry of eleven names invites. The verb comes from
    // the bootstrap, which passes it to `refuseNetwork` and to the registry in
    // one expression, so nothing here restates the sentence.
    const points = refusalPoints();
    for (const point of points) {
      const live = refusalAt(point) as (...args: unknown[]) => unknown;
      const verb = refusalVerbAt(point);
      assert.equal(typeof verb, "string", `\`${point}\` is registered with no verb`);
      assert.throws(
        () => live("curl", BOUNDED),
        (error: unknown) => {
          assert.ok(error instanceof Error, `\`${point}\` threw something that is not an Error`);
          assert.ok(
            error.message.startsWith(`A test tried to ${String(verb)} `),
            `\`${point}\` answered with "${error.message.slice(0, 72)}…" — that is not the refusal this surface installs, so the point is registered against another surface's wrapper`,
          );
          return true;
        },
        `\`${point}\` is registered as a refusal and did not refuse a call`,
      );
    }

    // Second, every surface the bootstrap patches has to still be represented.
    // A surface that lost its points would leave the case above silent about
    // it, which is the state `globalThis.fetch` and the http clients were in
    // for as long as the registry was a map of spawn methods.
    const surfaces = [...new Set(points.map((point) => point.split(".")[0]))].sort();
    assert.deepEqual(
      surfaces,
      ["childProcess", "globalThis", "http", "https"],
      "the bootstrap refuses on four surfaces and the registry no longer names them all — a caller reaching an unnamed one reaches whatever is there, and nothing here would say so",
    );
  });

  it("keeps the verbs able to tell one refusal from another", () => {
    // The case above reads a point's refusal by the verb its registry entry
    // names, and it reads it with a PREFIX test — the message is one sentence
    // and the verb sits inside it, so there is nowhere to cut it out of.
    //
    // A prefix test is only as strong as the verbs are unambiguous, and one
    // verb being another's opening WORDS is what breaks it: "fetch" reads
    // `A test tried to fetch `, and a refusal saying "fetch and follow" starts
    // with exactly that. The space is what makes this the only shape that
    // matters — "fetching" is not a hole, because the character after the
    // shorter verb is `i` rather than the space the match requires.
    //
    // Two verbs that are simply EQUAL are the same statement, and http/https
    // sharing one is the design: both refuse identically, so a point of one
    // registered against the other is not a fault anything here needs to name.
    const verbs = [...new Set(refusalPoints().map((point) => String(refusalVerbAt(point))))];

    // One verb everywhere would make the case above a restatement of the
    // prefix it replaced, and this check a loop with no pairs in it.
    assert.ok(
      verbs.length >= 2,
      arguedFloor(
        verbs.length,
        2,
        "distinct verb(s) among the registry's refusals",
        "two is the fewest that lets a verb tell one refusal from another; with one verb everywhere, reading it says nothing the shared prefix did not",
      ),
    );

    // The pair loop below is about verbs telling each other apart, and it says
    // nothing about the one verb that tells NOTHING apart. `""` is registered,
    // matched and reported like any other: the sentence becomes "A test tried
    // to  curl", the expected prefix becomes "A test tried to  ", and the two
    // agree — while the pair loop asks whether another verb opens with `" "`
    // and finds that none does. An empty verb passes every reader here and
    // identifies no surface at all.
    //
    // A verb is words: the message puts exactly one space on each side of it,
    // so an edge space or a doubled one shifts the prefix the population case
    // builds by a character it did not intend.
    const VERB_SHAPE = /^\S+(?: \S+)*$/;
    for (const verb of verbs) {
      assert.match(
        verb,
        VERB_SHAPE,
        `"${verb}" is not a verb the message can carry — the sentence spaces it on both sides, so an empty one, or one with an edge or doubled space, moves the prefix the case above compares against`,
      );
    }

    for (const verb of verbs) {
      for (const other of verbs) {
        if (verb === other) continue;
        assert.ok(
          !other.startsWith(`${verb} `),
          `"${other}" opens with "${verb}", so a refusal from the longer one satisfies the shorter one's match — the case above would accept it for a point registered against the wrong surface`,
        );
      }
    }
  });

  it("installs the refusal at module scope rather than in a beforeEach", () => {
    // A `beforeEach` would fight every suite that stubs `fetch` in a `before`
    // or at module scope — it would reinstall the refusal underneath a stub
    // that was deliberately put there. Once, at import, is the only placement
    // that refuses the unstubbed call without breaking the stubbed one.
    const bootstrap = readRepoFile("__tests__/test-globals.ts");
    const assignment = bootstrap.indexOf("globalThis.fetch = ");
    assert.ok(assignment > 0, "the bootstrap no longer replaces `fetch`");
    assert.ok(
      !/beforeEach\([^)]*\{[^}]*globalThis\.fetch/s.test(bootstrap),
      "the refusal is being reinstalled per test, which would overwrite a suite's own stub",
    );
  });
});
