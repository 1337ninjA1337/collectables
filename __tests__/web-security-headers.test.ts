import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  CSP_CONNECT_SRC,
  CSP_META_MARKER,
  buildContentSecurityPolicy,
  buildSecurityMetaTags,
  extractInlineScriptBodies,
  injectSecurityMetaTags,
} from "../lib/web-security-headers";
import { injectServiceWorkerRegistration } from "../lib/spa-fallback";

const repoRoot = path.join(__dirname, "..");

/** Minimal stand-in for the Expo metro single-output shell. */
const EXPO_SHELL = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>collectables</title><style id="expo-reset">html{height:100%}</style></head><body><div id="root"></div><script src="/collectables/_expo/static/js/web/entry-abc.js" defer></script></body></html>`;

function parseDirectives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    out[tokens[0]] = tokens.slice(1);
  }
  return out;
}

describe("buildContentSecurityPolicy", () => {
  it("emits all the enforced directives", () => {
    const d = parseDirectives(buildContentSecurityPolicy());
    for (const name of [
      "default-src",
      "base-uri",
      "object-src",
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
    ]) {
      assert.ok(d[name], `missing directive ${name}`);
    }
    assert.deepEqual(d["default-src"], ["'self'"]);
    assert.deepEqual(d["object-src"], ["'none'"]);
  });

  it("keeps script-src strict: 'self' only, no unsafe-inline/eval", () => {
    const d = parseDirectives(buildContentSecurityPolicy());
    assert.ok(d["script-src"].includes("'self'"));
    assert.ok(!d["script-src"].includes("'unsafe-inline'"));
    assert.ok(!d["script-src"].includes("'unsafe-eval'"));
  });

  it("admits provided inline-script hashes in script-src", () => {
    const hash = "'sha256-abc123='";
    const d = parseDirectives(buildContentSecurityPolicy({ scriptHashes: [hash] }));
    assert.ok(d["script-src"].includes(hash));
    assert.ok(d["script-src"].includes("'self'"));
  });

  it("limits connect-src to the Supabase/Cloudinary/PostHog/Clarity/Sentry allow-list", () => {
    const d = parseDirectives(buildContentSecurityPolicy());
    assert.ok(d["connect-src"].includes("'self'"));
    assert.ok(d["connect-src"].includes("https://*.supabase.co"));
    assert.ok(d["connect-src"].includes("wss://*.supabase.co"));
    assert.ok(d["connect-src"].includes("https://api.cloudinary.com"));
    assert.ok(d["connect-src"].includes("https://*.posthog.com"));
    // Never a blanket wildcard.
    assert.ok(!d["connect-src"].includes("*"));
    assert.ok(!d["connect-src"].includes("https:"));
  });

  it("merges extra connect/img sources and de-dupes", () => {
    const csp = buildContentSecurityPolicy({
      extraConnectSrc: ["https://custom.example.com", "'self'"],
      extraImgSrc: ["https://res.cloudinary.com"],
    });
    const d = parseDirectives(csp);
    assert.ok(d["connect-src"].includes("https://custom.example.com"));
    assert.equal(d["connect-src"].filter((s) => s === "'self'").length, 1);
    assert.equal(
      d["img-src"].filter((s) => s === "https://res.cloudinary.com").length,
      1,
    );
  });

  it("allows the Clarity tag origin in script-src (shipped feature stays working)", () => {
    const d = parseDirectives(buildContentSecurityPolicy());
    assert.ok(d["script-src"].includes("https://www.clarity.ms"));
  });

  it("is deterministic", () => {
    assert.equal(
      buildContentSecurityPolicy({ scriptHashes: ["'sha256-x='"] }),
      buildContentSecurityPolicy({ scriptHashes: ["'sha256-x='"] }),
    );
  });
});

describe("buildSecurityMetaTags", () => {
  it("emits CSP + referrer + X-Content-Type-Options", () => {
    const tags = buildSecurityMetaTags("default-src 'self'");
    assert.match(tags, /http-equiv="Content-Security-Policy"/);
    assert.match(tags, /content="default-src 'self'"/);
    assert.match(tags, /name="referrer" content="strict-origin-when-cross-origin"/);
    assert.match(tags, /http-equiv="X-Content-Type-Options" content="nosniff"/);
  });
});

describe("extractInlineScriptBodies", () => {
  it("returns inline bodies and skips src-bearing scripts", () => {
    const html = `<script src="a.js"></script><script>var a=1;</script><script type="application/json">{"x":1}</script>`;
    assert.deepEqual(extractInlineScriptBodies(html), ['var a=1;', '{"x":1}']);
  });

  it("returns an empty array when there are no inline scripts", () => {
    assert.deepEqual(extractInlineScriptBodies(`<script src="a.js"></script>`), []);
  });

  it("captures the SW-registration script body", () => {
    const html = injectServiceWorkerRegistration("<head></head>", "/collectables");
    const bodies = extractInlineScriptBodies(html);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0], /serviceWorker/);
  });
});

describe("injectSecurityMetaTags", () => {
  it("inserts the CSP meta as the first thing inside <head>", () => {
    const csp = buildContentSecurityPolicy();
    const out = injectSecurityMetaTags(EXPO_SHELL, csp);
    assert.ok(out.includes(CSP_META_MARKER));
    const headIdx = out.indexOf("<head>") + "<head>".length;
    const firstMeta = out.indexOf("<meta", headIdx);
    assert.ok(
      out.slice(firstMeta).startsWith('<meta http-equiv="Content-Security-Policy"'),
      "the first <meta> inside <head> must be the CSP",
    );
  });

  it("places the CSP meta before any script in the document", () => {
    const withSw = injectServiceWorkerRegistration(EXPO_SHELL, "/collectables");
    const out = injectSecurityMetaTags(withSw, buildContentSecurityPolicy());
    assert.ok(out.indexOf(CSP_META_MARKER) < out.indexOf("<script"));
  });

  it("is idempotent", () => {
    const once = injectSecurityMetaTags(EXPO_SHELL, buildContentSecurityPolicy());
    const twice = injectSecurityMetaTags(once, buildContentSecurityPolicy());
    assert.equal(once, twice);
  });

  it("falls back to prepending when there is no <head>", () => {
    const out = injectSecurityMetaTags("<body>hi</body>", "default-src 'self'");
    assert.ok(out.startsWith("<meta http-equiv="));
  });
});

describe("end-to-end build transform (mirrors scripts/build-spa-fallback.ts)", () => {
  // Reproduce exactly what the build script does so the test proves the CSP
  // meta is present in the "built" index.html (the SEC-15 acceptance check),
  // including that the inline SW script's own hash is admitted by script-src.
  function buildLikeScript(html: string, baseUrl: string): string {
    const withSw = injectServiceWorkerRegistration(html, baseUrl);
    const hashes = extractInlineScriptBodies(withSw).map(
      (body) =>
        `'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`,
    );
    const csp = buildContentSecurityPolicy({ scriptHashes: hashes });
    return injectSecurityMetaTags(withSw, csp);
  }

  it("produces a shell carrying the CSP meta tag", () => {
    const built = buildLikeScript(EXPO_SHELL, "/collectables");
    assert.ok(built.includes(CSP_META_MARKER));
    assert.match(built, /name="referrer"/);
    assert.match(built, /X-Content-Type-Options/);
  });

  it("admits the inline SW script via its sha256 hash (no unsafe-inline needed)", () => {
    const built = buildLikeScript(EXPO_SHELL, "/collectables");
    const cspContent =
      built.match(/Content-Security-Policy" content="([^"]*)"/)?.[1] ?? "";
    const d = parseDirectives(cspContent);
    assert.ok(!d["script-src"].includes("'unsafe-inline'"));
    const swBody = extractInlineScriptBodies(
      injectServiceWorkerRegistration(EXPO_SHELL, "/collectables"),
    )[0];
    const swHash = `'sha256-${crypto
      .createHash("sha256")
      .update(swBody, "utf8")
      .digest("base64")}'`;
    assert.ok(
      d["script-src"].includes(swHash),
      "script-src must include the SW inline-script hash",
    );
  });
});

describe("structural wiring", () => {
  it("scripts/build-spa-fallback.ts injects the security headers", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "scripts", "build-spa-fallback.ts"),
      "utf8",
    );
    assert.match(source, /injectSecurityMetaTags/);
    assert.match(source, /extractInlineScriptBodies/);
    assert.match(source, /buildContentSecurityPolicy/);
    assert.match(source, /injectSecurityHeaders/);
  });

  it("the connect-src allow-list stays free of blanket wildcards", () => {
    assert.ok(!CSP_CONNECT_SRC.includes("*"));
    assert.ok(!CSP_CONNECT_SRC.some((s) => s === "https:" || s === "http:"));
  });
});
