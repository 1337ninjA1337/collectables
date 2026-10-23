/**
 * Printing a collection, which is the half of the export that needs a device.
 *
 * The document itself is `lib/export-pdf-html.ts` — pure, and tested. What is
 * left here is the two things a node suite cannot run: the print engine and the
 * share sheet, plus the web branch that hands the same HTML to a popup.
 */

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import {
  buildCollectionExportHtml,
  type ExportLabels,
  type ExportMoney,
} from "@/lib/export-pdf-html";
import { printInPopup } from "@/lib/print-popup";
import { CollectableItem, Collection } from "@/lib/types";

export type { ExportLabels, ExportMoney };

/**
 * What happened, for the toast at the call site.
 *
 * `"popup-blocked"` is not a thrown error because it is not a failure of this
 * app: the document was built, and the browser declined to open the window to
 * show it. The call site's `catch` says "could not generate PDF", which would
 * be a true sentence and the wrong advice — the user has to allow the pop-up,
 * and nothing was going to tell them that. It returned `void` and ran into
 * `toast.success` before this.
 */
export type ExportOutcome = "done" | "popup-blocked";

export async function exportCollectionToPdf(
  collection: Collection,
  items: CollectableItem[],
  labels: ExportLabels,
  money: ExportMoney,
): Promise<ExportOutcome> {
  const html = buildCollectionExportHtml(collection, items, labels, money);

  if (Platform.OS === "web") {
    // `window.open` bound, because `printInPopup` calls it as a plain function
    // and a browser rejects an unbound `open` with an illegal-invocation error.
    return printInPopup(html, (url, target) => window.open(url, target)) ? "done" : "popup-blocked";
  }

  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
  return "done";
}
