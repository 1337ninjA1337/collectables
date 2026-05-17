import * as fs from "node:fs";
import * as path from "node:path";

import { createPbitBuffer } from "../lib/pbit-template";

const REPO_ROOT = path.join(__dirname, "..");
const OUT_FILE = path.join(REPO_ROOT, "docs", "powerbi", "Collectables-Starter.pbit");

function main(): void {
  const buffer = createPbitBuffer();
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, buffer);
  console.log(
    `[build-powerbi-template] wrote ${path.relative(REPO_ROOT, OUT_FILE)} (${buffer.length} bytes)`,
  );
}

main();
