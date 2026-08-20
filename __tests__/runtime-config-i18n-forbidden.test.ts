import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { localeKeys } from "@/lib/i18n-source";

import { locales } from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * The runtime Supabase-config form has no translation strings, and stays that
 * way.
 *
 * `CLAUDE.md`'s standing instruction is to NEVER add the "configured by you in
 * this browser" badge and "Clear runtime credentials" button next to a runtime
 * Supabase config form. Nine `runtimeConfig*` keys — the form's title, its
 * URL/key labels and placeholders, the save button, the badge and the clear
 * button — were declared in `en` and `ru` for a form that no screen ever
 * rendered, so nothing but the source could show they existed. They were
 * removed; this pins the absence at the i18n layer, so re-adding the form's
 * copy (the first thing a reintroduction needs) turns a named case red rather
 * than sliding back in under a translation pass. Enforcing it here, on the
 * strings, means the prohibition is guarded even before any component wires
 * them up.
 */
describe("runtime Supabase-config form — its i18n keys stay deleted", () => {
  const src = readI18nSource();

  for (const language of locales(src)) {
    it(`${language} declares no runtimeConfig* key`, () => {
      const offenders = [...localeKeys(src, language)].filter((key) =>
        key.startsWith("runtimeConfig"),
      );
      assert.deepEqual(
        offenders,
        [],
        `${language} declares ${offenders.join(", ")} — the runtime Supabase ` +
          `config form is forbidden by CLAUDE.md; its strings were removed as ` +
          `dead copy and must not return`,
      );
    });
  }
});
