import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "../lib/powerbi-template";

const REPO_ROOT = path.join(__dirname, "..");
const POWERBI_DIR = path.join(REPO_ROOT, "docs", "powerbi");
const MEASURES = path.join(POWERBI_DIR, "measures.dax");
const QUERIES = path.join(POWERBI_DIR, "queries.m");
const OUT = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

function main(): void {
  for (const src of [MEASURES, QUERIES]) {
    if (!fs.existsSync(src)) {
      console.error(`[build-powerbi-template] missing source asset: ${src}`);
      process.exit(1);
    }
  }

  const { buffer, parts } = buildPbit({
    measuresDax: fs.readFileSync(MEASURES, "utf8"),
    queriesM: fs.readFileSync(QUERIES, "utf8"),
  });

  const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT) : null;
  if (previous && previous.equals(buffer)) {
    console.log(
      `[build-powerbi-template] ${path.relative(REPO_ROOT, OUT)} already up to date — skipping`,
    );
    return;
  }

  fs.writeFileSync(OUT, buffer);
  console.log(
    `[build-powerbi-template] wrote ${path.relative(REPO_ROOT, OUT)} ` +
      `(${buffer.length} bytes, ${Object.keys(parts).length} OPC parts)`,
  );
}

main();
