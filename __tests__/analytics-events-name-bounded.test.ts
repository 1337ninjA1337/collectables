import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ANALYTICS_EVENT_NAMES } from "../lib/analytics-events";

/**
 * The analytics_events migration enforces `CHECK (length(name) > 0 AND
 * length(name) <= 200)` server-side; a client event name that violated it
 * would 207 out of the analytics-mirror webhook and silently vanish from the
 * long-tail store. This suite makes the contract explicit on the typed union
 * so a too-long (or accidentally empty) name fails in `npm test`, not in prod.
 */

// Keep in lock-step with 20260508_analytics_events.sql.
const NAME_CAP = 200;

describe("analytics event names fit the DB CHECK bound", () => {
  it("the migration still declares the expected cap (lock-step guard)", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase",
        "migrations",
        "20260508_analytics_events.sql",
      ),
      "utf8",
    );
    assert.match(
      migration,
      new RegExp(
        `CHECK\\s*\\(length\\(name\\)\\s*>\\s*0\\s*AND\\s*length\\(name\\)\\s*<=\\s*${NAME_CAP}\\)`,
      ),
      "analytics_events name CHECK changed — update NAME_CAP in this test to match",
    );
  });

  it("every emitted event name is non-empty and within the cap", () => {
    assert.ok(ANALYTICS_EVENT_NAMES.length > 0, "event union is non-empty");
    for (const name of ANALYTICS_EVENT_NAMES) {
      assert.ok(name.length > 0, `event name is empty`);
      assert.ok(
        name.length <= NAME_CAP,
        `event name '${name}' is ${name.length} chars — exceeds the DB CHECK cap of ${NAME_CAP}`,
      );
    }
  });

  it("event names contain no characters the CHECK's length() would miscount", () => {
    // Postgres length() counts characters, JS .length counts UTF-16 code
    // units; they agree only while names stay ASCII. Pin ASCII snake_case so
    // the two measures can never diverge.
    for (const name of ANALYTICS_EVENT_NAMES) {
      assert.match(
        name,
        /^[a-z0-9_]+$/,
        `event name '${name}' is not ASCII snake_case`,
      );
    }
  });
});
