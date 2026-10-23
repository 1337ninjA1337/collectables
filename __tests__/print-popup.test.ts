import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { printInPopup, type PopupOpener, type PrintWindow } from "@/lib/print-popup";
import { readI18nSource } from "./helpers/i18n-source-file";
import { localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The web export's pop-up, and the outcome that had nowhere to go.
 *
 * `exportCollectionToPdf`'s web branch was `window.open("", "_blank")` with an
 * `if (w)` around the write — and a bare `return` when there was no window. The
 * call site then ran `toast.success(t("exportPdfDone"))`, so a user with a
 * pop-up blocker tapped "export to PDF", watched the spinner stop, was told the
 * PDF was ready, and got nothing. That is the commonest browser setting there
 * is, on the one platform this repository actually ships.
 *
 * The cases are about the three ways a browser says no — `null`, a throw from
 * `open`, and a window whose document cannot be written — because they are one
 * outcome for the user and three different shapes in the code.
 */
function fakeWindow(): PrintWindow & { written: string[]; closed: number; printed: number } {
  const written: string[] = [];
  const self = {
    written,
    closed: 0,
    printed: 0,
    document: {
      write: (html: string) => {
        written.push(html);
      },
      close: () => {
        self.closed += 1;
      },
    },
    print: () => {
      self.printed += 1;
    },
  };
  return self;
}

describe("printInPopup", () => {
  it("writes the document, closes it and prints", () => {
    const win = fakeWindow();
    const opened: [string, string][] = [];
    const open: PopupOpener = (url, target) => {
      opened.push([url, target]);
      return win;
    };

    assert.equal(printInPopup("<html>doc</html>", open), true);
    assert.deepEqual(opened, [["", "_blank"]]);
    assert.deepEqual(win.written, ["<html>doc</html>"]);
    assert.equal(win.closed, 1, "an unclosed document never finishes loading");
    assert.equal(win.printed, 1);
  });

  it("reports failure when the browser hands back no window", () => {
    // The blocked pop-up, which is what this function exists to make visible.
    assert.equal(printInPopup("<html></html>", () => null), false);
  });

  it("reports failure when the opener hands back undefined", () => {
    // Some embedders return `undefined` rather than `null`; `!popup` covers
    // both, and a truthiness check is the only reading that does.
    assert.equal(printInPopup("<html></html>", () => undefined), false);
  });

  it("reports failure when opening throws instead of refusing", () => {
    // A blocker is allowed to throw, and an exception here would cross
    // `exportCollectionToPdf` into a `catch` that says "could not generate
    // PDF" — true, and the wrong advice, because the document was fine.
    assert.equal(
      printInPopup("<html></html>", () => {
        throw new Error("blocked by policy");
      }),
      false,
    );
  });

  it("reports failure when the window opens but its document cannot be written", () => {
    // A stricter policy can hand back a window whose `about:blank` document is
    // not reachable, so the refusal arrives on the `write` rather than the
    // `open`. Same outcome: nothing was printed.
    const open: PopupOpener = () => ({
      document: {
        write: () => {
          throw new Error("cross-origin");
        },
        close: () => {},
      },
      print: () => {},
    });

    assert.equal(printInPopup("<html></html>", open), false);
  });

  it("reports failure when print() throws after a successful write", () => {
    // Nothing reached the user, so nothing is reported as having.
    const open: PopupOpener = () => ({
      document: { write: () => {}, close: () => {} },
      print: () => {
        throw new Error("no print dialog");
      },
    });

    assert.equal(printInPopup("<html></html>", open), false);
  });

  it("asks for a blank window rather than a URL", () => {
    // The document is written in, not fetched: a URL here would be a navigation
    // the blocker is even more likely to stop, and there is nothing to fetch.
    const opened: string[] = [];
    printInPopup("<html></html>", (url) => {
      opened.push(url);
      return fakeWindow();
    });
    assert.deepEqual(opened, [""]);
  });
});

describe("the outcome reaches the user", () => {
  const EXPORT = stripComments(readRepoFile("lib/export-pdf.ts"));
  const SCREEN = stripComments(readRepoFile("app/collection/[id].tsx"));

  it("returns an outcome rather than void", () => {
    assert.match(EXPORT, /export type ExportOutcome = "done" \| "popup-blocked";/);
    assert.match(EXPORT, /\): Promise<ExportOutcome> \{/);
  });

  it("maps a refused pop-up to the blocked outcome, and the native path to done", () => {
    assert.match(
      EXPORT,
      /return printInPopup\(html, \(url, target\) => window\.open\(url, target\)\) \? "done" : "popup-blocked";/,
    );
    assert.match(EXPORT, /UTI: "com\.adobe\.pdf",\s*\}\);\s*return "done";/);
  });

  it("binds window.open rather than passing it as a bare reference", () => {
    // A browser rejects an unbound `open` called as a plain function with an
    // illegal-invocation error — which `printInPopup` would catch and report as
    // a blocked pop-up, hiding a bug behind a plausible message.
    assert.ok(
      !/printInPopup\(html, window\.open\)/.test(EXPORT),
      "an unbound window.open would throw on every export",
    );
  });

  it("tells the user to allow the pop-up instead of saying the PDF is ready", () => {
    assert.match(SCREEN, /if \(outcome === "popup-blocked"\) \{\s*toast\.error\(t\("exportPdfPopupBlocked"\)\);/);
    assert.match(SCREEN, /const outcome = await exportCollectionToPdf\(/);
  });

  it("keeps the generic failure for the path that really did fail", () => {
    // The `catch` is still there, and still says "could not generate PDF" —
    // a print engine or a share sheet that rejected is that sentence.
    assert.match(SCREEN, /catch \{\s*toast\.error\(t\("exportPdfFailed"\)\);/);
  });

  it("has the advice in all six locales", () => {
    // `localeValuesOf` asks each map for the key and refuses the locale that
    // does not declare it — which is the honest shape, and the reason there is
    // no `=== 6` here: a count over the whole translations file is the habit
    // `i18n-locales-helper.test.ts` retired, because it passes for six hits in
    // the wrong six places.
    for (const [code, value] of localeValuesOf(readI18nSource(), "exportPdfPopupBlocked")) {
      assert.ok(value.trim().length > 0, `${code} has an empty string for the advice`);
      assert.match(value, /PDF/, `${code} does not name what failed to open`);
    }
  });
});
