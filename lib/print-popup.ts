/**
 * Handing a document to the browser's print dialog, and noticing when the
 * browser refused to take it.
 *
 * ## The failure this exists for
 *
 * The web export is `window.open("", "_blank")`, a `document.write` and a
 * `print()`. A pop-up blocker makes the first of those return `null` — and the
 * code returned there, silently, straight into the call site's
 * `toast.success(t("exportPdfDone"))`. So the user tapped "export to PDF",
 * watched the spinner stop, was told the PDF was ready, and got nothing. On
 * the one platform this repository actually ships, with the commonest browser
 * setting there is.
 *
 * Reporting it needs the outcome to travel, which is what {@link printInPopup}
 * returns. `lib/export-pdf.ts` cannot be loaded by a node suite — it imports
 * `expo-print`, `expo-sharing` and `react-native` — so the half with the
 * decision in it lives here, where it has cases, for the same reason
 * `lib/export-pdf-html.ts` holds the document.
 *
 * ## `open` is a parameter
 *
 * Not for the test's convenience: `window` is a global the static export does
 * not have, and a module that reached for it at the top level would throw on
 * import in a prerender pass. The caller passes the opener it has
 * (`window.open`, bound), and a caller with no window passes nothing it cannot
 * supply.
 */

/** The part of a popup window this module uses, and nothing more. */
export type PrintWindow = {
  readonly document: {
    write: (html: string) => void;
    close: () => void;
  };
  print: () => void;
};

/** `window.open`, narrowed to the one call shape this module makes. */
export type PopupOpener = (url: string, target: string) => PrintWindow | null | undefined;

/**
 * Write `html` into a new window and ask it to print. Returns `false` when the
 * browser would not give us the window, which is the answer the UI needs: the
 * export did not happen and the user has to be told why.
 *
 * A blocker can REFUSE in two ways — `null` from `open`, or a throw from it —
 * and some return a window whose `document` is unreachable (a cross-origin
 * about:blank under a stricter policy), which throws on the `write` instead. All
 * three are one outcome here: nothing was printed. The alternative is an
 * exception crossing `exportCollectionToPdf`, whose only handler at the call
 * site reports "could not generate PDF" — true but unhelpful, because the
 * document generated fine and the browser declined to show it.
 */
export function printInPopup(html: string, open: PopupOpener): boolean {
  let popup: PrintWindow | null | undefined;
  try {
    popup = open("", "_blank");
  } catch {
    return false;
  }
  if (!popup) return false;

  try {
    popup.document.write(html);
    popup.document.close();
    popup.print();
  } catch {
    return false;
  }
  return true;
}
