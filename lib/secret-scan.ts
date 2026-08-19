/**
 * Known-secret scanner used by `scripts/check-secrets.ts` (source tree),
 * `scripts/check-bundle-secrets.ts` (built `dist/`) and their tests.
 *
 * Pure module: no React Native imports, no filesystem access. Directory
 * walking lives in the script wrappers so the matcher can be unit-tested
 * under `node --test` without mocking `fs`.
 *
 * SEC-14 — mechanically enforce CLAUDE.md "NEVER push any credentials into
 * git". Two enforcement surfaces share this matcher:
 *   1. the source tree (a committed credential is rejected before merge), and
 *   2. the built web bundle in `dist/` (a server-only secret that leaked into
 *      client code is rejected before deploy).
 *
 * Detection is deliberately precise to keep false positives near zero:
 *  - the Supabase **anon / publishable** JWT is meant to ship in the client,
 *    so the JWT rule decodes the payload and only fires on a privileged role
 *    (`service_role`), never on `anon`;
 *  - the PostHog public ingest key (`phc_…`) is public by design — only the
 *    personal API key (`phx_…`) is flagged;
 *  - the literal word `service_role` appears all over the SQL migration
 *    comments, so it is NOT a pattern on its own.
 *
 * Escape hatch: any line containing the token `secret-scan-ignore` is skipped
 * (use for fixtures/placeholders that legitimately resemble a secret).
 */

import { NEVER_WALKED } from "./source-dirs";

/** Marker that suppresses scanning for the line it appears on. */
export const IGNORE_MARKER = "secret-scan-ignore";

/**
 * Directories the source-tree scan never descends into.
 *
 * Spread rather than restated, because the overlap was invisible: this list
 * used to be six names in `scripts/check-secrets.ts` and three of them were
 * {@link import("./source-dirs").NEVER_WALKED} spelled again, so a reader of
 * either could not tell which entries are the shared "never holds source"
 * rule and which are this scan's own. Written this way, the first three move
 * when the shared rule does and the last three are visibly a decision made
 * here: `.git` is object storage rather than text, and `coverage/` and
 * `web-build/` are generated outputs this scan would otherwise read a copy of
 * every source file through.
 *
 * Here rather than in the wrapper so a suite can compare it BY VALUE — the
 * wrapper runs `main()` at import and cannot be loaded from a test, which is
 * why the check on this list was a regex over the guard's own source. Walking
 * still lives in the wrapper; what a walk skips is policy, and this module is
 * where this scan's policy already lives.
 */
export const SECRET_SKIP_DIRS: readonly string[] = [
  ...NEVER_WALKED,
  ".git",
  "coverage",
  "web-build",
];

/**
 * The same for the bundle scan, and it is empty on purpose.
 *
 * Written out rather than left as an omitted argument, because the two scans
 * sit beside each other and "skips six names" versus "the option is not there"
 * reads as an oversight in the second one. `dist/` is generated whole by
 * `expo export` and holds exactly what was shipped — a vendored tree under it
 * would be a tree that went to the browser, which is the one thing this scan
 * must NOT skip.
 */
export const BUNDLE_SKIP_DIRS: readonly string[] = [];

/**
 * Files the source-tree scan does not read, and why each is exempt.
 *
 * The list held five entries and four of them were dead. The stated reason —
 * "the scanner's own sources and tests embed the patterns by definition" — is
 * true of the fixtures and false of the code: a rule carries a REGEXP, and
 * `/\bAKIA[0-9A-Z]{16}\b/` does not match itself. Measured rather than
 * reasoned about: `lib/secret-scan.ts`, `scripts/check-secrets.ts` and
 * `scripts/check-bundle-secrets.ts` produce zero matches, so the exemption
 * bought nothing and cost the coverage of the three files a sample credential
 * is most likely to be pasted into. `package-lock.json` produced zero too, and
 * reading it costs 23ms.
 *
 * What remains is the one file where the exemption is load-bearing, and the
 * suite asserts it still is — an exemption that stops being needed is a hole
 * standing open. The way to earn a new entry is a demonstrated match; the way
 * to silence one line is {@link IGNORE_MARKER}, which says so where it happens
 * rather than in a list at the top of a module.
 */
export const SECRET_SKIP_FILE_REASONS: Readonly<Record<string, string>> = {
  "__tests__/secret-scan.test.ts":
    "the matcher's own fixtures — real-shaped sample secrets the scanner is supposed to find, and does: two of them match",
};

/** The same as a list, derived rather than restated. */
export const SECRET_SKIP_FILES: readonly string[] = Object.keys(SECRET_SKIP_FILE_REASONS);

