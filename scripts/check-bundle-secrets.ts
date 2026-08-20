#!/usr/bin/env tsx
/**
 * Post-build guard (SEC-14): fails when a known secret pattern appears in the
 * exported web bundle under `dist/`. Catches a server-only credential (e.g. a
 * Supabase `service_role` JWT or a Cloudinary api_secret) that leaked into
 * client code and would otherwise be shipped to every browser.
 *
 * Runs as its own CI step right after `npm run build` (the bundle must exist
 * first). The matcher is shared with the source-tree scan via
 * `lib/secret-scan.ts`.
 *
 * This scan WALKS, and the one beside it asks git — which now reads as an
 * oversight and is a decision. `check-secrets` takes its candidates from `git
 * ls-files` because its report is about the COMMITTED set, and a walk of the
 * working tree is not that set. `dist/` is the opposite case in every respect:
 * `.gitignore` covers it whole, so git's listing names nothing under it and
 * asking would return an empty candidate set over a directory that exists and
 * is full — and the set this guard reports on is not what git would take but
 * what the browser was SENT, which is exactly what is on disk. Walking is not
 * the fallback here; it is the only enumeration that answers the question.
 * `__tests__/bundle-walk-premise.test.ts` pins both halves against git rather
 * than leaving them as prose.
 *
 * Three properties ride on that walk, and each is free only because it walks:
 *   - the regular-file question. `listFilesUnder` asks `entry.isFile()` of
 *     every entry, so a symlink an exporter dropped into `dist/` is never read
 *     through — the hole `partitionRegularFiles` exists to close on the git
 *     path. Taking candidates from anywhere else loses this silently.
 *   - the unread clause. `check-secrets` reports which listed candidates it
 *     could not read, because a listing can name a path the disk does not hold;
 *     a walk cannot, since it only ever names what it just met.
 *   - the `.local.` convention. `isLocalOnlyPath` keeps a file holding a real
 *     credential out of the source scan. Nothing generates a `*.local.*` name
 *     into `dist/`, and if a build did emit one it would have been SHIPPED, so
 *     honouring the convention here would skip the one copy that matters.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  BUNDLE_SCAN_EXTENSIONS,
  BUNDLE_SKIP_DIRS,
  formatSecretReport,
  scanForSecrets,
  type SecretMatch,
} from "../lib/secret-scan";
import { assertBundlePremise, assertScannedFiles } from "./bundle-premise";
import { listFilesUnder } from "./guard-io";

const REPO_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");

const CHECK_NAME = "check-bundle-secrets";

function main(): void {
  // Shared premise: dist/ exists, carries at least one exported chunk, and is
  // newer than the source tree. Without it this scan reports "no secrets
  // leaked" over zero bytes, or over a bundle exported before the leak.
  assertBundlePremise(CHECK_NAME);

  // `BUNDLE_SKIP_DIRS` is empty, and passing it is the point: the source scan
  // beside this one skips six names, so an omitted argument here reads as an
  // oversight rather than as the decision it is. `lib/secret-scan.ts` says why
  // nothing under `dist/` may be skipped.
  const files = listFilesUnder(DIST_DIR, {
    extensions: BUNDLE_SCAN_EXTENSIONS,
    skipDirs: BUNDLE_SKIP_DIRS,
  });

  // A second, narrower premise: the walk above matches five artifact
  // extensions, not just the *.js chunks the shared check counts, so an
  // extension list that stops matching is a distinct way to scan nothing.
  assertScannedFiles(CHECK_NAME, files.length, "bundle file");

  const matches: SecretMatch[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = fs.readFileSync(path.join(DIST_DIR, file), "utf8");
    } catch {
      continue;
    }
    // Reported under `dist/`, which is where a reader of this guard looks —
    // the walk returns paths relative to the root it was given.
    matches.push(...scanForSecrets(path.join("dist", file), source));
  }

  if (matches.length === 0) {
    console.log(
      `check-bundle-secrets: scanned ${files.length} bundle file(s), no secrets leaked.`,
    );
    return;
  }

  console.error(formatSecretReport(matches));
  console.error(
    "\nA server-only secret leaked into the web bundle. Move it to an Edge " +
      "Function / GitHub Secret and rebuild before deploying.",
  );
  process.exit(1);
}

main();
