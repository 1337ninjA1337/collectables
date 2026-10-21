import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * `lib/use-settled-search.ts` and the two surfaces that stopped writing it out.
 *
 * `app/people.tsx` and `components/search-overlay.tsx` each held the same
 * twenty lines — the debounce, a results state, an in-flight flag, a fetching
 * effect with a `cancelled` closure, and a four-term `settling` expression.
 * Three suggestion rounds named the duplication and each gave the same reason
 * for leaving it: the claims that pinned both copies, by source, in four
 * suites. They are here now, once, pointed at the module.
 *
 * The behaviour the hook exists for is RUN rather than read — see
 * `use-settled-search-render.test.ts`. What is left here is structural: which
 * module owns the timer and the request, and that each consumer still asks for
 * its own row limit and its own reading of "a search is active".
 */
const readHookSrc = () => readRepoFile("lib", "use-settled-search.ts");

describe("useSettledSearch — structure", () => {
  it("debounces through the shared hook rather than a timer of its own", () => {
    const code = stripComments(readHookSrc());
    assert.match(code, /import \{ useDebouncedValue \} from "@\/lib\/use-debounced-value";/);
    assert.match(code, /useDebouncedValue\(input, delayMs\)/);
    assert.doesNotMatch(code, /setTimeout|clearTimeout/, "the timer belongs to useDebouncedValue");
  });

  it("defaults to the shared remote-search delay rather than a literal", () => {
    const code = stripComments(readHookSrc());
    assert.match(code, /import \{ PROFILE_SEARCH_DEBOUNCE_MS \} from "@\/lib\/debounce-helpers";/);
    assert.match(code, /delayMs = PROFILE_SEARCH_DEBOUNCE_MS/);
    assert.doesNotMatch(code, /\b300\b/, "the 300ms literal lives in debounce-helpers only");
  });

  it("reads `search` through useLatestRef instead of listing it as a dependency", () => {
    // Both call sites close over a per-surface row limit, so the function is a
    // new identity every render. In the dependency list that is an infinite
    // fetch loop: every response is a `setState`, which is another render.
    const code = stripComments(readHookSrc());
    assert.match(code, /import \{ useLatestRef \} from "@\/lib\/use-latest-ref";/);
    assert.match(code, /const searchRef = useLatestRef\(search\);/);
    const deps = code.match(/\}, \[([^\]]*)\]\);/);
    assert.ok(deps, "effect dep array not found");
    assert.equal(deps[1].trim(), "active, debouncedQuery, searchRef");
  });

  it("cancels a superseded response rather than letting it land", () => {
    const code = stripComments(readHookSrc());
    assert.match(code, /let cancelled = false;/);
    assert.match(code, /if \(!cancelled\) setAnswer\(\{ query: debouncedQuery, results \}\);/);
    assert.match(code, /return \(\) => \{\s*cancelled = true;\s*\};/);
  });

  it("keeps the rows and the query they answer as one state", () => {
    // Two states could disagree, and the disagreement is what `settling` is
    // read off: rows for "an" beside a settled query of "ann" is exactly the
    // moment a caller must not be told it has an answer.
    const code = stripComments(readHookSrc());
    assert.match(code, /type SearchAnswer<T> = \{ query: string; results: T\[\] \};/);
    assert.match(code, /useState<SearchAnswer<T> \| null>\(null\)/);
    assert.ok(!/inFlight/.test(code), "the flag the answer state replaced is back");
  });

  it("answers a rejection with the query and no rows, so a failure is not a search still running", () => {
    const code = stripComments(readHookSrc());
    assert.match(
      code,
      /\.catch\(\(\) => \{\s*if \(!cancelled\) setAnswer\(\{ query: debouncedQuery, results: NO_RESULTS \}\);\s*\}\)/,
    );
  });

  it("clears to null when nothing is being searched for, and sends nothing", () => {
    const code = stripComments(readHookSrc());
    const branch = /if \(!active \|\| !debouncedQuery\) \{([\s\S]*?)return;/.exec(code);
    assert.ok(branch, "the inactive branch is not readable");
    assert.match(branch[1], /setAnswer\(null\);/);
    assert.ok(!/searchRef/.test(branch[1]), "the inactive branch must not fetch anything");
  });

  it("gates both windows and the request on one `active`", () => {
    const code = stripComments(readHookSrc());
    assert.match(
      code,
      /settling: active && \(debouncedQuery !== input \|\| answer\?\.query !== debouncedQuery\),/,
    );
  });

  it("hands back the same empty array while there is nothing to search for", () => {
    // A fresh `[]` per render recomputes every caller's `useMemo` over the
    // rows, which on both surfaces is the union that builds the result list.
    const code = stripComments(readHookSrc());
    assert.match(code, /const NO_RESULTS: never\[\] = \[\];/);
    assert.match(code, /results: answer\?\.results \?\? NO_RESULTS,/);
  });

  it("stays a pure behaviour hook (no navigation, i18n, design tokens or styles)", () => {
    const code = stripComments(readHookSrc());
    for (const forbidden of [/@\/lib\/design-tokens/, /@\/lib\/i18n-context/, /expo-router/, /StyleSheet/, /react-native/]) {
      assert.doesNotMatch(code, forbidden, `${forbidden} does not belong in a behaviour hook`);
    }
  });
});

