import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { I18N_REGISTRY_SOURCE } from "../lib/i18n-source-files";
import {
  EAGER_LOCALES,
  __resetLoadedLocalesForTests,
  baseLocale,
  isLocaleLoaded,
  loadLocale,
  loadedLocale,
} from "../lib/i18n/registry";
import { locales } from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Which locales a page load pays for, and how the rest arrive.
 *
 * 208 KiB of the web bundle was copy nobody in the session would read: all six
 * maps in the entry chunk, one of them rendered. `en` and `ru` stay — `ru` is
 * what the provider starts in and `en` is the fallback every key falls back to
 * — and the other four are fetched when somebody picks them.
 *
 * The loader is a module rather than provider state precisely so these
 * questions can be asked without mounting anything.
 */

const SOURCE = readRepoFile(I18N_REGISTRY_SOURCE);
const LAZY = locales(readI18nSource()).filter(
  (code) => !EAGER_LOCALES.includes(code as never),
);

beforeEach(() => {
  __resetLoadedLocalesForTests();
});

describe("what the page load pays for", () => {
  it("is en and ru, and nothing else", () => {
    assert.deepEqual([...EAGER_LOCALES].sort(), ["en", "ru"]);
  });

  it("has the eager pair in memory before anything is fetched", () => {
    for (const code of EAGER_LOCALES) {
      assert.ok(isLocaleLoaded(code), `${code} must not need a fetch`);
      assert.ok((loadedLocale(code)?.itemsCount ?? null) !== null);
    }
  });

  it("leaves the other four unloaded until asked", () => {
    assert.ok(LAZY.length > 0, "the split stopped splitting anything");
    for (const code of LAZY) {
      assert.equal(isLocaleLoaded(code as never), false, `${code} is eager again`);
      assert.equal(loadedLocale(code as never), null);
    }
  });

  it("keeps en as the fallback map, whatever is loaded", () => {
    // `t()` reads this for a key the chosen locale does not declare, so it has
    // to be a map rather than a promise of one.
    assert.equal(baseLocale, loadedLocale("en"));
    assert.equal(typeof baseLocale.authTitle, "string");
  });
});

describe("fetching a lazy locale", () => {
  it("resolves its map and caches it", async () => {
    const map = await loadLocale("pl");

    assert.ok(map, "the Polish chunk did not resolve");
    assert.ok(isLocaleLoaded("pl"));
    assert.equal(loadedLocale("pl"), map);
    assert.equal(typeof map.authTitle, "string");
  });

  it("answers an already-loaded locale without a fetch", async () => {
    const first = await loadLocale("de");
    const second = await loadLocale("de");
    assert.equal(first, second);
  });

  it("shares one request between callers that ask at once", async () => {
    // The mount path and a language picker can both ask in the same tick; two
    // chunk requests for one file is the shape that has to not happen.
    const [a, b] = await Promise.all([loadLocale("es"), loadLocale("es")]);
    assert.equal(a, b);
  });

  it("hands back the eager maps without going near a loader", async () => {
    assert.equal(await loadLocale("ru"), loadedLocale("ru"));
    assert.equal(await loadLocale("en"), baseLocale);
  });

  it("carries the same keys as the map it replaced", async () => {
    // The split is a move, not an edit: a lazy map missing keys would render
    // English in the middle of a Polish screen.
    const pl = await loadLocale("pl");
    const missing = Object.keys(baseLocale).filter((key) => !(key in (pl ?? {})));
    assert.deepEqual(missing, []);
  });
});

describe("the loader record itself", () => {
  it("writes a literal specifier per locale, which is what makes the chunks", () => {
    // A computed `import(`./${code}`)` either bundles every locale back into
    // one chunk or resolves nothing — Metro decides that statically.
    for (const code of LAZY) {
      assert.ok(
        SOURCE.includes(`${code}: async () => (await import("./${code}")).${code}`),
        `${code} must be its own literal import()`,
      );
    }
    assert.ok(!/import\(`/.test(SOURCE), "a template specifier bundles or resolves nothing");
  });

  it("never rejects, because its callers are in a render path", () => {
    assert.match(SOURCE, /\.catch\(\(error: unknown\) => \{/);
    assert.match(SOURCE, /captureException\(error, \{ scope: "i18n\.loadLocale" \}\)/);
  });

  it("clears the in-flight entry either way, so a failure is retryable", () => {
    // The usual cause of a failed chunk fetch is a network that comes back; a
    // rejected promise left in the map would make the first failure permanent.
    assert.match(SOURCE, /\.finally\(\(\) => \{[\s\S]*inflight\.delete\(language\);/);
  });
});
