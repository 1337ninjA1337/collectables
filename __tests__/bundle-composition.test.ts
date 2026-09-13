import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attributeChunkBytes,
  BASELINE_BUCKET_FLOOR_BYTES,
  compositionDelta,
  decodeMappings,
  decodeVlq,
  FIRST_PARTY_ROOTS,
  formatCompositionDriftReport,
  formatCompositionReport,
  GENERATED,
  moduleBucket,
  NON_CODE_FIRST_PARTY_ROOTS,
  summarizeComposition,
  UNATTRIBUTED,
  type SourceMapLike,
} from "../lib/bundle-composition";
import { LAST_MEASURED_BUNDLE_BYTES } from "../lib/bundle-size";
import { COMPOSITION_BASELINE } from "../lib/composition-snapshot";
import { SOURCE_DIRS } from "../lib/source-dirs";

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The encoder the decoder is judged against on the big numbers.
 *
 * Written here rather than in `lib/`, because nothing in the app encodes a
 * sourcemap and a production module with one test caller is a liability. The
 * small cases below are hand-checked literals for exactly this reason: a
 * round trip through one author's pair of functions agrees with itself even
 * when both halves are wrong.
 */
function encodeVlq(value: number): string {
  let accumulated = (Math.abs(value) * 2 + (value < 0 ? 1 : 0)) as number;
  let out = "";
  do {
    let digit = accumulated % 32;
    accumulated = Math.floor(accumulated / 32);
    if (accumulated > 0) digit += 32;
    out += BASE64[digit];
  } while (accumulated > 0);
  return out;
}

/** A segment of the four-field kind: column, source, source line, source col. */
function segment(values: readonly number[]): string {
  return values.map(encodeVlq).join("");
}

describe("decodeVlq", () => {
  it("reads the hand-checked literals every sourcemap starts with", () => {
    // "A" is 0. "AAAA" is the first mapping of every map: column 0, source 0,
    // line 0, column 0.
    assert.deepEqual(decodeVlq("AAAA"), [0, 0, 0, 0]);
    // The low bit is the sign, so the alphabet counts in twos: `C` is base64
    // index 2 and means +1, `D` is 3 and means -1.
    assert.deepEqual(decodeVlq("C"), [1]);
    assert.deepEqual(decodeVlq("D"), [-1]);
    assert.deepEqual(decodeVlq("E"), [2]);
  });

  it("carries a continuation across digits", () => {
    // 16 is the first value that needs two digits: five data bits per digit
    // and one of them is the sign.
    assert.deepEqual(decodeVlq(encodeVlq(16)), [16]);
    assert.deepEqual(decodeVlq(encodeVlq(-16)), [-16]);
    assert.deepEqual(decodeVlq(encodeVlq(12345)), [12345]);
  });

  it("survives a column past the 32-bit shift", () => {
    // The whole reason the accumulator multiplies instead of shifting. The
    // entry chunk is one line of 4.5 million characters today; a bundler that
    // emits a single line past 2^31 would wrap a `<< shift` accumulator to a
    // negative column and charge the rest of the line to the wrong module,
    // silently, on the one output nobody re-derives by hand.
    const huge = 3_000_000_000;
    assert.deepEqual(decodeVlq(encodeVlq(huge)), [huge]);
  });

  it("refuses a digit outside the alphabet", () => {
    assert.throws(() => decodeVlq("A*A"), /not a base64 VLQ digit/);
  });

  it("refuses a field that ends mid-number", () => {
    // A trailing continuation bit with nothing after it: the field claims
    // another digit follows and none does. Returning the half-read value
    // would be a plausible number nobody could check.
    assert.throws(() => decodeVlq("g"), /ends mid-number/);
  });
});

