import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const deploy = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "deploy.yml"),
  "utf8",
);
const ci = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "ci.yml"),
  "utf8",
);

// The /privacy page is the public policy URL App Store review links to.
// build-spa-fallback.ts emits it on every build; these smoke checks catch a
// renderPrivacyPage regression (empty/broken output) before it ships.
describe("privacy page smoke check — deploy workflow", () => {
  it("has a Privacy page smoke check step", () => {
    assert.match(deploy, /- name: Privacy page smoke check/);
  });

  it("asserts dist/privacy/index.html exists", () => {
    assert.match(deploy, /\[ ! -f dist\/privacy\/index\.html \]/);
  });

  it("greps the rendered page for 'Privacy Policy'", () => {
    assert.match(deploy, /grep -q "Privacy Policy" dist\/privacy\/index\.html/);
  });

  it("runs after the SPA fallback step that emits the page", () => {
    const fallback = deploy.indexOf("build-spa-fallback.ts");
    const smoke = deploy.indexOf("- name: Privacy page smoke check");
    assert.ok(fallback !== -1, "SPA fallback step present");
    assert.ok(smoke !== -1, "smoke check step present");
    assert.ok(smoke > fallback, "smoke check must follow the fallback step");
  });

  it("runs before the pages artifact is uploaded", () => {
    const smoke = deploy.indexOf("- name: Privacy page smoke check");
    const upload = deploy.indexOf("upload-pages-artifact");
    assert.ok(upload !== -1, "upload step present");
    assert.ok(smoke < upload, "smoke check must gate the artifact upload");
  });
});

describe("privacy page smoke check — CI workflow", () => {
  it("has a Privacy page smoke check step", () => {
    assert.match(ci, /- name: Privacy page smoke check/);
  });

  it("asserts dist/privacy/index.html exists", () => {
    assert.match(ci, /\[ ! -f dist\/privacy\/index\.html \]/);
  });

  it("greps the rendered page for 'Privacy Policy'", () => {
    assert.match(ci, /grep -q "Privacy Policy" dist\/privacy\/index\.html/);
  });

  it("runs after the web build that emits the page", () => {
    const build = ci.indexOf("- name: Web build");
    const smoke = ci.indexOf("- name: Privacy page smoke check");
    assert.ok(build !== -1, "Web build step present");
    assert.ok(smoke !== -1, "smoke check step present");
    assert.ok(smoke > build, "smoke check must follow the web build");
  });
});

describe("privacy page smoke check — grep marker stays valid", () => {
  it("PRIVACY.md contains the 'Privacy Policy' marker the smoke checks grep for", () => {
    const privacyMd = readFileSync(
      path.join(process.cwd(), "PRIVACY.md"),
      "utf8",
    );
    assert.match(privacyMd, /Privacy Policy/);
  });
});
