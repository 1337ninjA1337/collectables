import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ACCESSED_API_TYPES,
  PRIVACY_MANIFEST,
  renderPrivacyInfoPlist,
  renderPrivacyMarkdownTable,
} from "../lib/privacy-manifest";

const guide = readFileSync(
  path.join(process.cwd(), "APPSTORE-SUBMISSION.md"),
  "utf8",
);

describe("privacy manifest declarations", () => {
  it("declares no tracking anywhere", () => {
    for (const entry of PRIVACY_MANIFEST) {
      assert.notEqual(
        entry.usedForTracking,
        "Yes",
        `${entry.dataType} must not be used for tracking`,
      );
      if (entry.apple) {
        assert.equal(
          entry.apple.tracking,
          false,
          `${entry.dataType} apple.tracking must be false`,
        );
      }
    }
  });

  it("gives every collected entry an Apple declaration and vice versa", () => {
    for (const entry of PRIVACY_MANIFEST) {
      if (entry.collected === "**Yes**") {
        assert.ok(
          entry.apple,
          `collected entry '${entry.dataType}' needs an apple declaration`,
        );
        assert.ok(
          entry.apple!.purposes.length > 0,
          `'${entry.dataType}' needs at least one purpose`,
        );
      } else {
        assert.equal(
          entry.apple,
          undefined,
          `non-collected entry '${entry.dataType}' must not emit a plist entry`,
        );
      }
    }
  });

  it("keeps the linked flag consistent between table and plist", () => {
    for (const entry of PRIVACY_MANIFEST) {
      if (!entry.apple) continue;
      assert.equal(
        entry.apple.linked,
        entry.linkedToUser === "Yes",
        `'${entry.dataType}' linked flag must mirror the table column`,
      );
    }
  });
});

describe("Markdown table parity", () => {
  it("APPSTORE-SUBMISSION.md contains the rendered table verbatim", () => {
    const table = renderPrivacyMarkdownTable();
    assert.ok(
      guide.includes(table),
      "APPSTORE-SUBMISSION.md section 6 has drifted from lib/privacy-manifest.ts — run `npm run privacy:generate` and paste the printed table into the guide (or update the module).",
    );
  });

  it("renders one row per manifest entry plus the two header lines", () => {
    const lines = renderPrivacyMarkdownTable().split("\n");
    assert.equal(lines.length, PRIVACY_MANIFEST.length + 2);
    assert.match(lines[0], /^\| Data type \|/);
    assert.match(lines[1], /^\| -+ \|/);
  });
});

describe("PrivacyInfo.xcprivacy parity", () => {
  it("the committed plist matches the rendered plist", () => {
    const committed = readFileSync(
      path.join(process.cwd(), "PrivacyInfo.xcprivacy"),
      "utf8",
    );
    assert.equal(
      committed,
      renderPrivacyInfoPlist(),
      "PrivacyInfo.xcprivacy has drifted from lib/privacy-manifest.ts — run `npm run privacy:generate`.",
    );
  });

  it("emits a valid, no-tracking plist shape", () => {
    const plist = renderPrivacyInfoPlist();
    assert.ok(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(plist.endsWith("</plist>\n"));
    assert.ok(
      plist.includes("<key>NSPrivacyTracking</key>\n\t<false/>"),
      "NSPrivacyTracking must be false",
    );
    assert.ok(
      plist.includes("<key>NSPrivacyTrackingDomains</key>\n\t<array/>"),
      "tracking-domain list must be empty",
    );
    const collectedCount = PRIVACY_MANIFEST.filter((e) => e.apple).length;
    assert.equal(
      plist.match(/<key>NSPrivacyCollectedDataType<\/key>/g)?.length,
      collectedCount,
      "one NSPrivacyCollectedDataType dict per collected entry",
    );
    for (const api of ACCESSED_API_TYPES) {
      assert.ok(
        plist.includes(`<string>${api.type}</string>`),
        `accessed-API declaration for ${api.type}`,
      );
      for (const reason of api.reasons) {
        assert.ok(plist.includes(`<string>${reason}</string>`));
      }
    }
  });

  it("escapes XML-special characters in injected entries", () => {
    const plist = renderPrivacyInfoPlist(
      [
        {
          dataType: "x",
          collected: "**Yes**",
          linkedToUser: "Yes",
          usedForTracking: "No",
          source: "x",
          apple: {
            type: "NSPrivacyCollectedDataTypeUserID",
            linked: true,
            tracking: false,
            purposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
          },
        },
      ],
      [{ type: "a<b>&c", reasons: ["r&1"] }],
    );
    assert.ok(plist.includes("<string>a&lt;b&gt;&amp;c</string>"));
    assert.ok(plist.includes("<string>r&amp;1</string>"));
  });
});

describe("script wiring", () => {
  it("registers privacy:generate in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts["privacy:generate"],
      "tsx scripts/generate-privacy-manifest.ts",
    );
  });
});
