import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";

import {
  ARCHIVE_ENTRY_SEPARATOR,
  ARCHIVE_SCAN_EXTENSIONS,
  BUNDLE_SKIP_DIRS,
  DEFAULT_SECRET_RULES,
  IGNORE_MARKER,
  NOT_SCANNED_EXTENSION_REASONS,
  SECRET_SKIP_DIRS,
  SECRET_SKIP_FILES,
  SECRET_SKIP_FILE_REASONS,
  SOURCE_SCAN_EXTENSIONS,
  UNREAD_NAMES_SHOWN,
  decodeBase64Url,
  formatScanSubject,
  formatSecretReport,
  formatUnreadCandidates,
  isPrivilegedSupabaseJwt,
  redact,
  archiveEntryPath,
  scanArchiveEntries,
  scanForSecrets,
} from "../lib/secret-scan";
import { decodeZipEntryText, readZipEntries } from "../lib/zip-archive";
import { LINT_GUARDS } from "../lib/lint-guards";
import { readRepoFile as read, repoPath, REPO_ROOT } from "./helpers/repo-file";
import { zipFixture } from "./helpers/zip-fixture";
import { listFilesUnder } from "../scripts/guard-io";

const b64url = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");
const SIG = "c2lnbmF0dXJlc2lnbmF0dXJlc2ln";
const makeJwt = (payload: unknown) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.${SIG}`;

const SERVICE_ROLE_JWT = makeJwt({
  iss: "supabase",
  ref: "abcdefghijklmnop",
  role: "service_role",
  iat: 1700000000,
  exp: 2000000000,
});
const ANON_JWT = makeJwt({
  iss: "supabase",
  ref: "abcdefghijklmnop",
  role: "anon",
  iat: 1700000000,
  exp: 2000000000,
});

describe("decodeBase64Url", () => {
  it("decodes a base64url-encoded JSON segment", () => {
    const seg = b64url({ role: "service_role" });
    assert.equal(decodeBase64Url(seg), '{"role":"service_role"}');
  });

  it("never throws on malformed input", () => {
    assert.doesNotThrow(() => decodeBase64Url("!!!not base64!!!"));
  });
});

describe("isPrivilegedSupabaseJwt", () => {
  it("is true for a service_role JWT", () => {
    assert.equal(isPrivilegedSupabaseJwt(SERVICE_ROLE_JWT), true);
  });

  it("is false for the public anon JWT (must ship in the client)", () => {
    assert.equal(isPrivilegedSupabaseJwt(ANON_JWT), false);
  });

  it("is false for a non-JWT string", () => {
    assert.equal(isPrivilegedSupabaseJwt("not.a.jwt"), false);
    assert.equal(isPrivilegedSupabaseJwt("eyJonly-one-segment"), false);
  });
});

describe("scanForSecrets — Supabase JWT discrimination", () => {
  it("flags a service_role JWT", () => {
    const m = scanForSecrets("f.js", `const k = "${SERVICE_ROLE_JWT}";`);
    assert.equal(m.length, 1);
    assert.equal(m[0].ruleId, "supabase-service-role-jwt");
  });

  it("does NOT flag the anon/publishable JWT", () => {
    const m = scanForSecrets("f.js", `const k = "${ANON_JWT}";`);
    assert.deepEqual(m, []);
  });

  it("does NOT flag the `eyJ…` placeholder", () => {
    assert.deepEqual(scanForSecrets("f.tsx", `placeholder: "eyJ…"`), []);
  });
});

describe("scanForSecrets — other rules", () => {
  // Samples are assembled from fragments at runtime so no full vendor token
  // ever appears as a contiguous literal in this file — that keeps GitHub's
  // push-protection scanner (and our own source scan) from flagging the test
  // fixtures, while `scanForSecrets` still sees the joined string.
  const join = (...parts: string[]) => parts.join("");
  const cases: [string, string][] = [
    ["aws-access-key-id", join("AK", "IA", "IOSFODNN7", "EXAMPLE")],
    ["google-api-key", join("AI", "za", "Sy", "A1234567890abcdefghijklmnopqrstuv")],
    ["github-token", join("gh", "p_", "0123456789abcdefghijklmnopqrstuvwxyz12")],
    ["slack-token", join("xo", "xb", "-1234567890-abcdefghijklmnop")],
    ["cloudinary-url", join("cloud", "inary://", "123456789012345:", "abcdefXYZsecret", "@mycloud")],
    ["posthog-personal-key", join("ph", "x_", "0123456789abcdefghijklmnopqrstuvwxyzABCD")],
  ];
  for (const [ruleId, sample] of cases) {
    it(`flags ${ruleId}`, () => {
      const m = scanForSecrets("f.ts", `const v = "${sample}";`);
      assert.equal(m.length, 1, `expected ${ruleId} to match`);
      assert.equal(m[0].ruleId, ruleId);
    });
  }

  it("flags a PEM private key block", () => {
    const m = scanForSecrets(
      "key.pem",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
    );
    assert.equal(m.length, 1);
    assert.equal(m[0].ruleId, "private-key-block");
  });
});

describe("scanForSecrets — no false positives", () => {
  it("does NOT flag the public PostHog ingest key (phc_…)", () => {
    assert.deepEqual(
      scanForSecrets("f.ts", `apiKey: "phc_0123456789abcdefghijklmnopqrstuvwxyz"`),
      [],
    );
  });

  it("does NOT flag the bare word `service_role` in SQL comments", () => {
    assert.deepEqual(
      scanForSecrets("m.sql", "-- writes are service_role-only"),
      [],
    );
  });

  it("does NOT flag the env var name SUPABASE_SERVICE_ROLE_KEY", () => {
    assert.deepEqual(
      scanForSecrets("fn.ts", "const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')"),
      [],
    );
  });
});

describe("scanForSecrets — reporting & ignore marker", () => {
  it("reports 1-indexed line and column", () => {
    const src = `line one\nconst k = "${SERVICE_ROLE_JWT}";`;
    const m = scanForSecrets("f.js", src);
    assert.equal(m[0].line, 2);
    assert.equal(m[0].column, src.split("\n")[1].indexOf("eyJ") + 1);
  });

  it("skips a line carrying the ignore marker", () => {
    const src = `const k = "${SERVICE_ROLE_JWT}"; // ${IGNORE_MARKER}`;
    assert.deepEqual(scanForSecrets("f.js", src), []);
  });

  it("redacts the secret in the preview (never prints it whole)", () => {
    const m = scanForSecrets("f.js", `const k = "${SERVICE_ROLE_JWT}";`);
    assert.ok(!m[0].preview.includes(SERVICE_ROLE_JWT));
    assert.match(m[0].preview, /^eyJh…\(\d+ chars\)$/);
  });
});

