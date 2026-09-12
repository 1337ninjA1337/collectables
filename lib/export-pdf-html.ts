/**
 * The print document a collection export becomes, as a pure function.
 *
 * WHY IT IS ITS OWN MODULE. `lib/export-pdf.ts` imports `expo-print`,
 * `expo-sharing` and `react-native`, so a node suite cannot load it — and the
 * half worth testing is not the printing. It is the document: HTML escaping of
 * user text, the totals in the header, and which fields an item contributes.
 * That half had no suite at all, and the reason was reachability rather than
 * anybody deciding it did not need one.
 *
 * The split mirrors `lib/spa-fallback.ts` + `scripts/build-spa-fallback.ts` and
 * `lib/powerbi-template.ts`, which say the same thing about the same problem:
 * the pure half goes where a test can reach it, the IO stays with its peers.
 *
 * INLINE HEX IS DELIBERATE HERE, as it is in `lib/privacy-page.ts`: this is a
 * standalone document rendered by a print engine that cannot import the app's
 * design tokens. `lib/check-inline-hex.ts` exempts this module by name and says
 * so; the exemption moved here with the CSS.
 */

import type { CollectionTotalCost } from "@/lib/collection-total";
import { CollectableItem, Collection } from "@/lib/types";
import { formatCostAmount, hasFiniteCost, type ConvertedItemCost } from "@/lib/item-cost";

/**
 * The money in the document, resolved by the caller against the live rate
 * table — the same two answers the collection screen is already rendering.
 *
 * **Why the caller resolves it and not this module.** The conversion needs the
 * USD rate table, which lives in the collections provider behind a fetch and a
 * cache; taking it as an argument would make this module's signature about
 * where rates come from instead of about the document. Taking the ANSWERS
 * keeps the document pure and gets something better than consistency-by-luck:
 * the PDF prints the figures the screen printed, because they are the same
 * values.
 *
 * The export used to do its own arithmetic — `items.reduce((sum, item) => sum
 * + item.cost)` — which converted nothing and labelled nothing, so a
 * collection holding items in EUR and USD filed one figure in no unit at all,
 * and a per-collection `currency` override reached every screen in the app and
 * not the one artifact a user keeps.
 */
export type ExportMoney = {
  /**
   * The collection's total, already converted into the currency the collection
   * is labelled in — `getCollectionTotalCost(collection.id)`.
   */
  total: CollectionTotalCost;
  /**
   * One item's cost in that same currency — `convertItemCost(item,
   * collection.currency)`, which is what `<CostBadge>` renders on the card.
   */
  itemCost: (item: CollectableItem) => ConvertedItemCost;
};

/** The translated words the document prints, resolved by the caller's `t()`. */
export type ExportLabels = {
  acquiredHow: string;
  acquiredDate: string;
  description: string;
  variants: string;
  costLabel: string;
  totalCost: string;
  exportPdfItemCount: string;
  photosSaved: string;
  /**
   * Printed under the total when it does not mean what it appears to mean —
   * some items had no rate, or there was no rate table at all.
   *
   * The caller resolves which sentence it is, because the counted one needs a
   * number and this module takes strings. Empty when the total is exact,
   * which is the ordinary case and prints nothing.
   */
  totalCostCaveat: string;
};

/**
 * The four characters that would otherwise change the document's structure.
 *
 * `'` is absent on purpose: every attribute in this template is double-quoted,
 * so a single quote inside one is data, and in text content it is data too. The
 * property that matters is that no user string can end an attribute or open a
 * tag, and `export-pdf-html.test.ts` asserts that rather than this list.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One item's cost cell: the converted amount, its currency, and an `≈` when a
 * real conversion happened.
 *
 * The `≈` is emitted here rather than taken as a label because every one of
 * the six locales spells `itemValueApprox` as exactly `≈ ${amount}
 * ${currency}` — the marker is a symbol, not a word — and
 * `export-pdf-money.test.ts` pins that equivalence rather than trusting this
 * sentence. What it marks is worth marking in a document somebody files: a
 * figure derived from a rate table on the day it was printed is not the price
 * that was paid.
 *
 * A `null` amount cannot reach here (the caller gates on `hasFiniteCost`), and
 * the `?? item.cost` fallback is what makes that a property of the code rather
 * than of the call order.
 */
function formatItemCost(
  item: CollectableItem & { cost: number },
  money: ExportMoney,
): string {
  const converted = money.itemCost(item);
  const amount = converted.amount ?? item.cost;
  const approx =
    converted.converted &&
    item.costCurrency != null &&
    item.costCurrency !== converted.currency;
  return `${approx ? "≈ " : ""}${formatCostAmount(amount)} ${converted.currency}`;
}

/**
 * The whole document for one collection.
 *
 * `printedOn` is a parameter rather than a `new Date()` inside, because a
 * function that reads the clock cannot be asserted against a fixed string —
 * the footer used to make this module's output different on every call.
 */
export function buildCollectionExportHtml(
  collection: Collection,
  items: CollectableItem[],
  labels: ExportLabels,
  money: ExportMoney,
  printedOn: Date = new Date(),
): string {
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
      if (hasFiniteCost(item)) {
        // `${item.cost}` before this: a bare number, in no currency, and
        // unformatted — so a 1500-euro item printed "1500" beside a
        // 1500-dollar one and the document could not tell them apart.
        fields.push(`<div class="field"><span class="field-label">${escapeHtml(labels.costLabel)}</span><span>${escapeHtml(formatItemCost(item, money))}</span></div>`);
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
  .stat-caveat { font-size: 11px; color: #8f6947; margin-top: 4px; max-width: 240px; line-height: 1.4; }
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
      ${money.total.amount > 0 ? `
      <div class="stat">
        <div class="stat-value">${escapeHtml(`${formatCostAmount(money.total.amount)} ${money.total.currency}`)}</div>
        <div class="stat-label">${escapeHtml(labels.totalCost)}</div>
        ${labels.totalCostCaveat ? `<div class="stat-caveat">${escapeHtml(labels.totalCostCaveat)}</div>` : ""}
      </div>` : ""}
    </div>
  </div>
  ${itemsHtml}
  <div class="footer">Collectables — ${printedOn.toLocaleDateString()}</div>
</body>
</html>`;
}
