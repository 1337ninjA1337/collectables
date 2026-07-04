import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  PRIVACY_PAGE_CSP,
  escapeHtml,
  renderMarkdownBody,
  renderPrivacyPage,
} from "../lib/privacy-page";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("renderMarkdownBody", () => {
  it("escapes HTML before any inline formatting (no markup injection)", () => {
    assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
    const html = renderMarkdownBody('Hello <img src=x onerror="pwn"> & **bold**');
    assert.ok(!html.includes("<img"), "raw HTML must be escaped");
    assert.match(html, /&lt;img/);
    assert.match(html, /<strong>bold<\/strong>/);
  });

  it("renders headings, paragraphs, lists and code spans", () => {
    const html = renderMarkdownBody("# T\n\n## S\n\ntext `code`\n\n- one\n- two");
    assert.match(html, /<h1>T<\/h1>/);
    assert.match(html, /<h2>S<\/h2>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
  });

  it("renders blockquotes with paragraphs inside", () => {
    const html = renderMarkdownBody("> **Crash.** Uses Sentry\n> for reports.");
    assert.match(html, /<blockquote>\n<p><strong>Crash\.<\/strong> Uses Sentry for reports\.<\/p>\n<\/blockquote>/);
  });

  it("renders pipe tables with a header row", () => {
    const html = renderMarkdownBody("| A | B |\n| --- | --- |\n| 1 | 2 |");
    assert.match(html, /<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
    assert.match(html, /<td>1<\/td><td>2<\/td>/);
  });

  it("links [text](url) and autolinks bare URLs, keeping trailing punctuation out", () => {
    const html = renderMarkdownBody("See [Sentry](https://sentry.io/privacy/) and https://posthog.com/dpa.");
    assert.match(html, /<a href="https:\/\/sentry\.io\/privacy\/">Sentry<\/a>/);
    assert.match(html, /<a href="https:\/\/posthog\.com\/dpa">https:\/\/posthog\.com\/dpa<\/a>\./);
  });
});

describe("renderPrivacyPage", () => {
  const page = renderPrivacyPage(read("PRIVACY.md"));

  it("emits a complete standalone document with title and viewport", () => {
    assert.match(page, /^<!DOCTYPE html>/);
    assert.match(page, /<title>Collectables — Privacy Policy<\/title>/);
    assert.match(page, /<meta name="viewport"/);
  });

  it("carries a strict script-free CSP", () => {
    assert.match(PRIVACY_PAGE_CSP, /default-src 'none'/);
    assert.ok(page.includes(`content="${PRIVACY_PAGE_CSP}"`));
    assert.ok(!page.includes("<script"), "policy page must not contain scripts");
  });

  it("renders the real PRIVACY.md without leaving raw markdown artifacts", () => {
    for (const marker of ["## What we collect", "**13 months**", "> **Crash", "| Surface |"]) {
      assert.ok(!page.includes(marker), `raw markdown leaked into the page: ${marker}`);
    }
    assert.match(page, /<h2>What we collect<\/h2>/);
    assert.match(page, /<strong>13 months<\/strong>/);
  });
});

describe("build wiring — /privacy ships with every deploy", () => {
  it("build-spa-fallback.ts reads PRIVACY.md and writes dist/privacy/index.html, failing the build when missing", () => {
    const src = read("scripts/build-spa-fallback.ts");
    assert.match(src, /renderPrivacyPage/);
    assert.match(src, /PRIVACY\.md/);
    assert.match(src, /dist.*privacy.*index\.html|privacyDir/s);
    assert.match(src, /PRIVACY\.md not found[\s\S]*?process\.exit\(1\)/);
  });
});

describe("service worker — /privacy is exempt from SPA-shell serving", () => {
  it("buildServiceWorker leaves privacy navigations to the network", () => {
    const sw = read("lib/spa-fallback.ts");
    assert.match(sw, /BASE \+ "privacy"/);
    assert.match(sw, /BASE \+ "privacy\/"/);
  });
});
