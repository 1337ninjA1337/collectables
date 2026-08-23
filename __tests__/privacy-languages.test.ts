import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PRIVACY_DEFAULT_LANGUAGE,
  PRIVACY_PAGE_LANGUAGES,
  type PrivacyPageLanguageCode,
} from "@/lib/privacy-languages";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The language leaf, about itself.
 *
 * Its three module-shape cases shipped inside
 * `__tests__/provenance-key-set.test.ts`, because that is the suite the split
 * was done for. Two of them were never about the provenance family: that the
 * leaf has no imports, and that the page renderer reads the same list. A reader
 * deleting this module would not think to look in a key-set suite for what
 * breaks, so those two live here. The sweep over the six askers stayed there,
 * where the askers are.
 *
 * What is new here is the tie between the list and the default. They sat beside
 * each other as a `readonly {code: string}[]` and a bare `"en"` with nothing
 * between them; the annotation on `PRIVACY_DEFAULT_LANGUAGE` is now the tie, and
 * it only holds while the list keeps its literal types — so both halves are
 * pinned, one of them at compile time because that is where it acts.
 */

const CODES = PRIVACY_PAGE_LANGUAGES.map(({ code }) => code);

describe("the default is one of the published languages", () => {
  it("is a member of the list, which is what the annotation claims", () => {
    assert.ok(
      CODES.includes(PRIVACY_DEFAULT_LANGUAGE),
      `PRIVACY_DEFAULT_LANGUAGE is "${PRIVACY_DEFAULT_LANGUAGE}" and PRIVACY_PAGE_LANGUAGES publishes ${CODES.join(", ")} — the default names a page that does not exist, so /privacy/ has no picker entry and PRIVACY_TRANSLATED_LANGUAGES silently grows a sixth member`,
    );
  });

  it("is checked by the compiler, not only by the case above", () => {
    // The runtime case is the readable one and it is the WEAKER one: it fires
    // on a run, and only if something runs it. The annotation fires in
    // `npm run typecheck`, at the moment the wrong word is typed. Deleting
    // `: PrivacyPageLanguageCode` from the declaration is the mutation this
    // asserts against, because with it gone the constant is a bare string again
    // and nothing above compiles differently.
    const source = stripComments(readRepoFile("lib/privacy-languages.ts"));
    assert.match(
      source,
      /export const PRIVACY_DEFAULT_LANGUAGE\s*:\s*PrivacyPageLanguageCode\s*=/,
      "PRIVACY_DEFAULT_LANGUAGE lost its PrivacyPageLanguageCode annotation — the tie to the list is now the runtime case above and nothing else",
    );
  });

  it("keeps its literal codes, without which the annotation proves nothing", () => {
    // `PrivacyPageLanguageCode` is derived from the list. Re-annotating the list
    // `: readonly PrivacyPageLanguage[]` — which is what it said before this
    // change, and the natural thing for a reader to "restore" — widens every
    // code to `string`, collapses the union to `string`, and leaves the
    // annotation above accepting "eng" while still LOOKING like a constraint.
    // That is the failure this pair is built to make impossible, so it is worth
    // a case of its own rather than a comment.
    const source = stripComments(readRepoFile("lib/privacy-languages.ts"));
    assert.match(
      source,
      /export const PRIVACY_PAGE_LANGUAGES\s*=\s*\[[\s\S]*?\]\s*as const satisfies readonly PrivacyPageLanguage\[\]/,
      "PRIVACY_PAGE_LANGUAGES is no longer declared `as const satisfies` — its codes are `string` again, so PrivacyPageLanguageCode is `string` and the default's annotation constrains nothing",
    );
  });
});

describe("the six codes", () => {
  it("are distinct, because everything downstream keys by them", () => {
    assert.equal(
      new Set(CODES).size,
      CODES.length,
      `PRIVACY_PAGE_LANGUAGES has a duplicate code among ${CODES.join(", ")} — the picker would render two entries for one page and the provenance tables would key two baselines to one file`,
    );
  });

  it("are path-safe, because each one is spliced into PRIVACY.md.<code>", () => {
    for (const code of CODES) {
      assert.match(
        code,
        /^[a-z]{2}$/,
        `"${code}" is not a two-letter lowercase code — it is spliced into a repo-relative path (PRIVACY.md.${code}), a URL (/privacy/${code}/) and a git diff comparison`,
      );
    }
  });

  it("each carry a label, because the picker renders it", () => {
    for (const { code, label } of PRIVACY_PAGE_LANGUAGES) {
      assert.ok(
        label.trim().length > 0,
        `"${code}" has no label — the /privacy language picker would render an empty link`,
      );
    }
  });
});

describe("the module the whole provenance family depends on", () => {
  it("is a leaf, so it can never be the module that made a cycle", () => {
    // Two constants and two types. An import here would be an import every
    // provenance module inherits.
    assert.ok(
      !/^\s*import\s/m.test(
        stripComments(readRepoFile("lib/privacy-languages.ts")),
      ),
      "lib/privacy-languages.ts has grown an import — it is depended on by everything and may depend on nothing",
    );
  });

  it("is where the page renderer reads them from too, so there is one list", () => {
    assert.ok(
      stripComments(readRepoFile("lib/privacy-page.ts")).includes(
        'from "./privacy-languages"',
      ),
      "the /privacy page renderer declares its own language list again",
    );
  });
});

/**
 * The half of the tie that does not run.
 *
 * `PrivacyPageLanguageCode` is only a constraint while it is a union of the six
 * literals; the moment the list widens, it becomes `string` and every use of it
 * silently accepts everything. `string extends PrivacyPageLanguageCode` is true
 * exactly in that case, so this fails `npm run typecheck` — which `npm test`
 * runs first — rather than any case above.
 *
 * Kept beside the source-text case that asserts the same thing, deliberately:
 * the text case names the mutation in a sentence a reader gets from a test run,
 * and this one cannot be fooled by a formatting change the regex did not expect.
 */
type CodeUnionHasWidened = string extends PrivacyPageLanguageCode ? true : false;
const CODE_UNION_HAS_WIDENED: CodeUnionHasWidened = false;

describe("the code union", () => {
  it("has not widened to string", () => {
    assert.equal(
      CODE_UNION_HAS_WIDENED,
      false,
      "unreachable at runtime — this claim is enforced by tsc on the declaration above; the case exists so the suite lists it",
    );
  });

  it("names exactly the codes the list publishes", () => {
    // The union is derived, so this cannot drift — which is the point of
    // asserting it: it is the sentence the reader wants and the compiler
    // already guarantees, and it goes red if somebody hand-writes the union.
    const fromUnion: readonly PrivacyPageLanguageCode[] = [
      "en",
      "ru",
      "be",
      "pl",
      "de",
      "es",
    ];
    assert.deepEqual([...fromUnion].sort(), [...CODES].sort());
  });
});
