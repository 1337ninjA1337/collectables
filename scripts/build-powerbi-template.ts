import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "../lib/pbit-template";

const REPO_ROOT = path.join(__dirname, "..");
const POWERBI_DIR = path.join(REPO_ROOT, "docs", "powerbi");
const MEASURES_DAX = path.join(POWERBI_DIR, "measures.dax");
const QUERIES_M = path.join(POWERBI_DIR, "queries.m");
const OUT_FILE = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

function main(): void {
  const measuresDax = fs.readFileSync(MEASURES_DAX, "utf8");
  const queriesM = fs.readFileSync(QUERIES_M, "utf8");
  const bytes = buildPbit({ measuresDax, queriesM });
  fs.writeFileSync(OUT_FILE, bytes);
  console.log(
    `[build-powerbi-template] wrote ${path.relative(REPO_ROOT, OUT_FILE)} (${bytes.length} bytes)`,
  );
}

main();
