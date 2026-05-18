// Generates docs/powerbi/Collectables-Starter.pbit from the 15a text
// sources (queries.m + measures.dax). Run via `npm run build:powerbi`.
//
// CI has no Power BI Desktop to open the binary, so the committed .pbit
// must be smoke-tested by a human once (see MANUAL-TASKS.md). The text
// sources remain the verifiable single source of truth.

import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "../lib/powerbi-template";

const REPO_ROOT = path.join(__dirname, "..");
const POWERBI_DIR = path.join(REPO_ROOT, "docs", "powerbi");
const QUERIES_M = path.join(POWERBI_DIR, "queries.m");
const MEASURES_DAX = path.join(POWERBI_DIR, "measures.dax");
const OUT_PBIT = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

function main(): void {
  for (const file of [QUERIES_M, MEASURES_DAX]) {
    if (!fs.existsSync(file)) {
      console.error(`[build-powerbi-template] missing source: ${file}`);
      process.exit(1);
    }
  }
  const pbit = buildPbit({
    queriesM: fs.readFileSync(QUERIES_M, "utf8"),
    measuresDax: fs.readFileSync(MEASURES_DAX, "utf8"),
  });
  fs.writeFileSync(OUT_PBIT, pbit);
  console.log(
    `[build-powerbi-template] wrote docs/powerbi/Collectables-Starter.pbit (${pbit.length} bytes)`,
  );
}

main();
