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

import { buildCollectionExportHtml, type ExportLabels } from "@/lib/export-pdf-html";
import { CollectableItem, Collection } from "@/lib/types";

export type { ExportLabels };

export async function exportCollectionToPdf(
  collection: Collection,
  items: CollectableItem[],
  labels: ExportLabels,
): Promise<void> {
  const html = buildCollectionExportHtml(collection, items, labels);

  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.print();
    }
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
}