/*
 * The scan's second exemption is not written here, and that is deliberate.
 *
 * This guard's report says "no committed secrets" while walking the working
 * tree — the same set only on a clean checkout. The gap has a cost the moment
 * anything asks a reader to put a real credential on disk, and
 * `docs/powerbi/queries.m` does exactly that in its own header, which is why it
 * points at a `.local.` copy instead: `*.local.*` is in `.gitignore`, so the
 * mistake is impossible rather than detected, and the reader's own
 * `npm run verify` does not go permanently red over a file git will never take.
 *
 * The marker is a repository-wide naming convention rather than a fact about
 * secrets, so it lives in {@link import("./local-only")} with the two
 * git-backed assertions that make it safe — exactly the move `NEVER_WALKED`
 * made into `lib/source-dirs.ts` after being written out twice. This scan
 * IMPORTS `isLocalOnlyPath`; it does not own it.
 */

/**
 * The text formats the source scan reads.
 *
 * It was fourteen extensions in the wrapper and nothing checked it against the
 * tree, which is how three holes stayed open: `.env.example` — the one file
 * whose entire subject is credential SHAPE, and therefore the likeliest place
 * a real one is pasted by accident — `docs/powerbi/queries.m`, which tells its
 * reader in a comment to replace four literals with their Supabase session
 * pooler values (a database password, in a committed file), and `measures.dax`
 * beside it. All three are read now, and
 * `__tests__/secret-scan.test.ts` partitions every extension in the
 * repository against this list, so the next format to arrive is a decision
 * rather than a silence.
 *
 * Lower case, because the walk folds case before the membership test.
 */
export const SOURCE_SCAN_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
  ".html",
  ".txt",
  // `.env.example`, and any other `*.example`: `path.extname` answers
  // `.example`, so a file that documents the shape of every credential this
  // app takes was the one text file at the root nothing read.
  ".example",
  // Power BI sources under `docs/powerbi/`: Power Query M and DAX are text,
  // and the M file's own comments instruct the reader to paste connection
  // values into it.
  ".m",
  ".dax",
  // Apple's privacy manifest — XML, small, and config is where a key lands.
  ".xcprivacy",
  // `PRIVACY.md.<lang>`: the extension of a doubly-suffixed name is the
  // language code, so each translation reads as its own format. Six policy
  // files that are markdown in everything but the name.
  ".be",
  ".de",
  ".es",
  ".pl",
  ".ru",
];

/** Bundle artifacts that could embed a leaked credential. */
export const BUNDLE_SCAN_EXTENSIONS: readonly string[] = [".js", ".html", ".json", ".map", ".css"];

/**
 * The containers the source scan opens and scans the contents of.
 *
 * `.pbit` was excused as "a zip, so its text is compressed and unreadable to a
 * line scanner", and both halves of that were wrong in a way that mattered.
 * The committed template's parts are STORED, not compressed — what actually
 * defeats a line scanner is that they are UTF-16LE, so every character is
 * separated from the next by a NUL byte and no rule can match across it. And
 * the file this scan should fear is not the committed one anyway: it is the
 * copy somebody re-exports from Power BI Desktop after filling the four
 * parameters in `docs/powerbi/queries.m` with their real session pooler host
 * and service_role database password, exactly as that file's header tells them
 * to. That copy is DEFLATED, its parts hold the whole M expression as text,
 * and it drops into the same path with the same name.
 *
 * So the container is opened, each entry decoded by its byte-order mark, and
 * the same rules run over it — see {@link scanArchiveEntries}. Findings are
 * reported as `docs/powerbi/x.pbit!DataModelSchema:12:34`, the `!` being the
 * usual way to name a path inside an archive.
 */
export const ARCHIVE_SCAN_EXTENSIONS: readonly string[] = [".pbit"];

/** Separates an archive's path from the entry inside it, in a report. */
export const ARCHIVE_ENTRY_SEPARATOR = "!";

/**
 * The extensions in this repository the source scan deliberately does not
 * read, one reason each.
 *
 * The third part of the partition, and the part that makes it a statement: an
 * extension is either read as text, or opened as an archive, or here saying why
 * not — so a new format cannot arrive unscanned by nobody noticing. Both
 * remaining entries are binary in the sense that matters, which is that there
 * is no text inside them to read; `.pbit` used to be excused on the same
 * grounds and was the one entry where that was untrue, since a zip's entries
 * are text this scan can reach (see {@link ARCHIVE_SCAN_EXTENSIONS}).
 */
export const NOT_SCANNED_EXTENSION_REASONS: Readonly<Record<string, string>> = {
  "": "no extension at all — `path.extname` answers this for a dotfile like `.hw-fix`, and an entry of \"\" in the scan list would also pull in every extensionless binary",
  ".ttf": "font binaries under `assets/`, shipped as-is and never edited by hand",
};