describe("redact", () => {
  it("keeps the first 4 chars and the length", () => {
    assert.equal(redact("AKIAIOSFODNN7EXAMPLE"), "AKIA…(20 chars)");
  });
});

describe("formatSecretReport", () => {
  it("is empty when there are no matches", () => {
    assert.equal(formatSecretReport([]), "");
  });

  it("groups by file and names the rule", () => {
    const m = scanForSecrets("secrets.ts", `const k = "${SERVICE_ROLE_JWT}";`);
    const report = formatSecretReport(m);
    assert.match(report, /secrets\.ts/);
    assert.match(report, /supabase-service-role-jwt/);
    assert.match(report, /CLAUDE\.md/);
  });
});

describe("rule set integrity", () => {
  it("every rule has a unique id and a global pattern", () => {
    const ids = new Set<string>();
    for (const rule of DEFAULT_SECRET_RULES) {
      assert.ok(!ids.has(rule.id), `duplicate rule id: ${rule.id}`);
      ids.add(rule.id);
      assert.ok(rule.pattern.global, `${rule.id} pattern must be global`);
    }
  });
});

describe("what the source scan does not read", () => {
  it("keeps only the exemptions that are still load-bearing", () => {
    // The convention `assertExemptionsHonest` states one directory over: an
    // exemption that has stopped being needed is a hole standing open, and
    // nothing here could say so while the list was five names and a sentence.
    assert.ok(SECRET_SKIP_FILES.length > 0, "an empty list should be deleted, not left");
    assert.deepEqual(SECRET_SKIP_FILES, Object.keys(SECRET_SKIP_FILE_REASONS));
    for (const rel of SECRET_SKIP_FILES) {
      const reason = SECRET_SKIP_FILE_REASONS[rel];
      assert.ok(
        reason !== undefined && reason.length >= 30,
        `${rel} is exempt for a reason shorter than a reason: ${JSON.stringify(reason)}`,
      );
      const found = scanForSecrets(rel, read(rel));
      assert.ok(
        found.length > 0,
        `${rel} is exempt from the secret scan and the scanner finds nothing in it — drop the entry rather than leaving the file unscanned`,
      );
    }
  });

  it("scans the scanner's own sources and the lockfile, which never needed exempting", () => {
    // The four entries this list used to carry, and the measurement that
    // retired them: a rule holds a REGEXP, and `/\bAKIA[0-9A-Z]{16}\b/` does
    // not match itself. The exemption bought nothing and cost the coverage of
    // the three files a sample credential is most likely to be pasted into.
    // Asserted rather than assumed both ways — they are out of the list, and
    // the scan over them is clean, so dropping them cannot have turned the
    // guard red for a reason nobody checked.
    for (const rel of [
      "lib/secret-scan.ts",
      "scripts/check-secrets.ts",
      "scripts/check-bundle-secrets.ts",
      "package-lock.json",
    ]) {
      assert.ok(!SECRET_SKIP_FILES.includes(rel), `${rel} was exempted again without a demonstrated match`);
      assert.deepEqual(
        scanForSecrets(rel, read(rel)),
        [],
        `${rel} now matches a rule — silence one line with a \`${IGNORE_MARKER}\` comment where it happens, rather than exempting the whole file`,
      );
    }
  });

  it("accounts for every extension in the repository, one way or the other", () => {
    // The check that makes the extension list a statement rather than a
    // memory — the same partition `assertSourceDirsCoverTheTree` makes one
    // level up, and it found three holes the moment it was written:
    // `.env.example`, `queries.m` and `measures.dax` were all unread.
    const present = new Set(
      listFilesUnder(REPO_ROOT, { skipDirs: SECRET_SKIP_DIRS }).map((rel) =>
        path.extname(rel).toLowerCase(),
      ),
    );
    assert.ok(present.size > 5, `only ${present.size} extensions walked — the walk is broken, not the tree`);
    const scanned = new Set([...SOURCE_SCAN_EXTENSIONS, ...ARCHIVE_SCAN_EXTENSIONS]);
    const unaccounted = [...present].filter(
      (ext) => !scanned.has(ext) && !(ext in NOT_SCANNED_EXTENSION_REASONS),
    );
    assert.deepEqual(
      unaccounted,
      [],
      `the repository holds these extensions and the secret scan neither reads them nor says why: ${unaccounted.join(", ")}`,
    );
    for (const [ext, reason] of Object.entries(NOT_SCANNED_EXTENSION_REASONS)) {
      assert.ok(
        present.has(ext),
        `${ext || '""'} is excused from the scan and no file in the tree has it — drop the entry rather than keeping a reason for nothing`,
      );
      assert.ok(reason.length >= 30, `${ext || '""'} is excluded for a reason shorter than a reason`);
      assert.ok(!scanned.has(ext), `${ext || '""'} is both scanned and excused`);
    }
    // The two scanned halves are disjoint too: an extension in both would be
    // read once as one string and once as a container, and the second read is
    // the one that would throw.
    for (const ext of ARCHIVE_SCAN_EXTENSIONS) {
      assert.ok(
        !SOURCE_SCAN_EXTENSIONS.includes(ext),
        `${ext} is both a text format and an archive format`,
      );
      assert.ok(present.has(ext), `${ext} is opened as an archive and no file in the tree has it`);
    }
  });

  it("reads the two files that tell their reader to paste credentials in", () => {
    // `.env.example` documents the shape of every credential this app takes,
    // and `docs/powerbi/queries.m` instructs the reader to replace four
    // literals with their Supabase session pooler values — a database
    // password, in a committed file. Both were outside the extension list.
    for (const rel of [".env.example", "docs/powerbi/queries.m", "docs/powerbi/measures.dax"]) {
      assert.ok(
        SOURCE_SCAN_EXTENSIONS.includes(path.extname(rel)),
        `${rel} is not covered by the scan's extension list`,
      );
      assert.deepEqual(scanForSecrets(rel, read(rel)), [], `${rel} carries a matching secret`);
    }
  });

  it("opens the committed .pbit and scans what is inside it", () => {
    // The template's parts are UTF-16LE JSON holding the whole M expression,
    // parameters included. Today they hold the placeholders `queries.m` ships;
    // the case is that they are READ, so the day one of them holds a real
    // session pooler host and password the guard is what says so.
    const entries = readZipEntries(readFileSync(repoPath("docs", "powerbi", "Collectables-Starter.pbit")));
    const decoded: Record<string, string> = {};
    for (const [name, data] of Object.entries(entries)) decoded[name] = decodeZipEntryText(data);
    assert.match(decoded["DataModelSchema"], /PostgreSQL\.Database/, "the M expression is not in there");
    assert.deepEqual(scanArchiveEntries("docs/powerbi/Collectables-Starter.pbit", decoded), []);
  });

  it("finds a service_role JWT pasted into an archive part, and names the entry", () => {
    const decoded = {
      "Report/Layout": "{}",
      DataModelSchema: `{"expression": "Password=${SERVICE_ROLE_JWT}"}`,
    };
    const matches = scanArchiveEntries("docs/powerbi/x.pbit", decoded);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].file, `docs/powerbi/x.pbit${ARCHIVE_ENTRY_SEPARATOR}DataModelSchema`);
    assert.equal(matches[0].ruleId, "supabase-service-role-jwt");
    assert.equal(archiveEntryPath("docs/powerbi/x.pbit", "DataModelSchema"), matches[0].file);
  });

  it("is the decoding that makes those bytes matchable at all", () => {
    // The reason `.pbit` was excused, restated as a case: a UTF-16LE part read
    // as UTF-8 puts a NUL between every character, and no rule matches across
    // one. Scanning the raw bytes finds nothing; decoding first finds the key.
    const part = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`"AKIA${"A".repeat(16)}"`, "utf16le"),
    ]);
    assert.deepEqual(scanForSecrets("x.pbit!Part", part.toString("utf8")), []);
    assert.equal(scanArchiveEntries("x.pbit", { Part: decodeZipEntryText(part) }).length, 1);
  });

  it("scans a DEFLATED archive too, since that is what an exported one is", () => {
    // Every committed .pbit so far was written by `zipStore` (STORED). A copy
    // re-exported from Power BI Desktop — the only kind that can carry a real
    // credential — is deflated, and the reader this scan used to have refused
    // exactly that.
    const zip = zipFixture(
      [
        {
          name: "DataModelSchema",
          data: Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from(`{"k":"AKIA${"B".repeat(16)}"}`, "utf16le"),
          ]),
        },
      ],
      { deflate: true, streamed: true },
    );
    const decoded: Record<string, string> = {};
    for (const [name, data] of Object.entries(readZipEntries(zip))) {
      decoded[name] = decodeZipEntryText(data);
    }
    assert.equal(scanArchiveEntries("x.pbit", decoded)[0]?.ruleId, "aws-access-key-id");
  });

  it("names which set of files a run examined, and what git's list left out", () => {
    // Two runs reporting identically over different sets is the failure the
    // subject line exists to prevent: "no committed secrets" means one thing
    // over git's list and another over a walk of the working tree.
    const git = (notListed: number) => formatScanSubject({ source: "git", notListed });
    assert.equal(git(0), "git's committable set");
    assert.equal(git(4), "git's committable set (4 working-tree file(s) not in it)");
    // The count is the number an ignore rule moves. Zero is silent, because a
    // clean checkout should not carry a clause about nothing. What the listing
    // held and the scan did not READ is a different sentence and has its own
    // clause — this one answers "which set", and a parenthesis that also
    // itemises the exceptions is a line nobody finishes.
    assert.match(
      formatScanSubject({ source: "walk", reason: "not a git repository" }),
      /^the working tree \(not checked against git: not a git repository\)$/,
    );
  });

  it("names the listed candidates it did not read, and why not, and then counts", () => {
    // A count alone — `1 listed path(s) not regular files`, which is what this
    // clause replaced — is enough to notice a change and not enough to act on
    // one: a tracked symlink with a scanned extension is an odd thing for a
    // repository to hold, and the run reporting one gave no name to look at.
    assert.equal(formatUnreadCandidates([]), "");
    assert.equal(
      formatUnreadCandidates([{ rel: "docs/link.md", kind: "not a regular file" }]),
      "1 listed path(s) not read: docs/link.md (not a regular file)",
    );
    // The two kinds are not the same event, so they are carried per name
    // rather than summed. A symlink is a repository that uses links; a path
    // git lists and the working tree does not hold is a COMMITTED file this
    // scan did not read, inside a run whose last words are "no committed
    // secrets".
    assert.equal(
      formatUnreadCandidates([
        { rel: "docs/link.md", kind: "not a regular file" },
        { rel: "PRIVACY.md", kind: "missing from the working tree" },
      ]),
      "2 listed path(s) not read: PRIVACY.md (missing from the working tree), " +
        "docs/link.md (not a regular file)",
    );
    // Sorted by name, and the tail is COUNTED rather than dropped: a clause
    // that quietly stops naming what it skipped is the silence it exists to
    // end. Same five as the local-only clause next door.
    const many = Array.from({ length: UNREAD_NAMES_SHOWN + 2 }, (_, i) => ({
      rel: `docs/l${String(i)}.md`,
      kind: "not a regular file",
    }));
    const line = formatUnreadCandidates(many);
    assert.match(line, /^7 listed path\(s\) not read: docs\/l0\.md /);
    assert.match(line, /, \+2 more$/);
    assert.doesNotMatch(line, /docs\/l5\.md/);
  });

  it("counts archives toward the floor, which no run can demonstrate", () => {
    // The rest of the wrapper's archive handling — that it walks them, opens
    // them, decodes them, names the entry and exits 1 on one it could not open
    // — is asserted by spawning the guard over a planted `.pbit` in
    // `secret-scan-archive-run.test.ts`, which is what those four regexes over
    // this file used to stand in for. This line is the exception: the floor is
    // 500 and no fixture can hold 500 archives, so an archive dropped from the
    // count is invisible to a run and visible only here.
    assert.match(
      read("scripts/check-secrets.ts"),
      /assertScannedFloor\(CHECK_NAME, files\.length \+ archives\.length\)/,
    );
  });

  it("states both scans' directory policy in one place, and passes it", () => {
    // The bundle scan's list is empty and written out anyway: beside a source
    // scan that skips six names, an omitted argument reads as an oversight.
    assert.deepEqual(BUNDLE_SKIP_DIRS, []);
    assert.ok(SECRET_SKIP_DIRS.length > 0);
    assert.match(read("scripts/check-secrets.ts"), /skipDirs: SECRET_SKIP_DIRS/);
    assert.match(read("scripts/check-bundle-secrets.ts"), /skipDirs: BUNDLE_SKIP_DIRS/);
  });
});

describe("SEC-14 wiring (structural)", () => {
  it("ships the source and bundle scanner scripts + the pure matcher", () => {
    read("lib/secret-scan.ts");
    read("scripts/check-secrets.ts");
    read("scripts/check-bundle-secrets.ts");
  });

  it("registers the npm scripts and the source scan in the lint:all registry", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["lint:secrets"], "tsx scripts/check-secrets.ts");
    assert.equal(
      pkg.scripts["lint:secrets:bundle"],
      "tsx scripts/check-bundle-secrets.ts",
    );
    // Registry membership means lint:ci and the ci.yml "Code-style guards"
    // step both run the source scan via the lint:all aggregator (wiring
    // pinned in lint-guards.test.ts).
    assert.ok(LINT_GUARDS.some((g) => g.npmScript === "lint:secrets"));
  });

  it("wires the bundle scan + a gitleaks job into CI", () => {
    const ci = read(".github/workflows/ci.yml");
    // The bundle scan needs dist/ so it stays its own post-build step.
    assert.match(ci, /npm run lint:secrets:bundle/);
    assert.match(ci, /gitleaks\/gitleaks-action/);
  });
});
