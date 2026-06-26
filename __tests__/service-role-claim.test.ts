import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  assertServiceRoleKey,
  assertAnonKey,
  decodeJwtRole,
  ServiceRoleClaimError,
} from "../lib/service-role-claim";

/**
 * BE-23 — service_role-claim self-check.
 *
 * The pure matcher (`lib/service-role-claim.ts`) runs under Node, so it gets
 * full behavioural coverage here. The Edge Functions themselves run under
 * Deno, so they get source-level structural assertions (the check is wired in
 * and fails closed).
 */

/** Build a fake unsigned JWT carrying the given `role` claim. */
function jwtWithRole(role: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ role, iss: "supabase", ref: "abc" }),
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("decodeJwtRole", () => {
  it("returns the role claim of a well-formed JWT", () => {
    assert.equal(decodeJwtRole(jwtWithRole("service_role")), "service_role");
    assert.equal(decodeJwtRole(jwtWithRole("anon")), "anon");
  });

  it("returns null for a non-JWT (wrong segment count)", () => {
    assert.equal(decodeJwtRole("not-a-jwt"), null);
    assert.equal(decodeJwtRole("a.b"), null);
  });

  it("returns null when the payload is not valid JSON", () => {
    assert.equal(decodeJwtRole("aaa.not-base64-json.sig"), null);
  });

  it("returns null when there is no string role claim", () => {
    const header = Buffer.from("{}").toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "supabase" })).toString("base64url");
    assert.equal(decodeJwtRole(`${header}.${payload}.sig`), null);
  });
});

describe("assertServiceRoleKey", () => {
  it("accepts a service_role JWT", () => {
    assert.doesNotThrow(() => assertServiceRoleKey(jwtWithRole("service_role"), "fn"));
  });

  it("accepts a new-style sb_secret_ key", () => {
    assert.doesNotThrow(() => assertServiceRoleKey("sb_secret_abc123", "fn"));
  });

  it("rejects an empty / unset secret", () => {
    assert.throws(() => assertServiceRoleKey("", "fn"), ServiceRoleClaimError);
    assert.throws(() => assertServiceRoleKey(undefined, "fn"), ServiceRoleClaimError);
    assert.throws(() => assertServiceRoleKey("   ", "fn"), /is not set/);
  });

  it("rejects an anon JWT pasted into the service-role slot", () => {
    assert.throws(
      () => assertServiceRoleKey(jwtWithRole("anon"), "fn"),
      /role "anon".*service_role/,
    );
  });

  it("rejects a new-style publishable key", () => {
    assert.throws(
      () => assertServiceRoleKey("sb_publishable_xyz", "fn"),
      /publishable key/,
    );
  });

  it("rejects a malformed secret", () => {
    assert.throws(() => assertServiceRoleKey("garbage", "fn"), /malformed/);
  });

  it("names the offending function in the error message", () => {
    assert.throws(() => assertServiceRoleKey("", "delete-account"), /\[delete-account\]/);
  });
});

describe("assertAnonKey", () => {
  it("accepts an anon JWT", () => {
    assert.doesNotThrow(() => assertAnonKey(jwtWithRole("anon"), "fn"));
  });

  it("accepts a new-style sb_publishable_ key", () => {
    assert.doesNotThrow(() => assertAnonKey("sb_publishable_xyz", "fn"));
  });

  it("rejects an empty / unset key", () => {
    assert.throws(() => assertAnonKey("", "fn"), /is not set/);
  });

  it("rejects a service-role JWT in the anon slot", () => {
    assert.throws(
      () => assertAnonKey(jwtWithRole("service_role"), "fn"),
      /role "service_role".*anon/,
    );
  });

  it("rejects a new-style secret key in the anon slot", () => {
    assert.throws(() => assertAnonKey("sb_secret_abc", "fn"), /secret key/);
  });
});

describe("Edge Functions wire in the self-check (structural)", () => {
  const fn = (name: string) =>
    path.join(process.cwd(), "supabase", "functions", name, "index.ts");

  it("delete-account asserts the service-role claim before privileged deletes", () => {
    const src = readFileSync(fn("delete-account"), "utf8");
    assert.match(src, /from\s+['"][^'"]*lib\/service-role-claim\.ts['"]/);
    assert.match(src, /assertServiceRoleKey\(serviceRoleKey,\s*["']delete-account["']\)/);
    // The check must precede the admin client construction.
    assert.ok(
      src.indexOf("assertServiceRoleKey") < src.indexOf("adminClient = createClient"),
      "self-check must run before the admin client is built",
    );
  });

  it("analytics-mirror asserts the service-role claim before the privileged insert", () => {
    const src = readFileSync(fn("analytics-mirror"), "utf8");
    assert.match(src, /assertServiceRoleKey\(serviceRoleKey,\s*["']analytics-mirror["']\)/);
    assert.ok(
      src.indexOf("assertServiceRoleKey") < src.indexOf("adminClient = createClient"),
      "self-check must run before the admin client is built",
    );
  });

  it("delete-image asserts the anon claim via the shared assertCaller gate (SEC-9)", () => {
    const src = readFileSync(fn("delete-image"), "utf8");
    // The anon-key self-check now lives inside assertCaller; delete-image gates
    // on it before any Cloudinary work by delegating to the shared helper.
    assert.match(src, /from ["']\.\.\/_shared\/assert-caller\.ts["']/);
    assert.match(src, /assertCaller\(req,\s*["']delete-image["']\)/);
    assert.ok(
      src.indexOf("assertCaller") < src.indexOf("CLOUDINARY_API_SECRET"),
      "caller gate must run before the Cloudinary secret is read",
    );
  });

  it("all three functions return 500 (fail closed) on a misconfigured secret", () => {
    for (const name of ["delete-account", "analytics-mirror", "delete-image"]) {
      const src = readFileSync(fn(name), "utf8");
      assert.match(src, /ServiceRoleClaimError/, `${name} catches the typed error`);
      assert.match(src, /misconfigured/, `${name} responds with a misconfigured error`);
    }
  });

  it("the shared helper module exists", () => {
    assert.ok(
      statSync(path.join(process.cwd(), "lib", "service-role-claim.ts")).isFile(),
    );
  });
});