export type SecretRule = {
  /** Stable identifier, surfaced in the report. */
  id: string;
  /** Human-readable description of what leaked. */
  description: string;
  /** Global regex; every match is a candidate. */
  pattern: RegExp;
  /**
   * Optional refinement run on each raw match. Return `true` to confirm the
   * candidate is a real secret, `false` to discard it (e.g. an anon JWT).
   */
  validate?: (raw: string) => boolean;
};

export type SecretMatch = {
  file: string;
  line: number;
  column: number;
  ruleId: string;
  description: string;
  /** Redacted preview — never the full secret, so CI logs stay clean. */
  preview: string;
};

/**
 * Decode a base64url segment to a UTF-8 string. Node's base64 decoder is
 * lenient (it never throws on junk), so the downstream `JSON.parse` in
 * {@link isPrivilegedSupabaseJwt} is what actually rejects non-JWT input; this
 * helper only guarantees it never throws and returns `""` if Buffer is absent.
 */
export function decodeBase64Url(segment: string): string {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    // Buffer is available under Node/tsx (the only runtimes that load this).
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * True when `jwt` is a three-segment JWT whose payload declares a privileged
 * Supabase role (`service_role`). The anon/publishable key (role `anon`) and
 * any non-JWT string return `false`, so the public client key is never
 * flagged.
 */
export function isPrivilegedSupabaseJwt(jwt: string): boolean {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const payload = decodeBase64Url(parts[1]);
  if (!payload) return false;
  try {
    const parsed = JSON.parse(payload) as { role?: unknown };
    return parsed.role === "service_role";
  } catch {
    return false;
  }
}

/** The default rule set shared by both scan surfaces. */
export const DEFAULT_SECRET_RULES: readonly SecretRule[] = [
  {
    id: "supabase-service-role-jwt",
    description: "Supabase service_role JWT (server-only, never ship to client)",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    validate: isPrivilegedSupabaseJwt,
  },
  {
    id: "private-key-block",
    description: "PEM private key block",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: "aws-access-key-id",
    description: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "google-api-key",
    description: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "github-token",
    description: "GitHub personal/OAuth/app token",
    pattern: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g,
  },
  {
    id: "slack-token",
    description: "Slack token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    id: "cloudinary-url",
    description: "Cloudinary URL with embedded api_secret",
    pattern: /cloudinary:\/\/[0-9]+:[A-Za-z0-9_-]+@[A-Za-z0-9_-]+/g,
  },
  {
    id: "posthog-personal-key",
    description: "PostHog personal API key (phx_…)",
    pattern: /\bphx_[0-9A-Za-z]{32,}\b/g,
  },
];

/** Redact a raw secret to `<first 4 chars>…(<length>)`. */
export function redact(raw: string): string {
  const head = raw.slice(0, 4);
  return `${head}…(${raw.length} chars)`;
}

/**
 * Scan a single source string for known secrets. Returns one entry per
 * occurrence (line + column 1-indexed). Lines carrying {@link IGNORE_MARKER}
 * are skipped entirely.
 */
export function scanForSecrets(
  file: string,
  source: string,
  rules: readonly SecretRule[] = DEFAULT_SECRET_RULES,
): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(IGNORE_MARKER)) continue;
    for (const rule of rules) {
      const re = new RegExp(rule.pattern.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const raw = m[0];
        if (rule.validate && !rule.validate(raw)) continue;
        matches.push({
          file,
          line: i + 1,
          column: m.index + 1,
          ruleId: rule.id,
          description: rule.description,
          preview: redact(raw),
        });
        // Guard against zero-width matches looping forever.
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  return matches;
}

/**
 * The name a finding inside an archive is reported under —
 * `docs/powerbi/Collectables-Starter.pbit!DataModelSchema`.
 *
 * One function rather than a template literal at each call site, because the
 * report and any future skip list have to spell it the same way, and the
 * separator being a single character is exactly the kind of thing that gets
 * written as `/` by the next person to touch it.
 */
export function archiveEntryPath(archive: string, entry: string): string {
  return `${archive}${ARCHIVE_ENTRY_SEPARATOR}${entry}`;
}

/**
 * Scan the decoded entries of one archive, reporting each finding under
 * {@link archiveEntryPath}.
 *
 * Takes already-decoded text rather than the archive's bytes so this module
 * stays free of `node:zlib` and remains testable as a pure matcher; the
 * wrapper does the opening, which is the same division `scanForSecrets` and
 * `check-secrets` already have for the filesystem.
 *
 * Entries are visited in name order so a report over an archive reads the same
 * on every machine — `readZipEntries` returns them in central-directory order,
 * which is the writer's choice and not stable across tools.
 */
export function scanArchiveEntries(
  archive: string,
  entries: Readonly<Record<string, string>>,
  rules: readonly SecretRule[] = DEFAULT_SECRET_RULES,
): SecretMatch[] {
  return Object.keys(entries)
    .sort()
    .flatMap((entry) => scanForSecrets(archiveEntryPath(archive, entry), entries[entry], rules));
}

/**
 * Which set of files a run examined, in the run's own words.
 *
 * The report ends "no committed secrets" and there are two sets it can mean:
 * git's committable list (tracked plus untracked-and-not-ignored) when git can
 * answer, and a walk of the working tree when it cannot. Two runs reporting
 * identically over different sets is the failure this whole line of work is
 * about, so the sentence names which one — and, under git, how many candidates
 * the working tree held that git's list did not.
 *
 * That number is the one an ignore rule moves. `*.local.*` is meant to move it
 * and does; a `.gitignore` line that quietly takes a real directory out of the
 * scan moves it too, and without a count the run that introduced it looks
 * exactly like the run before. Reported as a COUNT rather than a list because
 * on a working checkout it is a handful of scratch files whose names are of no
 * interest — what is of interest is the day it becomes forty.
 *
 * What the listing held and the scan did NOT read is a different sentence and
 * lives in {@link formatUnreadCandidates}: this one answers "which set", and a
 * parenthesis that also itemises the exceptions is a line nobody finishes
 * reading.
 */
export type ScanSubject =
  | { readonly source: "git"; readonly notListed: number }
  | { readonly source: "walk"; readonly reason: string };

export function formatScanSubject(subject: ScanSubject): string {
  if (subject.source === "walk") {
    return `the working tree (not checked against git: ${subject.reason})`;
  }
  const dropped =
    subject.notListed > 0 ? ` (${subject.notListed} working-tree file(s) not in it)` : "";
  return `git's committable set${dropped}`;
}

/**
 * How many candidates a pass line names before it starts counting.
 *
 * The same number {@link LOCAL_ONLY_NAMES_SHOWN} uses next door, for the same
 * reason: a clean run's report is one line and a checkout with two dozen
 * oddities in it should not turn that into a paragraph.
 */
export const UNREAD_NAMES_SHOWN = 5;

/** A candidate git listed that the scan could not read, and why not. */
export type UnreadCandidate = { readonly rel: string; readonly kind: string };

/**
 * The clause a run appends about candidates it listed and did not read.
 *
 * This started as a count — `1 listed path(s) not regular files` — which is
 * enough to notice a change and not enough to act on one. A tracked symlink
 * with a scanned extension is an odd thing for a repository to hold, and the
 * run that first reports one gave its reader no name to go and look at.
 *
 * The KIND is carried per name because the two that occur are not the same
 * event. A symlink is a repository that uses links: normal, and the reason it
 * is not read is that following it would report a file the repository does not
 * contain. A path git lists that the working tree does not hold is a checkout
 * disagreeing with its own index — a COMMITTED file this scan did not read,
 * inside a run whose last words are "no committed secrets". Summing them would
 * give the second the weight of the first.
 *
 * Empty at zero so the caller appends it without a branch, and sorted by name,
 * because a report that reads differently on two machines is one nobody diffs.
 * By CODE UNIT, like every other sorted list in this scan, and not by
 * `localeCompare` — which is the locale-aware comparison whose whole job is to
 * differ between machines, and which puts `docs/x` before `PRIVACY.md` on one
 * and not on another.
 */
export function formatUnreadCandidates(unread: readonly UnreadCandidate[]): string {
  if (unread.length === 0) return "";
  const sorted = [...unread].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const shown = sorted.slice(0, UNREAD_NAMES_SHOWN);
  const rest = sorted.length - shown.length;
  const names = shown.map(({ rel, kind }) => `${rel} (${kind})`).join(", ");
  return `${sorted.length} listed path(s) not read: ${names}${rest > 0 ? `, +${rest} more` : ""}`;
}

/**
 * Format a list of matches as a human-readable error message. Returns an
 * empty string when there are no matches so callers can short-circuit.
 */
export function formatSecretReport(matches: SecretMatch[]): string {
  if (matches.length === 0) return "";
  const grouped = new Map<string, SecretMatch[]>();
  for (const m of matches) {
    const list = grouped.get(m.file) ?? [];
    list.push(m);
    grouped.set(m.file, list);
  }
  const out: string[] = [];
  out.push(`Found ${matches.length} probable secret(s).`);
  out.push(
    "Remove the credential, rotate it, and route it through GitHub Secrets " +
      "(see CLAUDE.md). Add a `secret-scan-ignore` comment only for genuine " +
      "placeholders/fixtures.",
  );
  for (const [file, list] of grouped) {
    out.push("");
    out.push(`  ${file}`);
    for (const m of list) {
      out.push(`    ${m.line}:${m.column}  [${m.ruleId}] ${m.description} — ${m.preview}`);
    }
  }
  return out.join("\n");
}
