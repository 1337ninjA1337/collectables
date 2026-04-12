import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { CollectableItem, Collection } from "@/lib/types";

type ExportLabels = {
  acquiredHow: string;
  acquiredDate: string;
  description: string;
  variants: string;
  costLabel: string;
  totalCost: string;
  exportPdfItemCount: string;
  photosSaved: string;
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(collection: Collection, items: CollectableItem[], labels: ExportLabels): string {
  const totalCost = items.reduce(
    (sum, item) => sum + (typeof item.cost === "number" ? item.cost : 0),
    0,
  );
  const totalPhotos = items.reduce((sum, item) => sum + item.photos.length, 0);

  const itemsHtml = items
    .map((item) => {
      const photosHtml = item.photos
        .map(
          (photo) =>
            `<img src="${escapeHtml(photo)}" style="width:180px;height:180px;object-fit:cover;border-radius:12px;" />`,
        )
        .join("");

      const fields: string[] = [];
      if (item.acquiredFrom) {
        fields.push(`<div class="field"><span class="field-label">${escapeHtml(labels.acquiredHow)}</span><span>${escapeHtml(item.acquiredFrom)}</span></div>`);
      }
      if (item.acquiredAt) {
        fields.push(`<div class="field"><span class="field-label">${escapeHtml(labels.acquiredDate)}</span><span>${escapeHtml(item.acquiredAt)}</span></div>`);
      }
      if (item.description) {
        fields.push(`<div class="field"><span class="field-label">${escapeHtml(labels.description)}</span><span>${escapeHtml(item.description)}</span></div>`);
      }
      if (item.variants) {
        fields.push(`<div class="field"><span class="field-label">${escapeHtml(labels.variants)}</span><span>${escapeHtml(item.variants)}</span></div>`);
      }
      if (typeof item.cost === "number") {
        fields.push(`<div class="field"><span class="field-label">${escapeHtml(labels.costLabel)}</span><span>${item.cost}</span></div>`);
      }

      return `
        <div class="item">
          <h2>${escapeHtml(item.title)}</h2>
          ${photosHtml ? `<div class="photos">${photosHtml}</div>` : ""}
          ${fields.join("\n")}
        </div>
      `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #2f2318; padding: 32px; background: #fff; }
  .header { margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #eadbc8; }
  .header h1 { font-size: 28px; color: #261b14; margin-bottom: 6px; }
  .header p { color: #6b5647; font-size: 14px; line-height: 1.5; }
  .stats { display: flex; gap: 24px; margin-top: 12px; }
  .stat { background: #fffaf3; border: 1px solid #eadbc8; border-radius: 12px; padding: 12px 16px; }
  .stat-value { font-size: 22px; font-weight: 800; color: #261b14; }
  .stat-label { font-size: 12px; color: #8f6947; text-transform: uppercase; letter-spacing: 0.5px; }
  .item { page-break-inside: avoid; border: 1px solid #eadbc8; border-radius: 16px; padding: 20px; margin-bottom: 20px; background: #fffaf3; }
  .item h2 { font-size: 20px; color: #261b14; margin-bottom: 12px; }
  .photos { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .field { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f0e4d0; font-size: 14px; }
  .field-label { color: #8f6947; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; min-width: 100px; padding-top: 2px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eadbc8; color: #9b8571; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(collection.name)}</h1>
    <p>${escapeHtml(collection.description)}</p>
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${items.length}</div>
        <div class="stat-label">${escapeHtml(labels.exportPdfItemCount)}</div>
      </div>
      <div class="stat">
        <div class="stat-value">${totalPhotos}</div>
        <div class="stat-label">${escapeHtml(labels.photosSaved)}</div>
      </div>
      ${totalCost > 0 ? `
      <div class="stat">
        <div class="stat-value">${totalCost}</div>
        <div class="stat-label">${escapeHtml(labels.totalCost)}</div>
      </div>` : ""}
    </div>
  </div>
  ${itemsHtml}
  <div class="footer">Collectables — ${new Date().toLocaleDateString()}</div>
</body>
</html>`;
}

export async function exportCollectionToPdf(
  collection: Collection,
  items: CollectableItem[],
  labels: ExportLabels,
): Promise<void> {
  const html = buildHtml(collection, items, labels);

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