describe("decodeMappings", () => {
  it("accumulates the generated column within a line", () => {
    const mappings = [
      segment([0, 0, 0, 0]),
      segment([5, 0, 0, 0]),
      segment([7, 0, 0, 0]),
    ].join(",");
    assert.deepEqual(
      decodeMappings(mappings)[0].map((s) => s.generatedColumn),
      [0, 5, 12],
    );
  });

  it("accumulates the source index ACROSS lines", () => {
    // The one piece of the format that cannot be inferred from a single line:
    // the column resets at every `;` and the source index does not. Read per
    // line, the second line's `+1` would resolve to source 1 rather than 2 and
    // a whole file's bytes would land on its neighbour.
    const first = segment([0, 1, 0, 0]);
    const second = segment([0, 1, 0, 0]);
    const lines = decodeMappings(`${first};${second}`);
    assert.deepEqual(lines[0][0], { generatedColumn: 0, sourceIndex: 1 });
    assert.deepEqual(lines[1][0], { generatedColumn: 0, sourceIndex: 2 });
  });

  it("reads a one-field segment as claiming no source", () => {
    const lines = decodeMappings(`${segment([4])},${segment([2, 0, 0, 0])}`);
    assert.equal(lines[0][0].sourceIndex, null);
    assert.equal(lines[0][1].sourceIndex, 0);
  });

  it("sorts a line whose columns arrive out of order", () => {
    // A negative column delta is legal VLQ and illegal as an attribution
    // input: the ranges are read off the NEXT segment's start, so one
    // out-of-order column hands `slice` a backwards range and charges the rest
    // of the line to whichever module follows.
    const lines = decodeMappings(
      [segment([10, 0, 0, 0]), segment([-6, 1, 0, 0])].join(","),
    );
    assert.deepEqual(
      lines[0].map((s) => s.generatedColumn),
      [4, 10],
    );
  });

  it("reads an empty line as a line with no segments", () => {
    const lines = decodeMappings(`${segment([0, 0, 0, 0])};;`);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[1], []);
  });
});

describe("attributeChunkBytes", () => {
  const map: SourceMapLike = {
    sources: ["/lib/one.ts", "/lib/two.ts"],
    mappings: [segment([0, 0, 0, 0]), segment([4, 1, 0, 0])].join(","),
  };

  it("charges each segment the text up to the next one", () => {
    const bytes = attributeChunkBytes("aaaabbbb", map);
    assert.equal(bytes.get("/lib/one.ts"), 4);
    assert.equal(bytes.get("/lib/two.ts"), 4);
    assert.equal(bytes.get(UNATTRIBUTED), undefined);
  });

  it("adds up to the chunk's own byte length", () => {
    // The property that makes the unattributed line checkable rather than a
    // residue nobody can audit: every byte of the chunk is charged to exactly
    // one label, so the parts sum to the whole and the report can print the
    // total as a denominator.
    const code = "aaaabbbb\nunmapped line\n  indented\n";
    const total = [...attributeChunkBytes(code, map).values()].reduce(
      (sum, n) => sum + n,
      0,
    );
    assert.equal(total, Buffer.byteLength(code, "utf8"));
  });

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    // The translations module is six locales of Cyrillic and Polish
    // diacritics and it is the single heaviest module in the bundle, so a
    // count in code units would under-report exactly the thing the budget
    // argues about most.
    const bytes = attributeChunkBytes("прив", {
      sources: ["/lib/i18n-context.tsx"],
      mappings: segment([0, 0, 0, 0]),
    });
    assert.equal(bytes.get("/lib/i18n-context.tsx"), 8);
  });

  it("gives the head of a line, an unmapped line and the newlines to nobody", () => {
    const bytes = attributeChunkBytes("!!aabb\nxyz", {
      sources: ["/lib/one.ts"],
      mappings: segment([2, 0, 0, 0]),
    });
    assert.equal(bytes.get("/lib/one.ts"), 4);
    // Two characters of preamble, one newline, three characters of a line no
    // segment mentions.
    assert.equal(bytes.get(UNATTRIBUTED), 6);
  });

  it("does not invent a source for an index the map does not have", () => {
    const bytes = attributeChunkBytes("aaaa", {
      sources: [],
      mappings: segment([0, 0, 0, 0]),
    });
    assert.equal(bytes.get(UNATTRIBUTED), 4);
  });

  it("applies sourceRoot to relative sources and leaves absolute ones alone", () => {
    const rooted = attributeChunkBytes("aaaabbbb", {
      sourceRoot: "src/",
      sources: ["one.ts", "/two.ts"],
      mappings: [segment([0, 0, 0, 0]), segment([4, 1, 0, 0])].join(","),
    });
    assert.equal(rooted.get("src/one.ts"), 4);
    assert.equal(rooted.get("/two.ts"), 4);
  });
});

