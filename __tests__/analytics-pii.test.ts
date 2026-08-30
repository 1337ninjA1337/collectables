import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { balancedInner } from "../lib/balanced-source";
import {
  PII_PROP_TOKENS,
  tokenizePropKey,
  isPiiPropKey,
  findPiiPropKeys,
} from "../lib/analytics-pii";
import { readRepoFile as read } from "./helpers/repo-file";
import { readSource, sourceFiles } from "./helpers/source-files";
import { assertExemptionsHonest } from "./helpers/suite-files";

// Directories that hold telemetry call sites.
const SOURCE_FILES = sourceFiles("lib", "components", "app");

/**
 * The two wrapper modules, exempt from the call-site rules they implement.
 *
 * Every sweep below asks "does this CALL SITE pass only allow-listed keys",
 * and the module that DEFINES the call is not a call site — `lib/analytics.ts`
 * declares `trackEvent` and `lib/sentry.ts` declares `addBreadcrumb` and
 * `captureException`, so each matches its own rule by construction and always
 * will.
 *
 * Named rather than spelled in the three loops that skip them, which is where
 * they lived until 2026-08-29 as `if (file === "lib/sentry.ts") continue;`
 * under a `// wrapper itself` comment written out twice. That is the shape
 * `inline-exclusion.test.ts` bans: an exclusion with no declaration is invisible
 * to `assertExemptionsHonest` and to the reviewer, and this one had already
 * been copied once — two loops skipping the same module through two
 * independent lines, either of which could be tightened without the other.
 */
const TRACK_EVENT_WRAPPER = "lib/analytics.ts";
const SENTRY_WRAPPER = "lib/sentry.ts";

/**
 * Extracts the property KEYS from a flat object-literal body (no nested
 * braces) — handles both `key: value` and shorthand `key,` forms while
 * ignoring identifiers that appear on the value side.
 */
function extractObjectKeys(body: string): string[] {
  const keys = new Set<string>();
  // `key:` entries (key is the first identifier after `{`, `,`, or a line start)
  for (const m of body.matchAll(/(?:^|[{,])\s*([A-Za-z_]\w*)\s*:/gm)) {
    keys.add(m[1]);
  }
  // shorthand entries: a line that is just `identifier` optionally + comma
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*,?\s*$/);
    if (m) keys.add(m[1]);
  }
  return [...keys];
}

describe("PII guard — lib/analytics-pii primitives", () => {
  it("tokenizes camelCase / snake_case / kebab keys", () => {
    assert.deepStrictEqual(tokenizePropKey("previousLanguage"), [
      "previous",
      "language",
    ]);
    assert.deepStrictEqual(tokenizePropKey("display_name"), [
      "display",
      "name",
    ]);
    assert.deepStrictEqual(tokenizePropKey("targetUserId"), [
      "target",
      "user",
      "id",
    ]);
  });

  it("flags free-text / PII keys and passes id/enum/boolean keys", () => {
    for (const bad of [
      "itemName",
      "displayName",
      "chatMessage",
      "userEmail",
      "bio",
      "searchQuery",
      "phoneNumber",
      "authToken",
    ]) {
      assert.equal(isPiiPropKey(bad), true, `${bad} should be flagged`);
    }
    for (const ok of [
      "collectionId",
      "mode",
      "hasPhoto",
      "isPremium",
      "visibility",
      "language",
      "previousLanguage",
      "targetUserId",
      "sellerWasFriend",
      "source",
      "method",
      "provider",
    ]) {
      assert.equal(isPiiPropKey(ok), false, `${ok} should pass`);
    }
  });

  it("findPiiPropKeys returns only the offending keys", () => {
    assert.deepStrictEqual(
      findPiiPropKeys(["collectionId", "itemName", "mode", "bio"]),
      ["itemName", "bio"],
    );
    assert.deepStrictEqual(findPiiPropKeys(["mode", "hasPrice"]), []);
  });

  it("token list is non-empty and lower-case", () => {
    assert.ok(PII_PROP_TOKENS.length > 0);
    for (const token of PII_PROP_TOKENS) {
      assert.equal(token, token.toLowerCase(), `${token} must be lower-case`);
    }
  });
});

describe("PII guard — analytics taxonomy forbids free-text/PII props", () => {
  it("no ANALYTICS_EVENTS prop key is a PII shape", () => {
    for (const [name, def] of Object.entries(ANALYTICS_EVENTS)) {
      const flagged = findPiiPropKeys(def.props);
      assert.deepStrictEqual(
        flagged,
        [],
        `${name}.props declares PII/free-text key(s): ${flagged.join(", ")}`,
      );
    }
  });
});

