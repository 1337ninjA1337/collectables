import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { LINT_GUARDS } from "@/lib/lint-guards";
import { ARCHIVE_ENTRY_SEPARATOR } from "@/lib/secret-scan";

import { checkNameOf, makePartialRoot, runGuardIn, type PartialRoot } from "./helpers/guard-fixture";
import { SUITES_REL } from "./helpers/suite-files";
import { zipFixture } from "./helpers/zip-fixture";

/**
 * `check-secrets` opens archives now. Does it, when it is actually run?
 *
 * The wiring was pinned by four regexes over the wrapper's own source, which
 * is the shape `SKIP_FILES` had before it moved into `lib/` and started being
 * compared by value — and it is the weakest thing in that guard, because the
 * archive path has more that can silently do nothing than the text path does:
 * the walk can miss the extension, the reader can hand back an entry nobody
 * decoded, the report can name a path with no file at the end of it, and every
 * one of those prints "no committed secrets" and exits 0.
 *
 * So the guard is spawned against a scratch root with a planted `.pbit` and
 * asked. The plant is DEFLATED, streamed and UTF-16LE — the shape Power BI
 * Desktop writes, which is the only shape that can carry a real connection
 * string, and the one the store-only reader this guard used to have refused.
 *
 * The floor is what shapes the fixtures: the guard refuses below 500 scanned
 * files, so a root it will look at all is a root that holds them. The suite
 * directory and `lib` are 584 between them; each KIND of planted archive costs
 * one copy, and the three cases that plant the same offender share theirs.
 */

const GUARD = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === "check-secrets");

/** A service_role JWT, built here rather than imported, so this file is self-contained. */
const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const SERVICE_ROLE_JWT = [
  b64url({ alg: "HS256", typ: "JWT" }),
  b64url({ iss: "supabase", ref: "abcdefghijklmnop", role: "service_role", iat: 1700000000 }),
  "c2lnbmF0dXJlc2lnbmF0dXJlc2ln",
].join(".");

const PLANT = "docs/powerbi/planted.pbit";
const ENTRY = "DataModelSchema";

/** UTF-16LE with a BOM — how every text part of a real `.pbit` is written. */
const part = (text: string) =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

/**
 * One scratch root per KIND of planted archive, built on first use.
 *
 * Memoised because the copy is the expensive part — 584 files to clear a floor
 * of 500 — and three of the cases below plant the same offender. `after` rather
 * than a `try`/`finally` per case, for the same reason: a root torn down
 * between two cases that share it is a root copied twice.
 */
const fixtures = new Map<string, PartialRoot>();
function rootWith(kind: string, archive: Buffer): PartialRoot {
  const existing = fixtures.get(kind);
  if (existing) return existing;
  const fixture = makePartialRoot([SUITES_REL, "lib"], { [PLANT]: archive });
  fixtures.set(kind, fixture);
  return fixture;
}
after(() => {
  for (const fixture of fixtures.values()) fixture.cleanup();
});

const OFFENDER = zipFixture(
  [
    { name: "Version", data: part("3.0") },
    {
      name: ENTRY,
      data: part(`{"expression": "Sql.Database(\\"host\\", [Password=\\"${SERVICE_ROLE_JWT}\\"])"}`),
    },
  ],
  { deflate: true, streamed: true },
);

describe("check-secrets, run against a tree with a planted archive", () => {
  it("is a guard this repository registers", () => {
    // The `find` above returning undefined would leave every case below
    // skipping its own subject while passing.
    assert.ok(GUARD, "check-secrets is not in LINT_GUARDS");
  });

  it("finds a service_role JWT inside a deflated, UTF-16 archive part", () => {
    assert.ok(GUARD);
    const run = runGuardIn(GUARD, rootWith("offender", OFFENDER).root);
    assert.equal(
      run.status,
      1,
      `the planted archive was not flagged, so nothing opened it:\n${run.output}`,
    );
    assert.match(run.output, /supabase-service-role-jwt/);
  });

  it("names the archive AND the entry inside it, so the finding can be located", () => {
    assert.ok(GUARD);
    const run = runGuardIn(GUARD, rootWith("offender", OFFENDER).root);
    // `docs/powerbi/planted.pbit!DataModelSchema` — the archive alone would
    // send a reader to a 7-part zip with no idea which part matched.
    assert.match(
      run.output,
      new RegExp(`${PLANT.replace(/[./]/g, "\\$&")}${ARCHIVE_ENTRY_SEPARATOR}${ENTRY}`),
    );
  });

  it("reports the archive at a path that resolves under the root it scanned", () => {
    assert.ok(GUARD);
    const fixture = rootWith("offender", OFFENDER);
    const run = runGuardIn(GUARD, fixture.root);
    const reported = run.output.match(
      new RegExp(`([\\w./-]*planted\\.pbit)${ARCHIVE_ENTRY_SEPARATOR}`),
    );
    assert.ok(reported, `no archive path in the report:\n${run.output}`);
    // The half before the separator is the only half that is a filesystem
    // path; joining the whole string on would open nothing, which is the
    // mistake the separator exists to prevent a reader from making.
    const resolved = path.join(fixture.root, reported[1]);
    assert.ok(existsSync(resolved), `reported "${reported[1]}", which resolves to nothing`);
    assert.ok(readFileSync(resolved).length > 0);
    assert.ok(!path.isAbsolute(reported[1]), "the report names an absolute path");
  });

  it("fails the run when an archive cannot be opened, rather than scanning past it", () => {
    assert.ok(GUARD);
    // Truncated to its first half: the end-of-central-directory record is gone,
    // so there is nothing to enumerate. The failure mode this asserts against
    // is the tempting one — treat it like an unreadable text file, skip it, and
    // print "no committed secrets" over a file nobody read.
    const truncated = OFFENDER.subarray(0, Math.floor(OFFENDER.length / 2));
    const run = runGuardIn(GUARD, rootWith("truncated", truncated).root);
    assert.equal(run.status, 1, `an unopenable archive passed the scan:\n${run.output}`);
    assert.match(run.output, /could not be opened/);
    assert.match(run.output, /planted\.pbit/);
    assert.doesNotMatch(run.output, /no committed secrets/);
  });

  it("counts the archive it scanned in the line it prints when clean", () => {
    assert.ok(GUARD);
    // The same tree with a harmless archive: the guard passes, and says how
    // many entries it read — the number that would silently become 0 if the
    // walk stopped matching the extension.
    const clean = zipFixture([{ name: ENTRY, data: part('{"expression": "1 + 1"}') }], {
      deflate: true,
    });
    const run = runGuardIn(GUARD, rootWith("clean", clean).root);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /1 entr\(ies\) in 1 archive\(s\)/);
  });
});