describe("moduleBucket", () => {
  it("buckets a dependency by its package name", () => {
    assert.deepEqual(moduleBucket("/node_modules/react-dom/cjs/react-dom.js"), {
      label: "react-dom",
      firstParty: false,
    });
  });

  it("keeps a scoped package's scope", () => {
    // `@sentry/core` and `@sentry/browser` are different installs; bucketing
    // both as "@sentry" would hide which one is in the bundle, which is the
    // question somebody looking at 286 KiB of Sentry actually has.
    assert.equal(
      moduleBucket("/node_modules/@sentry/core/build/esm/index.js").label,
      "@sentry/core",
    );
  });

  it("reads a nested install as the package that is actually there", () => {
    assert.equal(
      moduleBucket("/node_modules/expo/node_modules/@expo/cli/build/x.js").label,
      "@expo/cli",
    );
  });

  it("buckets this repository's own source by its top-level directory", () => {
    assert.deepEqual(moduleBucket("/lib/i18n-context.tsx"), {
      label: "lib/",
      firstParty: true,
    });
    assert.deepEqual(moduleBucket("/app/collection/[id].tsx"), {
      label: "app/",
      firstParty: true,
    });
  });

  it("drops the require.context query the router module carries", () => {
    // expo-router's route table arrives as `/app?ctx=<hash>`; the hash is the
    // context's identity, not a path, and left on it would make a bucket of
    // its own that changes name on every route added.
    assert.equal(moduleBucket("/app?ctx=c9915d5ced2b656047aa").label, "app/");
  });

  it("gives a repo-root file its own bucket", () => {
    assert.deepEqual(moduleBucket("/package.json"), {
      label: "package.json",
      firstParty: true,
    });
  });

  it("reads Metro's virtual modules as generated", () => {
    // The `\0shim:` wrappers name a dependency file and are generated glue
    // around it — counting them as that dependency's bytes would report code
    // the package never shipped.
    assert.equal(moduleBucket("__prelude__").label, GENERATED);
    assert.equal(moduleBucket("\0polyfill:external-require").label, GENERATED);
    assert.equal(
      moduleBucket("\0shim:react-native-web/dist/exports/BackHandler/index.js")
        .label,
      GENERATED,
    );
    assert.equal(moduleBucket("__prelude__").firstParty, false);
  });

  it("leaves the unattributed label alone", () => {
    assert.deepEqual(moduleBucket(UNATTRIBUTED), {
      label: UNATTRIBUTED,
      firstParty: false,
    });
  });

  it("strips an absolute repo root and normalises separators", () => {
    assert.deepEqual(
      moduleBucket(
        "/home/runner/work/collectables/lib/x.ts",
        "/home/runner/work/collectables",
      ),
      { label: "lib/", firstParty: true },
    );
    // A trailing slash on the root must not leave a leading one on the path.
    assert.deepEqual(
      moduleBucket(
        "/home/runner/work/collectables/lib/x.ts",
        "/home/runner/work/collectables/",
      ),
      { label: "lib/", firstParty: true },
    );
    assert.equal(
      moduleBucket("C:\\repo\\node_modules\\qrcode\\lib\\index.js").label,
      "qrcode",
    );
  });

  it("covers every directory the source-wide scans know about", () => {
    // Derived, not restated: a new top-level source directory would otherwise
    // be reported as a dependency, and "installed packages grew" is the one
    // direction of this report nobody would think to check.
    for (const dir of SOURCE_DIRS) {
      assert.ok(
        FIRST_PARTY_ROOTS.includes(dir),
        `${dir} is application source and would be bucketed as a dependency`,
      );
    }
    // And the extras are the non-code ones, named for a reason rather than
    // accumulated: everything in FIRST_PARTY_ROOTS is either scanned source or
    // on that short list.
    const extras = FIRST_PARTY_ROOTS.filter((dir) => !SOURCE_DIRS.includes(dir));
    assert.deepEqual(extras, [...NON_CODE_FIRST_PARTY_ROOTS]);
  });
});

