#!/usr/bin/env tsx
/**
 * Post-build guard: fails when a package the advisory baseline accepts as
 * "does not reach the client" has its fingerprint in the exported web bundle.
 *
 * `shipsToClient` is the half of every exemption that makes a high advisory
 * acceptable rather than urgent, and until this existed it was a sentence
 * somebody wrote once. Pure logic and the reasoning — why a fingerprint rather
 * than the package name, and what a miss can and cannot say — live in
 * `lib/ships-to-client.ts`.
 *
 * Runs after `npm run build`, sharing `assertBundlePremise` with
 * `check-bundle-secrets` / `check-bundle-size` / `check-bundle-smoke`: a stale
 * or empty `dist/` fails with one named message here too, rather than being
 * grepped over as if it were current. A guard that reported "no fingerprint
 * found" over yesterday's bundle would be worse than no guard, because it
 * would say the claim had been measured.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ACCEPTED_HIGH_ADVISORIES } from "../lib/audit-baseline";
import {
  evaluateShipsToClient,
  formatShipsToClientReport,
  isShipsToClientClean,
} from "../lib/ships-to-client";
import { REPO_ROOT, assertBundlePremise } from "./bundle-premise";

const CHECK_NAME = "check-ships-to-client";

function main(): void {
  const bundlePaths = assertBundlePremise(CHECK_NAME);
  // Keyed by the repo-relative path, because a finding has to name the chunk
  // somebody will open: `dist/_expo/static/js/web/entry-<hash>.js` is a file,
  // "chunk 3" is a number.
  const chunks = new Map(
    bundlePaths.map((full) => [
      path.relative(REPO_ROOT, full),
      fs.readFileSync(full, "utf8"),
    ]),
  );
  const verdict = evaluateShipsToClient(ACCEPTED_HIGH_ADVISORIES, chunks);
  console[isShipsToClientClean(verdict) ? "log" : "error"](
    formatShipsToClientReport(CHECK_NAME, verdict),
  );
  if (!isShipsToClientClean(verdict)) process.exit(1);
}

main();
