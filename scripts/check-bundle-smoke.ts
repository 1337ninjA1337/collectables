#!/usr/bin/env tsx
/**
 * Post-build smoke check: the exported web bundle still contains the watched
 * i18n keys, provider names and language codes, and the static `/privacy` page
 * survived the build. Pure logic (and the reasoning for replacing the two
 * inline ci.yml shell steps this came from) lives in `lib/bundle-smoke.ts`.
 *
 * Runs after `npm run build`, sharing `assertBundlePremise` with
 * `check-bundle-secrets` / `check-bundle-size` / `verify-bundle-inlining` — so
 * a stale or empty `dist/` fails with one named message here too, instead of
 * being grepped over as if it were current.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  PRIVACY_PAGE_TARGETS,
  evaluateBundleSmoke,
  evaluatePrivacyPages,
  formatBundleSmokeReport,
  formatPrivacyPagesReport,
  type PrivacyPageInput,
} from "../lib/bundle-smoke";
import { REPO_ROOT, assertBundlePremise } from "./bundle-premise";

const CHECK_NAME = "check-bundle-smoke";

/** All six emitted pages — the English policy and the five translations. */
function readPrivacyPages(root: string): PrivacyPageInput[] {
  return PRIVACY_PAGE_TARGETS.map((target) => {
    const full = path.join(root, ...target.relativePath.split("/"));
    if (!fs.existsSync(full)) return { target, exists: false, text: null };
    try {
      return { target, exists: true, text: fs.readFileSync(full, "utf8") };
    } catch {
      return { target, exists: true, text: null };
    }
  });
}

function main(): void {
  // Shared premise: dist/ present, at least one chunk, and newer than the
  // source tree. The shell version of this check never asked the last question,
  // so a forgotten rebuild produced a green smoke test for the previous build.
  const bundlePaths = assertBundlePremise(CHECK_NAME);

  const chunkTexts = bundlePaths.map((full) => fs.readFileSync(full, "utf8"));
  const smoke = evaluateBundleSmoke(chunkTexts);

  const privacy = evaluatePrivacyPages(readPrivacyPages(REPO_ROOT));

  // Both halves are reported before exiting — a fail-fast chain would hide a
  // missing privacy page behind a missing i18n key and cost a second CI run to
  // discover, which is the same reason lint:all runs every guard.
  console[smoke.ok ? "log" : "error"](
    formatBundleSmokeReport(CHECK_NAME, smoke),
  );
  console[privacy.ok ? "log" : "error"](
    formatPrivacyPagesReport(CHECK_NAME, privacy),
  );

  if (!smoke.ok || !privacy.ok) process.exit(1);
}

main();
