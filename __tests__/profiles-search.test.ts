import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  profilesSearchUrl,
  sanitizeProfileSearchQuery,
} from "@/lib/supabase-profiles-shapes";

const ROOT = process.cwd();

describe("sanitizeProfileSearchQuery", () => {
  it("strips a leading @ so pasted handles match", () => {
    assert.equal(sanitizeProfileSearchQuery("@antoxa"), "antoxa");
  });

  it("removes PostgREST/ilike metacharacters", () => {
    assert.equal(sanitizeProfileSearchQuery("a,b(c)d%e*f\\g\"h'i"), "abcdefghi");
  });

  it("trims whitespace", () => {
    assert.equal(sanitizeProfileSearchQuery("  juno  "), "juno");
  });

  it("returns empty string for a query of only metacharacters", () => {
    assert.equal(sanitizeProfileSearchQuery("%()*,"), "");
  });
});

describe("profilesSearchUrl", () => {
  const BASE = "https://proj.supabase.co";

  it("builds an or=(username.ilike,display_name.ilike) query", () => {
    const url = profilesSearchUrl(BASE, "juno", 20);
    assert.match(url, /\/rest\/v1\/profiles\?select=/);
    assert.match(url, /or=\(username\.ilike\.\*juno\*,display_name\.ilike\.\*juno\*\)/);
    assert.match(url, /limit=20$/);
  });

  it("sanitizes the query before embedding it", () => {
    const url = profilesSearchUrl(BASE, "@ju,no(1)", 10);
    // The user's parens/commas must not survive into the boolean tree — only
    // the or=()'s own two parens and one comma remain.
    assert.match(url, /ilike\.\*juno1\*/);
    assert.ok(!url.includes("no(1)"), "unsanitized query leaked into the URL");
  });
});

describe("people/search UI uses the server-side search", () => {
  it("app/people.tsx queries searchProfiles when the box is non-empty", () => {
    const src = readFileSync(path.join(ROOT, "app/people.tsx"), "utf8");
    assert.match(src, /import \{ fetchProfiles, searchProfiles \} from "@\/lib\/supabase-profiles"/);
    assert.match(src, /searchProfiles\(normalized, 50\)/);
  });

  it("components/search-overlay.tsx queries searchProfiles for the people section", () => {
    const src = readFileSync(path.join(ROOT, "components/search-overlay.tsx"), "utf8");
    assert.match(src, /searchProfiles\(q, 20\)/);
  });

  it("app/people.tsx catches fetchProfiles failures instead of blanking silently", () => {
    const src = readFileSync(path.join(ROOT, "app/people.tsx"), "utf8");
    assert.match(src, /const result = await fetchProfiles\(pageNum, PAGE_SIZE\);[\s\S]*?\} catch \{/);
  });
});