describe("useSettledSearch — adoption", () => {
  // The limit is a NAME and a value on both surfaces since 2026-10-19: the
  // sheet's was the same number written four times (its request plus a cut per
  // section). The claim is unchanged by the hook — this consumer asks the
  // server for that many rows — and it still takes two assertions, because the
  // number and the call are in two places on purpose.
  const CONSUMERS = [
    { file: "app/people.tsx", limit: 50, limitName: "SEARCH_RESULT_LIMIT", input: "query.trim()", active: "searching" },
    { file: "components/search-overlay.tsx", limit: 20, limitName: "SECTION_LIMIT", input: "q", active: "peopleSearchActive" },
  ];

  for (const consumer of CONSUMERS) {
    const label = consumer.file;
    const code = () => stripComments(readRepoFile(consumer.file));

    it(`${label} runs its searchProfiles round trip through the hook`, () => {
      assert.match(code(), /import \{ useSettledSearch \} from "@\/lib\/use-settled-search";/);
      assert.match(
        code(),
        new RegExp(
          `useSettledSearch\\(\\{\\s*input: ${consumer.input.replace(/[.()]/g, "\\$&")},\\s*active: ${consumer.active},\\s*search: \\(settledQuery\\) => searchProfiles\\(settledQuery, ${consumer.limitName}\\),\\s*\\}\\)`,
        ),
      );
      assert.match(
        code(),
        new RegExp(`const ${consumer.limitName} = ${String(consumer.limit)};`),
        `${consumer.limitName} is not ${String(consumer.limit)} any more`,
      );
    });

    it(`${label} holds none of the mechanism itself`, () => {
      // The twenty lines the hook absorbed. Any one of them coming back is the
      // start of the two surfaces disagreeing again, which this seam has done
      // five times in a week.
      const src = code();
      assert.doesNotMatch(src, /setTimeout|clearTimeout/, "the debounce timer belongs to the hook");
      assert.doesNotMatch(src, /let cancelled = false;/, "the cancellation belongs to the hook");
      assert.doesNotMatch(src, /useDebouncedValue/, "the debounce is reached through useSettledSearch");
      assert.doesNotMatch(src, /InFlight/, "the in-flight flag is the hook's answer state now");
      assert.doesNotMatch(src, /PROFILE_SEARCH_DEBOUNCE_MS/, "the delay is the hook's default");
    });

    it(`${label} asks for its own row limit, which the two do not share`, () => {
      // 50 is a request size with no cut behind it (the screen renders every
      // row of the union); 20 is a display cut that doubles as a request size.
      const other = CONSUMERS.find((c) => c.file !== consumer.file)!;
      assert.doesNotMatch(code(), new RegExp(`\\b${other.limitName}\\b`));
    });
  }

  it("is the only debounced search implementation left in the app", () => {
    // A third hand-rolled copy is exactly the drift this hook exists to stop.
    for (const consumer of CONSUMERS) {
      assert.doesNotMatch(
        stripComments(readRepoFile(consumer.file)),
        /searchProfiles\((debouncedQuery|q|needle|query)[,)]/,
        `${consumer.file} calls searchProfiles outside the hook's request`,
      );
    }
  });
});