describe("PII guard — trackEvent call sites stay within the taxonomy", () => {
  // Every trackEvent("name", {...}) call may only pass keys declared in
  // ANALYTICS_EVENTS[name].props (which itself is PII-free), so raw user
  // input can never be smuggled in under a new key.
  it("every call site uses a known event with only allow-listed, non-PII keys", () => {
    let callsChecked = 0;
    for (const file of SOURCE_FILES) {
      if (file === TRACK_EVENT_WRAPPER) continue;
      const src = readSource(file);

      // name + object-literal props
      for (const m of src.matchAll(
        /trackEvent\(\s*["'](\w+)["']\s*,\s*\{([\s\S]*?)\}\s*\)/g,
      )) {
        callsChecked++;
        const [, name, body] = m;
        const def = (ANALYTICS_EVENTS as Record<string, { props: readonly string[] }>)[
          name
        ];
        assert.ok(def, `${file}: trackEvent("${name}") is not in the taxonomy`);
        const allowed = new Set(def.props);
        for (const key of extractObjectKeys(body)) {
          assert.ok(
            allowed.has(key),
            `${file}: trackEvent("${name}") passes undeclared prop "${key}" (allowed: ${[...allowed].join(", ")})`,
          );
          assert.equal(
            isPiiPropKey(key),
            false,
            `${file}: trackEvent("${name}") passes PII-shaped prop "${key}"`,
          );
        }
      }

      // every trackEvent name (even propless) must be a known event
      for (const m of src.matchAll(/trackEvent\(\s*["'](\w+)["']/g)) {
        const name = m[1];
        assert.ok(
          (ANALYTICS_EVENTS as Record<string, unknown>)[name],
          `${file}: trackEvent("${name}") is not in the taxonomy`,
        );
      }
    }
    assert.ok(callsChecked > 0, "expected to find at least one trackEvent call");
  });
});

describe("PII guard — breadcrumb call sites carry no user input", () => {
  // "from"/"to" are route names (navigation breadcrumbs); "clarityId" is the
  // public Clarity project ID and "doNotTrack" a boolean — none carry user
  // input (the "clarity loaded" breadcrumb in lib/clarity.ts).
  const BREADCRUMB_ALLOWED_DATA_KEYS = new Set([
    "from",
    "to",
    "clarityId",
    "doNotTrack",
  ]);

  it("addBreadcrumb data objects only use route allow-listed keys", () => {
    let calls = 0;
    for (const file of SOURCE_FILES) {
      if (file === SENTRY_WRAPPER) continue;
      const src = readSource(file);
      for (const m of src.matchAll(
        /addBreadcrumb\([\s\S]*?\{([\s\S]*?)\}\s*\)/g,
      )) {
        calls++;
        for (const key of extractObjectKeys(m[1])) {
          assert.ok(
            BREADCRUMB_ALLOWED_DATA_KEYS.has(key),
            `${file}: addBreadcrumb passes non-allow-listed data key "${key}" (allowed: ${[...BREADCRUMB_ALLOWED_DATA_KEYS].join(", ")})`,
          );
          assert.equal(
            isPiiPropKey(key),
            false,
            `${file}: addBreadcrumb passes PII-shaped data key "${key}"`,
          );
        }
      }
    }
    assert.ok(calls > 0, "expected at least one addBreadcrumb call");
  });
});

describe("PII guard — captureException context is a constant label", () => {
  it("every captureException context value is a plain string literal", () => {
    for (const file of SOURCE_FILES) {
      if (file === SENTRY_WRAPPER) continue;
      const src = readSource(file);
      for (const m of src.matchAll(
        /captureException\([\s\S]*?context:\s*([^,}\n]+)/g,
      )) {
        const value = m[1].trim();
        assert.match(
          value,
          /^["'][^"']*["']$/,
          `${file}: captureException context must be a constant string literal, got \`${value}\` (no interpolated user data)`,
        );
      }
    }
  });
});

/**
 * The `extra` object is the one Sentry payload nothing else here reads.
 *
 * `scrubPII` walks event BODIES — the message, the exception values, the
 * request — and `toSentryCaptureContext` forwards `context.extra` verbatim
 * beside them. So every rule that keeps user content out of a crash report
 * stops at the object a caller assembles by hand, and the only thing standing
 * between an auth id and Sentry is that the two call sites happen to pass
 * labels. `reportStorageFailure` states that in a comment ("the KEYSPACE, never
 * the key") and one runtime case checks it for one key.
 *
 * A comment is not a check. A field added here built from a title, an email or
 * a raw storage key would pass every case in this suite, which is why the same
 * allow-list + PII-shape pair the breadcrumb sweep uses is applied to `extra`.
 */
describe("PII guard — captureException extra carries labels, never content", () => {
  /**
   * `keyspace` is a storage key with its per-user half replaced by `{id}`
   * (`storageKeyLabel`), and `reason` is one of two literals from
   * `classifyStorageError`. Both are the app's own vocabulary rather than
   * anything a user typed or an account is identified by.
   */
  const EXTRA_ALLOWED_KEYS = new Set(["keyspace", "reason"]);

  /**
   * Every `extra:` object passed to a `captureException`, read through the
   * repo's balanced-bracket reader rather than a `[^{}]*` body.
   *
   * A regex body has to assume where the object ENDS, and the two ways of
   * assuming it are both wrong in the direction that matters: `[^{}]*` stops at
   * the first nested `{` and silently checks half an object, and a greedy read
   * to the last `}` swallows whatever follows the call. `balancedInner` answers
   * the question exactly, and an `extra:` that is not an object literal at all
   * (a variable, a spread, a call) comes back as `null` — which the caller
   * reports rather than skips, because that is the form no key sweep can rule
   * on.
   */
  function extraObjects(src: string): (string | null)[] {
    const found: (string | null)[] = [];
    for (const m of src.matchAll(/captureException\([\s\S]*?extra:\s*/g)) {
      const open = (m.index ?? 0) + m[0].length;
      found.push(src[open] === "{" ? balancedInner(src, open, "{", "}") : null);
    }
    return found;
  }

  it("every captureException extra key is allow-listed and not PII-shaped", () => {
    let calls = 0;
    for (const file of SOURCE_FILES) {
      if (file === SENTRY_WRAPPER) continue;
      const src = readSource(file);
      for (const body of extraObjects(src)) {
        calls++;
        assert.ok(
          body !== null,
          `${file}: captureException extra must be an object literal — a variable or a call is a payload no key sweep can rule on`,
        );
        for (const key of extractObjectKeys(body)) {
          assert.ok(
            EXTRA_ALLOWED_KEYS.has(key),
            `${file}: captureException extra passes non-allow-listed key "${key}" (allowed: ${[...EXTRA_ALLOWED_KEYS].join(", ")}) — scrubPII does not read \`extra\`, so this reaches Sentry verbatim`,
          );
          assert.equal(
            isPiiPropKey(key),
            false,
            `${file}: captureException extra passes PII-shaped key "${key}"`,
          );
        }
      }
    }
    assert.ok(
      calls > 0,
      "no captureException call passes an `extra` any more — delete this sweep rather than leaving it green over nothing",
    );
  });

  it("no captureException extra value is assembled at the call site", () => {
    // A shorthand `{ keyspace, reason }` is a NAME, and a name is what the
    // allow-list above rules on: `keyspace` is allowed because
    // `storageKeyLabel` is what produces it. `{ keyspace: key }` passes the same
    // allow-list while sending the raw key, and `{ label: `${item.title}` }`
    // sends a title under a key no token in `PII_PROP_TOKENS` matches. Neither
    // is something a key sweep can vouch for, so the VALUE form is pinned too.
    for (const file of SOURCE_FILES) {
      if (file === SENTRY_WRAPPER) continue;
      for (const body of extraObjects(readSource(file))) {
        assert.ok(body !== null, `${file}: captureException extra must be an object literal`);
        assert.match(
          body.trim(),
          /^(?:[A-Za-z_]\w*\s*,\s*)*[A-Za-z_]\w*\s*,?$/,
          `${file}: captureException extra must be shorthand identifiers, got \`${body.trim()}\` — a value written at the call site says nothing about what it holds`,
        );
      }
    }
  });
});

describe("PII guard — the wrapper exemptions still exempt something", () => {
  /**
   * What each wrapper has to still declare to go on being skipped.
   *
   * The half a hole cannot have while its path is spelled inside the loop. Each
   * skip above is justified by "this module DEFINES the call", and that is a
   * claim about the FILE rather than about the exemption — it stops being true
   * the day a wrapper moves, is renamed, or has its export pulled into a
   * sibling, and then three loops skip a module for a reason that has expired
   * with nothing about the lines looking stale.
   */
  const DECLARES: Readonly<Record<string, readonly string[]>> = {
    [TRACK_EVENT_WRAPPER]: ["export function trackEvent"],
    [SENTRY_WRAPPER]: ["export function addBreadcrumb", "export function captureException"],
  };

  it("are in the walk and still declare the calls they are skipped for", () => {
    // Through the shared helper rather than by hand: "is this hole still
    // needed" is the question `assertExemptionsHonest` exists to be the one
    // place for, and a single-entry hole is as entitled to it as a list. The
    // `expected` literal is the tripwire — the names live at module scope and
    // this call is two hundred lines down, so widening the skip means finding
    // both.
    assertExemptionsHonest({
      exemptions: [TRACK_EVENT_WRAPPER, SENTRY_WRAPPER],
      expected: ["lib/analytics.ts", "lib/sentry.ts"],
      rule: "the trackEvent / breadcrumb / captureException call-site sweeps",
      walk: SOURCE_FILES,
      stillNeeded: (wrapper) =>
        DECLARES[wrapper].every((declaration) => readSource(wrapper).includes(declaration)),
    });
  });
});

describe("PII guard — retention windows are documented", () => {
  it("docs/analytics-platform.md documents a Data retention section", () => {
    const doc = read("docs/analytics-platform.md");
    assert.match(doc, /##\s+Data retention/, "missing Data retention heading");
    for (const store of ["PostHog", "Supabase", "Sentry", "Clarity"]) {
      assert.match(
        doc,
        new RegExp(store),
        `Data retention table must mention ${store}`,
      );
    }
    // concrete day-bounded windows, not vague prose
    assert.match(doc, /7 days/);
    assert.match(doc, /90 days/);
    assert.match(doc, /30 days/);
  });

  it("MANUAL-TASKS.md documents the analytics_events prune job", () => {
    const manual = read("MANUAL-TASKS.md");
    assert.match(manual, /analytics_events retention prune/i);
    assert.match(manual, /interval '90 days'/);
  });
});
