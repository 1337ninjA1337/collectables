import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUDGET_SNAPSHOT } from "@/lib/budget-snapshot";
import {
  DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
  LAST_MEASURED_BUNDLE_BYTES,
  SMALLEST_GUARDED_SDK_BYTES,
  BUDGET_REARGUE_FLOOR_BYTES,
} from "@/lib/bundle-size";
import { stripComments } from "@/lib/strip-comments";
import {
  LAST_MEASURED_TRANSLATIONS_BYTES,
  translationsFootprint,
} from "@/lib/translations-footprint";

import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The two numbers the budget is argued from, and the fact that they are one
 * thing.
 *
 * They shipped an hour apart into two modules: the bundle at the commit that
 * last moved the budget, and the translations module at that same commit. The
 * report subtracts one from today's bundle, the other from today's copy, and
 * prints the second as a share OF the first — so a raise that updated one and
 * forgot the other would report a copy delta measured against the wrong
 * baseline. Silently, with a plausible number, on the one output somebody
 * reads when deciding whether to raise again.
 *
 * A suite could only have caught that with a tolerance loose enough not to go
 * red on ordinary work, which is exactly the size of the error it needed to
 * catch. One object instead, so forgetting half is not expressible.
 */

describe("BUDGET_SNAPSHOT", () => {
  it("holds both halves and the date they were taken", () => {
    assert.equal(typeof BUDGET_SNAPSHOT.bundleBytes, "number");
    assert.equal(typeof BUDGET_SNAPSHOT.translationsBytes, "number");
    // A raise argues about a RATE — four moves in three days — and a rate
    // needs the date.
    assert.match(BUDGET_SNAPSHOT.takenOn, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("is the single source both modules re-export", () => {
    assert.equal(LAST_MEASURED_BUNDLE_BYTES, BUDGET_SNAPSHOT.bundleBytes);
    assert.equal(LAST_MEASURED_TRANSLATIONS_BYTES, BUDGET_SNAPSHOT.translationsBytes);
  });

  it("neither module declares its own copy any more", () => {
    const BUNDLE = stripComments(readRepoFile("lib/bundle-size.ts"));
    const COPY = stripComments(readRepoFile("lib/translations-footprint.ts"));

    assert.match(BUNDLE, /export const LAST_MEASURED_BUNDLE_BYTES = BUDGET_SNAPSHOT\.bundleBytes;/);
    assert.match(COPY, /export const LAST_MEASURED_TRANSLATIONS_BYTES = BUDGET_SNAPSHOT\.translationsBytes;/);
    assert.ok(!/Math\.round\(\d{4}\.\d \* 1024\)/.test(BUNDLE), "the bundle figure is declared here again");
    assert.ok(!/= \d{3}_\d{3};/.test(COPY), "the copy figure is declared here again");
  });

  it("imports nothing at all", () => {
    // `lib/translations-footprint.ts` reaches the i18n parser and
    // `lib/bundle-size.ts` must not, so a module both import has to be one
    // that cannot carry anything into either. The same argument
    // `lib/translation-status.ts` makes, and the strongest form of it: a
    // module with no imports cannot reach anything by any path.
    const SRC = readRepoFile("lib/budget-snapshot.ts");
    const specifiers = [...SRC.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)"([^"]+)"/g)];

    assert.deepEqual(
      specifiers.map((m) => m[1]),
      [],
      "lib/budget-snapshot.ts has grown an import, and lib/bundle-size.ts pays for whatever it pulls in",
    );
  });

  it("is a measurement, not a re-measurement", () => {
    const SRC = readRepoFile("lib/budget-snapshot.ts");
    assert.ok(!SRC.includes("node:fs"));
    assert.ok(!SRC.includes("readFileSync"));
  });
});

describe("the snapshot still supports the argument it exists for", () => {
  it("keeps the two bounds a raise has to satisfy", () => {
    const headroom = DEFAULT_BUNDLE_SIZE_BUDGET_BYTES - BUDGET_SNAPSHOT.bundleBytes;

    assert.ok(
      headroom > BUDGET_REARGUE_FLOOR_BYTES,
      "the budget is too tight — it would fail on ordinary work rather than on an accidental SDK",
    );
    assert.ok(
      headroom < SMALLEST_GUARDED_SDK_BYTES,
      "the budget is too loose — a statically imported SDK would land under it",
    );
  });

  it("records a copy figure that still describes the translations module", () => {
    // A drift of zero on a commit that did not touch the translations is what
    // says the pair is in step; a large one means somebody moved the budget
    // and left this half behind, which is the bug this module exists to make
    // unexpressible and this case exists to catch if it becomes expressible
    // again.
    const drift = Math.abs(
      translationsFootprint(readI18nSource()).sourceBytes - BUDGET_SNAPSHOT.translationsBytes,
    );

    assert.ok(
      drift < 30 * 1024,
      `the recorded copy measurement is ${String(Math.round(drift / 1024))} KiB out — re-measure BOTH fields of BUDGET_SNAPSHOT together`,
    );
  });

  it("the date is not in the future", () => {
    // A snapshot dated tomorrow is one somebody typed rather than measured.
    assert.ok(BUDGET_SNAPSHOT.takenOn <= new Date().toISOString().slice(0, 10));
  });
});
