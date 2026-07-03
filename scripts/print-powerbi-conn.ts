#!/usr/bin/env tsx
/**
 * Prints the Supabase session-pooler connection values Power BI needs
 * (docs/powerbi-connection.md §2–3), derived from the repo `.env` (or the
 * exported environment when `.env` is absent).
 *
 *   npm run powerbi:conn
 *
 * The service-role password is never read or printed — only a placeholder
 * pointing at the Supabase dashboard, so the output is always safe to share.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildPowerbiConnection,
  parseDotEnv,
  renderPowerbiConnSummary,
} from "../lib/powerbi-conn";

const ENV_PATH = path.join(__dirname, "..", ".env");

function main(): void {
  const fileEnv = fs.existsSync(ENV_PATH)
    ? parseDotEnv(fs.readFileSync(ENV_PATH, "utf8"))
    : {};
  // .env wins over the ambient shell, matching how Expo inlines it at build time.
  const env = { ...process.env, ...fileEnv };
  if (!fs.existsSync(ENV_PATH)) {
    console.log(
      "print-powerbi-conn: no .env found at the repo root — falling back to the exported environment.\n",
    );
  }
  console.log(renderPowerbiConnSummary(buildPowerbiConnection(env)));
}

main();
