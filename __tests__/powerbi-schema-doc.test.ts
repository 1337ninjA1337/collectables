import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
} from "../lib/analytics-events";
import {
  POWERBI_SCHEMA_BEGIN,
  POWERBI_SCHEMA_END,
  escapeTableCell,
  injectPowerbiSchemaBlock,
  renderPowerbiSchemaBlock,
  renderPowerbiSchemaTable,
} from "../lib/powerbi-schema-doc";
import { LINT_GUARDS } from "../lib/lint-guards";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("renderPowerbiSchemaTable", () => {
  const table = renderPowerbiSchemaTable();

  it("emits one row per event in the taxonomy", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      assert.ok(
        table.includes(`| \`${name}\` |`),
        `missing row for event "${name}"`,
      );
    }
    const rowCount = table
      .split("\n")
      .filter((line) => line.startsWith("| `")).length;
    assert.equal(rowCount, ANALYTICS_EVENT_NAMES.length);
  });

  it("lists every property key of every event", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const row = table
        .split("\n")
        .find((line) => line.startsWith(`| \`${name}\` |`));
      assert.ok(row, `missing row for "${name}"`);
      for (const prop of ANALYTICS_EVENTS[name].props) {
        assert.ok(
          row.includes(`\`${prop}\``),
          `row for "${name}" missing prop "${prop}"`,
        );
      }
    }
  });

  it("orders rows by sorted event name so output is deterministic", () => {
    const rowNames = table
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("`")[1]);
    assert.deepEqual(rowNames, [...ANALYTICS_EVENT_NAMES]);
  });

  it("keeps every row a single table line (no raw pipes or newlines from descriptions)", () => {
    for (const line of table.split("\n").slice(2)) {
      // 4 unescaped pipes = 3 cells exactly.
      const unescapedPipes = line.match(/(?<!\\)\|/g) ?? [];
      assert.equal(unescapedPipes.length, 4, `malformed row: ${line}`);
    }
  });
});

describe("escapeTableCell", () => {
  it("escapes pipes and flattens newlines", () => {
    assert.equal(escapeTableCell("a | b"), "a \\| b");
    assert.equal(escapeTableCell("a\nb"), "a b");
    assert.equal(escapeTableCell("a\r\nb"), "a b");
  });
});

describe("injectPowerbiSchemaBlock", () => {
  it("replaces the marker-delimited block, preserving surroundings", () => {
    const doc = `before\n${POWERBI_SCHEMA_BEGIN}\nstale\n${POWERBI_SCHEMA_END}\nafter\n`;
    const out = injectPowerbiSchemaBlock(doc);
    assert.equal(out, `before\n${renderPowerbiSchemaBlock()}\nafter\n`);
    assert.ok(!out.includes("stale"));
  });

  it("is idempotent", () => {
    const doc = `x\n${POWERBI_SCHEMA_BEGIN}\n${POWERBI_SCHEMA_END}\ny\n`;
    const once = injectPowerbiSchemaBlock(doc);
    assert.equal(injectPowerbiSchemaBlock(once), once);
  });

  it("throws when the markers are missing", () => {
    assert.throws(
      () => injectPowerbiSchemaBlock("no markers here"),
      /marker pair not found/,
    );
  });
});

describe("docs/powerbi-connection.md", () => {
  const doc = read("docs/powerbi-connection.md");

  it("carries the marker pair", () => {
    assert.ok(doc.includes(POWERBI_SCHEMA_BEGIN));
    assert.ok(doc.includes(POWERBI_SCHEMA_END));
  });

  it("is in sync with lib/analytics-events.ts (run `npm run powerbi:schema-doc` if this fails)", () => {
    assert.equal(injectPowerbiSchemaBlock(doc), doc);
  });

  it("the lint:all registry wires the --check mode so drift fails CI", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(
      pkg.scripts["lint:powerbi-doc"],
      "tsx scripts/generate-powerbi-schema-doc.ts --check",
    );
    // Registry membership means lint:ci and the ci.yml "Code-style guards"
    // step both run the drift check via the lint:all aggregator (wiring
    // pinned in lint-guards.test.ts).
    const guard = LINT_GUARDS.find((g) => g.npmScript === "lint:powerbi-doc");
    assert.ok(guard, "lint:powerbi-doc must be a LINT_GUARDS entry");
    assert.deepEqual(guard.args, ["--check"]);
    assert.equal(
      pkg.scripts["powerbi:schema-doc"],
      "tsx scripts/generate-powerbi-schema-doc.ts",
    );
  });
});
