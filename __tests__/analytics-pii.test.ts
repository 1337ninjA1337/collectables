import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import {
  PII_PROP_TOKENS,
  tokenizePropKey,
  isPiiPropKey,
  findPiiPropKeys,
} from "../lib/analytics-pii";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Directories that hold telemetry call sites. node_modules / dist excluded.
const SCAN_DIRS = ["lib", "components", "app"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

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
      const src = readFileSync(file, "utf8");
      if (file.endsWith(join("lib", "analytics.ts"))) continue; // wrapper itself
      const rel = file.slice(ROOT.length + 1);

      // name + object-literal props
      for (const m of src.matchAll(
        /trackEvent\(\s*["'](\w+)["']\s*,\s*\{([\s\S]*?)\}\s*\)/g,
      )) {
        callsChecked++;
        const [, name, body] = m;
        const def = (ANALYTICS_EVENTS as Record<string, { props: readonly string[] }>)[
          name
        ];
        assert.ok(def, `${rel}: trackEvent("${name}") is not in the taxonomy`);
        const allowed = new Set(def.props);
        for (const key of extractObjectKeys(body)) {
          assert.ok(
            allowed.has(key),
            `${rel}: trackEvent("${name}") passes undeclared prop "${key}" (allowed: ${[...allowed].join(", ")})`,
          );
          assert.equal(
            isPiiPropKey(key),
            false,
            `${rel}: trackEvent("${name}") passes PII-shaped prop "${key}"`,
          );
        }
      }

      // every trackEvent name (even propless) must be a known event
      for (const m of src.matchAll(/trackEvent\(\s*["'](\w+)["']/g)) {
        const name = m[1];
        assert.ok(
          (ANALYTICS_EVENTS as Record<string, unknown>)[name],
          `${rel}: trackEvent("${name}") is not in the taxonomy`,
        );
      }
    }
    assert.ok(callsChecked > 0, "expected to find at least one trackEvent call");
  });
});

describe("PII guard — breadcrumb call sites carry no user input", () => {
  const BREADCRUMB_ALLOWED_DATA_KEYS = new Set(["from", "to"]);

  it("addBreadcrumb data objects only use route allow-listed keys", () => {
    let calls = 0;
    for (const file of SOURCE_FILES) {
      const src = readFileSync(file, "utf8");
      if (file.endsWith(join("lib", "sentry.ts"))) continue; // wrapper itself
      const rel = file.slice(ROOT.length + 1);
      for (const m of src.matchAll(
        /addBreadcrumb\([\s\S]*?\{([\s\S]*?)\}\s*\)/g,
      )) {
        calls++;
        for (const key of extractObjectKeys(m[1])) {
          assert.ok(
            BREADCRUMB_ALLOWED_DATA_KEYS.has(key),
            `${rel}: addBreadcrumb passes non-allow-listed data key "${key}" (allowed: from, to)`,
          );
          assert.equal(
            isPiiPropKey(key),
            false,
            `${rel}: addBreadcrumb passes PII-shaped data key "${key}"`,
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
      const src = readFileSync(file, "utf8");
      if (file.endsWith(join("lib", "sentry.ts"))) continue; // wrapper itself
      const rel = file.slice(ROOT.length + 1);
      for (const m of src.matchAll(
        /captureException\([\s\S]*?context:\s*([^,}\n]+)/g,
      )) {
        const value = m[1].trim();
        assert.match(
          value,
          /^["'][^"']*["']$/,
          `${rel}: captureException context must be a constant string literal, got \`${value}\` (no interpolated user data)`,
        );
      }
    }
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
