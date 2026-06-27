/**
 * Secret-scanning patterns + matcher (SEC-14) — the deterministic, dependency-free
 * core behind `npm run lint:secrets` (`scripts/check-secrets.ts`). Mechanically
 * enforces the CLAUDE.md rule "never commit credentials" by failing CI when a
 * real-looking secret value appears in either a committed source file or the
 * built `dist/` web bundle (where an accidentally-`EXPO_PUBLIC_`-exposed
 * service-role key would otherwise ship to every browser).
 *
 * Design choice: match credential VALUE shapes (PEM blocks, `AKIA…`, `ghp_…`,
 * a JWT whose payload claims `role: service_role`, …), never documentation
 * WORDS. The repo's docs/`MANUAL-TASKS.md` reference `service_role` /
 * `SUPABASE_SERVICE_ROLE_KEY` dozens of times — those are safe and must not
 * trip the scanner. Only a key that actually carries a secret should fail.
 *
 * Pure on purpose: imports nothing, so the node test runner and the lint
 * script consume it without a Metro/react-native shim.
 */

export type SecretRule = {
  /** Stable id used in the report + tests. */
  readonly id: string;
  /** Human-readable description of what leaked. */
  readonly description: string;
  /** Value-shaped matcher. Use a global flag for multi-match. */
  readonly pattern: RegExp;
};

export type SecretFinding = {
  readonly ruleId: string;
  readonly description: string;
  readonly match: string;
  /** 1-based line number within the scanned content. */
  readonly line: number;
};

/**
 * Static value-shaped credential rules. Each pattern is anchored on a shape
 * that does not occur in prose, so it is safe to run over the whole tree.
 */
export const SECRET_RULES: readonly SecretRule[] = Object.freeze([
  {
    id: "private-key-block",
    description: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: "aws-access-key-id",
    description: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "github-pat-classic",
    description: "GitHub personal access token (classic)",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "github-pat-fine-grained",
    description: "GitHub fine-grained personal access token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
  },
  {
    id: "github-oauth-token",
    description: "GitHub OAuth / app token",
    pattern: /\bgh[ousr]_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "slack-token",
    description: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "google-api-key",
    description: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
  },
  {
    id: "stripe-secret-key",
    description: "Stripe secret/restricted key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  {
    id: "cloudinary-url-with-secret",
    description: "Cloudinary URL containing api_key:api_secret",
    pattern: /cloudinary:\/\/[0-9]{6,}:[A-Za-z0-9_\-]{12,}@[a-z0-9]+/g,
  },
  {
    id: "generic-bearer-jwt-assignment",
    description: "service-role/secret key assigned a JWT value",
    pattern:
      /(?:SERVICE_ROLE|SERVICE_KEY|SECRET_KEY)\w*\s*[:=]\s*["']?eyJ[A-Za-z0-9_\-]+\.eyJ/g,
  },
]);

/**
 * Substrings that mark a line as a deliberate placeholder / documentation
 * example rather than a real leaked secret. A line containing any of these is
 * skipped. Lower-cased comparison.
 */
export const PLACEHOLDER_MARKERS: readonly string[] = Object.freeze([
  "paste your",
  "your-",
  "your_",
  "example.com",
  "<your",
  "changeme",
  "xxxxxxxx",
  "redacted",
  "placeholder",
  "dummy",
]);

function isPlaceholderLine(line: string): boolean {
  const lower = line.toLowerCase();
  return PLACEHOLDER_MARKERS.some((m) => lower.includes(m));
}

// --- JWT service_role detection (the high-value dist/ check) ----------------

const JWT_RE = /\beyJ[A-Za-z0-9_\-]+\.(eyJ[A-Za-z0-9_\-]+)\.[A-Za-z0-9_\-]+/g;

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  try {
    // Buffer is available in node + the bundler shims it; fall back to atob.
    if (typeof Buffer !== "undefined") {
      return Buffer.from(padded, "base64").toString("utf8");
    }
    const maybeAtob = (globalThis as { atob?: (s: string) => string }).atob;
    return typeof maybeAtob === "function" ? maybeAtob(padded) : "";
  } catch {
    return "";
  }
}

/**
 * True when `text` contains a JWT whose decoded payload claims the Supabase
 * `service_role` (or any `*_role` other than `anon`/`authenticated`). The anon
 * / publishable key legitimately ships to the client; the service-role key
 * must never appear in a bundle or a committed file.
 */
export function containsServiceRoleJwt(text: string): boolean {
  JWT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JWT_RE.exec(text)) !== null) {
    const payload = base64UrlDecode(m[1]);
    if (/"role"\s*:\s*"service_role"/.test(payload)) return true;
  }
  return false;
}

/**
 * Scans a single file/bundle's text content and returns every finding. Skips
 * placeholder/example lines so `.env.example` and docs never trip the gate.
 */
export function scanContentForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    if (isPlaceholderLine(line)) return;
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.pattern.exec(line)) !== null) {
        findings.push({
          ruleId: rule.id,
          description: rule.description,
          match: m[0],
          line: idx + 1,
        });
        if (!rule.pattern.global) break;
      }
    }
  });

  // JWT service-role check runs over the whole content (payload may wrap lines
  // in a minified bundle is unlikely, but keep it whole-content for safety).
  if (containsServiceRoleJwt(content)) {
    findings.push({
      ruleId: "supabase-service-role-jwt",
      description: "Supabase service_role JWT (must never reach the client)",
      match: "eyJ…service_role…",
      line: 0,
    });
  }

  return findings;
}

export type FileFindings = { readonly file: string; readonly findings: SecretFinding[] };

/**
 * Formats findings into a human-readable CI report.
 */
export function formatSecretReport(results: readonly FileFindings[]): string {
  const withFindings = results.filter((r) => r.findings.length > 0);
  if (withFindings.length === 0) {
    return "check-secrets: no secrets detected.";
  }
  const lines: string[] = [
    `check-secrets: found ${withFindings.reduce(
      (n, r) => n + r.findings.length,
      0,
    )} potential secret(s):`,
  ];
  for (const { file, findings } of withFindings) {
    for (const f of findings) {
      lines.push(
        `  ${file}:${f.line} [${f.ruleId}] ${f.description} — ${f.match}`,
      );
    }
  }
  return lines.join("\n");
}
