import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRIVACY_PAGE_MARKER,
  PRIVACY_PAGE_RELATIVE_PATH,
} from "../lib/bundle-smoke";
import { readRepoFile } from "./helpers/repo-file";

const deploy = readRepoFile(".github/workflows/deploy.yml");
const ci = readRepoFile(".github/workflows/ci.yml");

const SMOKE_STEP = "- name: Bundle + privacy page smoke check";
const SMOKE_COMMAND = "npm run lint:bundle-smoke";

// The /privacy page is the public policy URL App Store review links to.
// build-spa-fallback.ts emits it on every build; these smoke checks catch a
// renderPrivacyPage regression (empty/broken output) before it ships.
//
// Both workflows used to inline the same two-grep shell block. They now run
// `scripts/check-bundle-smoke.ts`, so the assertions below pin the WIRING
// (the step exists, runs the script, and sits between the step that emits the
// page and the step that publishes it) while `bundle-smoke.test.ts` pins what
// the script actually checks. The old shape is pinned as a regression: a
// hand-rolled grep is how the marker gets two definitions again.
describe("privacy page smoke check — deploy workflow", () => {
  it("has a smoke check step", () => {
    assert.ok(deploy.includes(SMOKE_STEP), "smoke check step present");
  });

  it("runs the shared script rather than inline shell", () => {
    assert.ok(deploy.includes(SMOKE_COMMAND));
  });

  it("runs after the SPA fallback step that emits the page", () => {
    const fallback = deploy.indexOf("build-spa-fallback.ts");
    const smoke = deploy.indexOf(SMOKE_STEP);
    assert.ok(fallback !== -1, "SPA fallback step present");
    assert.ok(smoke !== -1, "smoke check step present");
    assert.ok(smoke > fallback, "smoke check must follow the fallback step");
  });

  it("runs before the pages artifact is uploaded", () => {
    const smoke = deploy.indexOf(SMOKE_STEP);
    const upload = deploy.indexOf("upload-pages-artifact");
    assert.ok(upload !== -1, "upload step present");
    assert.ok(smoke < upload, "smoke check must gate the artifact upload");
  });

  it("runs before the sourcemaps are stripped", () => {
    // The strip step deletes files the premise's chunk walk ignores (*.js
    // only), so the order does not change the verdict today — but a smoke
    // check that ran after a destructive step would be checking a different
    // artifact than the one it claims to.
    const smoke = deploy.indexOf(SMOKE_STEP);
    const strip = deploy.indexOf("Strip sourcemap files");
    assert.ok(strip !== -1, "sourcemap strip step present");
    assert.ok(smoke < strip);
  });
});

describe("privacy page smoke check — CI workflow", () => {
  it("has a smoke check step", () => {
    assert.ok(ci.includes(SMOKE_STEP), "smoke check step present");
  });

  it("runs the shared script rather than inline shell", () => {
    assert.ok(ci.includes(SMOKE_COMMAND));
  });

  it("runs after the web build that emits the page", () => {
    const build = ci.indexOf("- name: Web build");
    const smoke = ci.indexOf(SMOKE_STEP);
    assert.ok(build !== -1, "Web build step present");
    assert.ok(smoke !== -1, "smoke check step present");
    assert.ok(smoke > build, "smoke check must follow the web build");
  });
});

describe("privacy page smoke check — no workflow re-implements it", () => {
  for (const [name, body] of [
    ["ci.yml", ci],
    ["deploy.yml", deploy],
  ] as const) {
    it(`${name} does not hand-roll the privacy page existence check`, () => {
      assert.ok(!body.includes(`[ ! -f ${PRIVACY_PAGE_RELATIVE_PATH} ]`));
    });

    it(`${name} does not hand-roll the "${PRIVACY_PAGE_MARKER}" grep`, () => {
      assert.ok(
        !body.includes(
          `grep -q "${PRIVACY_PAGE_MARKER}" ${PRIVACY_PAGE_RELATIVE_PATH}`,
        ),
      );
    });
  }
});

describe("privacy page smoke check — grep marker stays valid", () => {
  it("PRIVACY.md contains the marker the smoke check looks for", () => {
    const privacyMd = readRepoFile("PRIVACY.md");
    assert.ok(privacyMd.includes(PRIVACY_PAGE_MARKER));
  });

  it("renderPrivacyPage always emits the marker, independent of PRIVACY.md", () => {
    // The marker is in the <title> the renderer writes, not only in the
    // markdown it was handed — so the check survives a PRIVACY.md reword.
    const renderer = readRepoFile("lib/privacy-page.ts");
    assert.ok(renderer.includes(PRIVACY_PAGE_MARKER));
  });
});