describe("summarizeComposition", () => {
  const perSource = new Map([
    ["/lib/i18n-context.tsx", 3000],
    ["/lib/small.ts", 1000],
    ["/node_modules/react-dom/cjs/react-dom.js", 4000],
    ["__prelude__", 500],
    [UNATTRIBUTED, 1500],
  ]);

  it("splits the total three ways and keeps them adding up", () => {
    const c = summarizeComposition(perSource);
    assert.equal(c.totalBytes, 10_000);
    assert.equal(c.firstPartyBytes, 4000);
    // The dependency side owns Metro's generated modules too: they are in the
    // bundle and they are not this repository's source.
    assert.equal(c.dependencyBytes, 4500);
    assert.equal(c.unattributedBytes, 1500);
    assert.equal(
      c.firstPartyBytes + c.dependencyBytes + c.unattributedBytes,
      c.totalBytes,
    );
    assert.equal(c.attributedBytes, 8500);
  });

  it("groups by bucket, heaviest first", () => {
    const c = summarizeComposition(perSource);
    assert.deepEqual(
      c.buckets.map((b) => [b.label, b.bytes]),
      [
        ["lib/", 4000],
        ["react-dom", 4000],
        [UNATTRIBUTED, 1500],
        [GENERATED, 500],
      ],
    );
    // A tie breaks by name rather than by insertion order, so two builds of
    // the same bundle print the same report.
    assert.equal(c.buckets[0].label, "lib/");
  });

  it("keeps the individual modules, heaviest first", () => {
    const c = summarizeComposition(perSource);
    assert.equal(c.modules[0].label, "/node_modules/react-dom/cjs/react-dom.js");
    assert.equal(c.modules[0].firstParty, false);
    assert.equal(c.modules[1].label, "/lib/i18n-context.tsx");
    assert.equal(c.modules[1].firstParty, true);
  });

  it("states each share against the measured total", () => {
    const c = summarizeComposition(perSource);
    assert.equal(c.buckets[0].share, 0.4);
    assert.equal(c.modules[0].share, 0.4);
  });

  it("answers an empty bundle with zeroes rather than a division by zero", () => {
    const c = summarizeComposition(new Map());
    assert.equal(c.totalBytes, 0);
    assert.deepEqual(c.buckets, []);
    assert.deepEqual(c.modules, []);
  });
});

