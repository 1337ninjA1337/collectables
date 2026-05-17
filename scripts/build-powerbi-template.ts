import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "../lib/powerbi-template";

const REPO_ROOT = path.join(__dirname, "..");
const POWERBI_DIR = path.join(REPO_ROOT, "docs", "powerbi");
const QUERIES_M = path.join(POWERBI_DIR, "queries.m");
const MEASURES_DAX = path.join(POWERBI_DIR, "measures.dax");
const OUTPUT = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

function main(): void {
  for (const file of [QUERIES_M, MEASURES_DAX]) {
    if (!fs.existsSync(file)) {
      console.error(`[build-powerbi-template] missing source asset: ${file}`);
      process.exit(1);
    }
  }
  const queriesM = fs.readFileSync(QUERIES_M, "utf8");
  const measuresDax = fs.readFileSync(MEASURES_DAX, "utf8");
  const pbit = buildPbit({ queriesM, measuresDax });
  fs.writeFileSync(OUTPUT, pbit);
  console.log(
    `[build-powerbi-template] wrote ${path.relative(REPO_ROOT, OUTPUT)} (${pbit.length} bytes)`,
  );
}

main();
