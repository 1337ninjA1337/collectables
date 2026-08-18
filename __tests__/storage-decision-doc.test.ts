import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import { readRepoFile, repoPath } from "./helpers/repo-file";

const DOC = "docs/storage-decision.md";

describe("docs/storage-decision.md (BE-24) decision record", () => {
  it("file exists at the canonical path", () => {
    assert.ok(
      existsSync(repoPath(DOC)),
      "docs/storage-decision.md must be checked into the repo so the BE-24 storage decision is auditable",
    );
  });

  it("records the chosen option: keep Cloudinary with a signed upload path", () => {
    const src = readRepoFile(DOC);
    assert.match(src, /Cloudinary/, "Doc must name Cloudinary as the chosen backend");
    assert.match(
      src,
      /signed upload/i,
      "Doc must record the signed-upload hardening as the decision",
    );
    assert.match(
      src,
      /option \(a\)/i,
      "Doc must state which BE-24 option (a/b) was chosen",
    );
  });

  it("documents the rejected alternative (Supabase Storage + RLS)", () => {
    const src = readRepoFile(DOC);
    assert.match(src, /Supabase Storage/, "Doc must name the Supabase Storage alternative");
    assert.match(src, /RLS/, "Doc must reference the RLS-mirrored visibility rationale for option (b)");
  });

  it("calls out the residual abuse surface: the unsigned upload preset", () => {
    const src = readRepoFile(DOC);
    assert.match(
      src,
      /unsigned/i,
      "Doc must explain that the unsigned upload preset is the abusable surface being closed",
    );
    assert.match(
      src,
      /CLOUDINARY_API_SECRET/,
      "Doc must reiterate the secret never becomes an EXPO_PUBLIC_* var",
    );
  });

  it("documents the retention / orphan-cleanup story", () => {
    const src = readRepoFile(DOC);
    assert.match(
      src,
      /orphan/i,
      "Doc must document the orphan-cleanup story BE-24 requires",
    );
    assert.match(
      src,
      /delete-image/,
      "Doc must reference the existing signed delete-image Edge Function",
    );
    assert.match(
      src,
      /deleteItem|deleteCollection/,
      "Doc must name the delete handlers that currently leak orphans",
    );
    assert.match(
      src,
      /pg_cron|sweep|reconcil/i,
      "Doc must describe the periodic reconciliation sweep backstop",
    );
  });

  it("records a revisit trigger so the decision is not treated as permanent", () => {
    const src = readRepoFile(DOC);
    assert.match(
      src,
      /revisit/i,
      "Doc must state the condition under which BE-24 should be re-opened",
    );
  });
});