describe("formatCompositionReport", () => {
  const composition = summarizeComposition(
    new Map([
      ["/lib/i18n-context.tsx", 3000],
      ["/lib/small.ts", 1000],
      ["/node_modules/react-dom/cjs/react-dom.js", 4000],
      [UNATTRIBUTED, 2000],
    ]),
  );

  it("names the chunk and the three-way split", () => {
    const report = formatCompositionReport("dist/entry.js", composition);
    assert.match(report, /^dist\/entry\.js — 9\.8 KiB across 4 sources/);
    assert.match(report, /this repository's own source/);
    assert.match(report, /installed packages and generated modules/);
    assert.match(report, /\(unattributed\) — runtime preamble/);
  });

  it("honours the top-N limits", () => {
    const report = formatCompositionReport("dist/entry.js", composition, {
      topBuckets: 1,
      topModules: 2,
    });
    assert.match(report, /by bucket \(top 1\)/);
    assert.ok(report.includes("react-dom"), "the heaviest bucket is printed");
    assert.ok(
      !report.includes("lib/i18n-context.tsx\n  "),
      "a module past the limit is not printed twice",
    );
    const moduleSection = report.slice(report.indexOf("by module"));
    assert.equal(moduleSection.split("\n").filter((l) => l.startsWith("  ") && l.includes("KiB")).length, 2);
  });

  it("says what a per-module number is not", () => {
    // The caveat is load-bearing: a bucket's bytes are exactly the shape
    // somebody quotes as a saving, and removing the package would not return
    // them — shared helpers and hoisted code cross this line in both
    // directions.
    const report = formatCompositionReport("dist/entry.js", composition);
    assert.match(report, /not what removing it would return/);
  });
});

describe("compositionDelta", () => {
  const baseline = {
    takenOn: "2026-09-13",
    totalBytes: 10_000,
    buckets: { "lib/": 4000, "react-dom": 4000, "going-away": 2000 },
  };

  const compositionOf = (buckets: Record<string, number>) =>
    summarizeComposition(new Map(Object.entries(buckets)));

  it("reports growth, shrinkage, arrivals and departures", () => {
    const deltas = compositionDelta(
      compositionOf({ "lib/": 6000, "react-dom": 3000, "brand-new": 5000 }),
      baseline,
    );
    assert.deepEqual(
      deltas.map((d) => [d.label, d.deltaBytes]),
      [
        ["brand-new", 5000],
        ["going-away", -2000],
        ["lib/", 2000],
        ["react-dom", -1000],
      ],
    );
  });

  it("leaves out the buckets that did not move", () => {
    // On an ordinary build that is nearly all of them, and a list of two
    // hundred zeroes hides the four rows worth reading.
    const deltas = compositionDelta(
      compositionOf({ "lib/": 4000, "react-dom": 4000, "going-away": 2000 }),
      baseline,
    );
    assert.deepEqual(deltas, []);
  });

  it("ignores the tail a baseline does not record", () => {
    // The first thing this reported: a baseline stops at the floor, so every
    // omitted package read as `(new)` on the next run and the report was
    // thirty rows of packages that had been there for months.
    const deltas = compositionDelta(
      compositionOf({ "lib/": 4000, "react-dom": 4000, "going-away": 2000, tiny: 900 }),
      baseline,
    );
    assert.deepEqual(deltas, []);
    // Once it crosses the floor it is a real arrival again.
    const grown = compositionDelta(
      compositionOf({ "lib/": 4000, "react-dom": 4000, "going-away": 2000, tiny: 2000 }),
      baseline,
    );
    assert.deepEqual(
      grown.map((d) => d.label),
      ["tiny"],
    );
    assert.equal(BASELINE_BUCKET_FLOOR_BYTES, 1024);
  });

  it("orders by the size of the move, not by the size of the bucket", () => {
    // The question is "what changed", so a 40 KiB package that gained 1 KiB
    // sorts below a 2 KiB one that doubled.
    const deltas = compositionDelta(
      compositionOf({ "lib/": 4100, "react-dom": 8000, "going-away": 2000 }),
      baseline,
    );
    assert.deepEqual(
      deltas.map((d) => d.label),
      ["react-dom", "lib/"],
    );
  });
});

describe("formatCompositionDriftReport", () => {
  const baseline = {
    takenOn: "2026-09-13",
    totalBytes: 10_240,
    buckets: { "lib/": 4096, "react-dom": 4096, "going-away": 2048 },
  };
  const compositionOf = (buckets: Record<string, number>) =>
    summarizeComposition(new Map(Object.entries(buckets)));

  it("names the measurement it is speaking from and the totals either side", () => {
    const report = formatCompositionDriftReport(
      compositionOf({ "lib/": 6144, "react-dom": 4096, "going-away": 2048 }),
      baseline,
    );
    assert.ok(report !== null);
    assert.match(report, /since the 2026-09-13 measurement: \+2\.0 KiB \(10\.0 KiB → 12\.0 KiB\)/);
    assert.match(report, /\+2\.0 KiB {2}lib\//);
  });

  it("marks an arrival and a departure, because those are the rows that explain themselves", () => {
    const report = formatCompositionDriftReport(
      compositionOf({ "lib/": 4096, "react-dom": 4096, newcomer: 3072 }),
      baseline,
    );
    assert.ok(report !== null);
    assert.match(report, /\+3\.0 KiB {2}newcomer \(new\)/);
    assert.match(report, /-2\.0 KiB {2}going-away \(gone\)/);
  });

  it("sums the rows it did not print rather than dropping them", () => {
    const report = formatCompositionDriftReport(
      compositionOf({ "lib/": 5120, "react-dom": 5120, "going-away": 3072 }),
      baseline,
      { topRows: 1 },
    );
    assert.ok(report !== null);
    assert.match(report, /2 smaller moves/);
    // 1 KiB + 1 KiB, the two rows past the limit.
    assert.match(report, /\+2\.0 KiB {2}2 smaller moves/);
  });

  it("says nothing at all when nothing moved", () => {
    // A heading over an empty list reads as a measurement that failed.
    assert.equal(
      formatCompositionDriftReport(
        compositionOf({ "lib/": 4096, "react-dom": 4096, "going-away": 2048 }),
        baseline,
      ),
      null,
    );
  });
});

describe("the recorded baseline", () => {
  it("records only buckets at or above the floor", () => {
    // The floor is what keeps it re-takeable: below it the list is a churning
    // tail of one-file packages.
    for (const [label, bytes] of Object.entries(COMPOSITION_BASELINE.buckets)) {
      assert.ok(
        bytes >= BASELINE_BUCKET_FLOOR_BYTES,
        `${label} is below the floor and should not be in the baseline`,
      );
    }
  });

  it("keeps the tail inside its total", () => {
    // `totalBytes` is the whole bundle, not the sum of the listed rows, so the
    // drift report's total stays honest and the unlisted moves show up as the
    // gap between it and the rows.
    const listed = Object.values(COMPOSITION_BASELINE.buckets).reduce((s, n) => s + n, 0);
    assert.ok(listed > 0 && listed < COMPOSITION_BASELINE.totalBytes);
  });

  it("carries the date the argument needs", () => {
    assert.match(COMPOSITION_BASELINE.takenOn, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("is measured against the same bundle the budget is", () => {
    // Within a kibibyte: a sourcemapped export appends a `sourceMappingURL`
    // comment per chunk, which the deploy strips. A baseline that had drifted
    // further than that would be a measurement of a different tree.
    assert.ok(
      Math.abs(COMPOSITION_BASELINE.totalBytes - LAST_MEASURED_BUNDLE_BYTES) < 20 * 1024,
      `the baseline (${String(COMPOSITION_BASELINE.totalBytes)}) and the budget's measurement (${String(LAST_MEASURED_BUNDLE_BYTES)}) are of different builds`,
    );
  });
});
