/**
 * Migration-docs parity scanner used by `scripts/check-migration-docs.ts` and
 * its tests (BE-32).
 *
 * Pure module: no filesystem access. The CLI wrapper reads
 * `supabase/migrations/*.sql` and `MANUAL-TASKS.md` from disk and passes their
 * names/contents here so the matcher can be unit-tested under `node --test`
 * without mocking `fs`.
 *
 * CLAUDE.md mandates: "IN CASE THERE ARE ANY REQ CHANGES INTO DB (supabase sql
 * commands) ADD EVERYTHING THAT I NEED TO IMPLEMENT MANUALLY IN
 * MANUAL-TASKS.MD". This guard enforces it in CI: every committed migration
 * file must have a matching `## <filename>` H2 section in MANUAL-TASKS.md, so a
 * new migration can never land without its manual-apply instructions.
 */

/** Matches a Markdown H2 heading line, capturing the heading text. */
const H2_PATTERN = /^##[ \t]+(.+?)[ \t]*$/gm;

/**
 * Extract the set of H2 heading texts from a MANUAL-TASKS.md document.
 * Headings are trimmed; deeper levels (`###`) are ignored.
 */
export function manualTaskSections(manualTasksContent: string): Set<string> {
  const sections = new Set<string>();
  const re = new RegExp(H2_PATTERN.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(manualTasksContent)) !== null) {
    sections.add(m[1].trim());
  }
  return sections;
}

/**
 * Return the migration filenames that lack a matching `## <filename>` section
 * in MANUAL-TASKS.md. A migration is documented when an H2 heading equals its
 * exact filename (e.g. `## 20260424_chat_messages.sql`). Result is sorted.
 */
export function findUndocumentedMigrations(
  migrationFilenames: string[],
  manualTasksContent: string,
): string[] {
  const sections = manualTaskSections(manualTasksContent);
  return migrationFilenames
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => !sections.has(name))
    .sort();
}

/**
 * Format the undocumented list as a human-readable error. Returns an empty
 * string when nothing is missing so callers can short-circuit.
 */
export function formatMigrationDocsReport(undocumented: string[]): string {
  if (undocumented.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Found ${undocumented.length} migration(s) with no matching section in MANUAL-TASKS.md.`,
  );
  lines.push(
    "Add a `## <filename>` H2 section documenting the manual-apply SQL for each (CLAUDE.md: DB changes must be recorded in MANUAL-TASKS.md).",
  );
  for (const name of undocumented) {
    lines.push(`    supabase/migrations/${name}  ->  add "## ${name}" to MANUAL-TASKS.md`);
  }
  return lines.join("\n");
}
