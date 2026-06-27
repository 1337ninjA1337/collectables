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

/** Marker that suppresses scanning for the line it appears on. */
export const IGNORE_MARKER = "secret-scan-ignore";

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
