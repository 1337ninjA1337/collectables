import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectionTemplates } from "@/data/collection-templates";

describe("collectionTemplates", () => {
  it("contains at least one template", () => {
    assert.ok(collectionTemplates.length > 0);
  });

  it("has unique ids", () => {
    const ids = collectionTemplates.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every template has required fields filled in", () => {
    for (const template of collectionTemplates) {
      assert.ok(template.id, `missing id on ${JSON.stringify(template)}`);
      assert.ok(template.icon, `missing icon on ${template.id}`);
      assert.ok(template.nameKey, `missing nameKey on ${template.id}`);
      assert.ok(template.descriptionKey, `missing descriptionKey on ${template.id}`);
    }
  });

  it("every nameKey and descriptionKey uses the 'template' prefix convention", () => {
    for (const template of collectionTemplates) {
      assert.match(template.nameKey, /^template[A-Z]/);
      assert.match(template.descriptionKey, /^template[A-Z]/);
    }
  });

  it("icons are non-empty emoji-like strings", () => {
    for (const template of collectionTemplates) {
      assert.ok(template.icon.length > 0);
    }
  });
});
