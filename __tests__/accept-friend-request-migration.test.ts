import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-21 — `20260624_accept_friend_request.sql` adds the transactional
 * `accept_friend_request(p_from_user_id, p_to_user_id)` SQL function backing the
 * `accept-friend-request` Edge Function.
 *
 * Structural guards (the function actually runs on the Docker-backed
 * supabase-test CI, not here):
 *   (1) the function is SECURITY DEFINER with a pinned search_path;
 *   (2) it locks the inbound row FOR UPDATE (the transactional guarantee);
 *   (3) it raises when the inbound request is gone (no dangling one-way row);
 *   (4) it inserts the reverse direction idempotently (ON CONFLICT DO NOTHING);
 *   (5) it is server-only — REVOKE FROM PUBLIC + GRANT TO service_role;
 *   (6) it is idempotent to re-apply (CREATE OR REPLACE FUNCTION);
 *   (7) it is documented in MANUAL-TASKS.md + the README apply order.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260624_accept_friend_request.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

describe("accept_friend_request migration (BE-21)", () => {
  it("defines the function idempotently with both id parameters", () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.accept_friend_request\(/i);
    assert.match(SQL, /p_from_user_id\s+uuid/i);
    assert.match(SQL, /p_to_user_id\s+uuid/i);
  });

  it("is SECURITY DEFINER with a pinned search_path", () => {
    assert.match(SQL, /SECURITY DEFINER/i);
    assert.match(SQL, /SET search_path = public/i);
  });

  it("locks the inbound sender→acceptor row FOR UPDATE (transactional flip)", () => {
    assert.match(SQL, /from_user_id = p_from_user_id/i);
    assert.match(SQL, /to_user_id = p_to_user_id/i);
    assert.match(SQL, /FOR UPDATE/i);
  });

  it("raises when the inbound request is gone (no dangling one-way row)", () => {
    assert.match(SQL, /IF NOT FOUND THEN/i);
    assert.match(SQL, /no pending friend request/i);
    assert.match(SQL, /P0002/);
  });

  it("inserts the reverse direction idempotently", () => {
    assert.match(SQL, /INSERT INTO public\.friend_requests/i);
    assert.match(SQL, /VALUES \(p_to_user_id, p_from_user_id\)/i);
    assert.match(SQL, /ON CONFLICT \(from_user_id, to_user_id\) DO NOTHING/i);
  });

  it("rejects a null/self acceptance defensively", () => {
    assert.match(SQL, /p_from_user_id IS NULL OR p_to_user_id IS NULL/i);
    assert.match(SQL, /p_from_user_id = p_to_user_id/i);
  });

  it("is server-only: REVOKE FROM PUBLIC + GRANT TO service_role", () => {
    assert.match(SQL, /REVOKE ALL ON FUNCTION public\.accept_friend_request\(uuid, uuid\) FROM PUBLIC/i);
    assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.accept_friend_request\(uuid, uuid\) TO service_role/i);
    // It must NOT be exposed to anon/authenticated PostgREST callers.
    assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*TO authenticated/i);
    assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*TO anon/i);
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.ok(
      MANUAL.includes("## 20260624_accept_friend_request.sql"),
      "MANUAL-TASKS.md must have a section for the migration",
    );
    assert.match(README, /20260624_accept_friend_request\.sql/);
  });
});
