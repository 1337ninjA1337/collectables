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
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  formatSecretReport,
  scanForSecrets,
  type SecretMatch,
} from "../lib/secret-scan";
import { assertBundlePremise, assertScannedFiles } from "./bundle-premise";

const REPO_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");

const CHECK_NAME = "check-bundle-secrets";

/** Bundle artifacts that could embed a leaked credential. */
const SCAN_EXTENSIONS = new Set([".js", ".html", ".json", ".map", ".css"]);

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function main(): void {
  // Shared premise: dist/ exists, carries at least one exported chunk, and is
  // newer than the source tree. Without it this scan reports "no secrets
  // leaked" over zero bytes, or over a bundle exported before the leak.
  assertBundlePremise(CHECK_NAME);

  const files: string[] = [];
  walk(DIST_DIR, files);
  files.sort();

  // A second, narrower premise: the walk above matches five artifact
  // extensions, not just the *.js chunks the shared check counts, so an
  // extension list that stops matching is a distinct way to scan nothing.
  assertScannedFiles(CHECK_NAME, files.length, "bundle file");

  const matches: SecretMatch[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(REPO_ROOT, file);
    matches.push(...scanForSecrets(rel, source));
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
