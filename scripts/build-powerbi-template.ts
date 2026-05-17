import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "../lib/powerbi-template";

// Glue only — all logic lives in lib/powerbi-template.ts so it stays
// unit-testable without Power BI Desktop. Writes the committed binary
// template the user opens to get DAU + the listing funnel out of the box.

const REPO_ROOT = path.join(__dirname, "..");
const OUT = path.join(REPO_ROOT, "docs", "powerbi", "Collectables-Starter.pbit");

function main(): void {
  const bytes = buildPbit();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log(
    `[build-powerbi-template] wrote ${path.relative(REPO_ROOT, OUT)} (${bytes.length} bytes)`,
  );
}

main();
