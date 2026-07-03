/**
 * Power BI quick-start connection summary — pure builders.
 *
 * `scripts/print-powerbi-conn.ts` reads the repo `.env` and prints the exact
 * Supabase session-pooler connection values that `docs/powerbi-connection.md`
 * section 2–3 walks through, so an engineer doesn't have to dig through the
 * Supabase dashboard to assemble them. Everything here is pure and
 * node-testable; the only secret-bearing value (the service-role password)
 * is NEVER read or printed — it stays a placeholder pointing at the dashboard.
 */

export type PowerbiConnection = {
  /** Supabase project ref parsed from `EXPO_PUBLIC_SUPABASE_URL`, or null. */
  readonly projectRef: string | null;
  /** Session-pooler host. `<region>` stays a placeholder — it is not derivable from the project URL. */
  readonly server: string;
  readonly port: number;
  readonly database: string;
  /** Pooler username (`postgres.<project-ref>`). */
  readonly username: string;
  /** Always a placeholder — the service-role secret must come from the dashboard. */
  readonly passwordPlaceholder: string;
};

/**
 * Minimal dotenv-style parser (the repo deliberately avoids the `dotenv`
 * dependency). Supports `KEY=value`, optional `export ` prefix, `#` comment
 * lines, and single/double quotes around the value. Lines without `=` are
 * ignored. No multi-line values, no variable expansion.
 */
export function parseDotEnv(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** `https://<ref>.supabase.co` → `<ref>`; anything else → null. */
export function extractSupabaseProjectRef(
  url: string | undefined,
): string | null {
  if (!url) return null;
  const match = url
    .trim()
    .match(/^https:\/\/([a-z0-9]{16,})\.supabase\.(?:co|in)\b/i);
  return match ? match[1].toLowerCase() : null;
}

export const SERVICE_ROLE_PLACEHOLDER =
  "<service-role secret — Supabase dashboard → Project settings → API>";

export function buildPowerbiConnection(
  env: Record<string, string | undefined>,
): PowerbiConnection {
  const projectRef = extractSupabaseProjectRef(env.EXPO_PUBLIC_SUPABASE_URL);
  return {
    projectRef,
    server: "aws-0-<region>.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    username: `postgres.${projectRef ?? "<project-ref>"}`,
    passwordPlaceholder: SERVICE_ROLE_PLACEHOLDER,
  };
}

/** Human-readable summary the CLI prints. Contains no secrets by construction. */
export function renderPowerbiConnSummary(conn: PowerbiConnection): string {
  const lines = [
    "Power BI → Supabase session-pooler connection (docs/powerbi-connection.md §2–3)",
    "",
    conn.projectRef
      ? `Project ref     : ${conn.projectRef}`
      : "Project ref     : <project-ref>  (EXPO_PUBLIC_SUPABASE_URL not set — copy the ref from the dashboard URL)",
    `Server          : ${conn.server}:${conn.port}`,
    `Database        : ${conn.database}`,
    `Username        : ${conn.username}`,
    `Password        : ${conn.passwordPlaceholder}`,
    "",
    "Postgres URI    : postgresql://" +
      `${conn.username}:<service-role-secret>@${conn.server}:${conn.port}/${conn.database}`,
    "",
    "Notes:",
    "- <region> is shown on the dashboard's Session pooler tab (Project settings → Database → Connection string); it is not derivable from the project URL.",
    "- Use the session pooler (port 5432), not the transaction pooler — Power BI keeps a long-lived connection during refresh.",
    "- The service-role secret bypasses RLS on every table. Treat it like a root password; never commit it.",
  ];
  return lines.join("\n");
}
