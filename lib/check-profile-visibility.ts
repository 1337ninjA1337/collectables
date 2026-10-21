import { annotation } from "./github-annotations";
import { stripComments } from "./strip-comments";

/**
 * A profile an admin deleted must not come back through a direct read.
 *
 * WHAT THIS IS ABOUT. `SocialProvider` holds an admin tombstone list —
 * `deletedProfileIds`, device-global, written by `deleteProfile` — and
 * `SocialProvider.profiles` drops those rows. That was the ONLY list that
 * honoured it until 2026-10-21. `app/people.tsx` lists the rows `fetchProfiles`
 * returns and the rows `searchProfiles` returns; `components/search-overlay.tsx`
 * unions a `fetchProfiles` snapshot with `searchProfiles` matches. Both read
 * the table, so both rendered a profile an admin had deleted, in the browser
 * whose job is finding people and in the sheet whose job is the same, with a
 * tap through to the full profile screen on each.
 *
 * WHY IT IS A RULE RATHER THAN THREE FIXED CALL SITES. The fix was one filter
 * per surface, and what makes it rot is that the tombstone is invisible from
 * the call site: `fetchProfiles` returns `UserProfile[]`, the rows look
 * complete, and nothing in the types, the names or a review diff says a
 * visibility decision was skipped. The hidden-username list one module over is
 * applied INSIDE the fetch, so every reader gets it for free and nobody has to
 * remember; the admin tombstone lives in React state and cannot be, so the
 * remembering is what this rule replaces. Three readers existed and three
 * readers forgot.
 *
 * THE SUBJECT IS THE TWO LIST READERS, and `fetchProfileById` is deliberately
 * not among them. Its importers are `lib/social-context.tsx` — the provider
 * that owns the set and gates its own answer in `getProfileById` — and
 * `lib/collections-context.tsx`, which reads the SIGNED-IN user's own row, and
 * `deleteProfile` refuses to tombstone the current user. A rule that demanded
 * the predicate there would be asking for a filter against a profile that
 * cannot be in the list. The by-id answer has its own claims in
 * `social-context-wiring.test.ts`.
 *
 * WHAT COUNTS AS PASSING, and why it is this weak. Naming `isProfileDeleted`
 * anywhere in the file. That is a mention, not a proof: a file could consult
 * the predicate for one half of a union and not the other, which is exactly
 * what both surfaces did for "not me" before they shared one predicate. A
 * scanner cannot follow rows from a fetch into a render — that is what
 * `social-context-wiring.test.ts`' per-surface claims are for — and the
 * failure this rule exists to catch is a THIRD reader that consults nothing at
 * all, which a mention catches on the day the import lands.
 *
 * COMMENTS ARE BLANKED FIRST, in both directions. Five modules discuss
 * `fetchProfiles`/`searchProfiles` in prose (the debounce delay's header, the
 * search needle's, the hook's), and a rule reading those as imports would
 * report three files that call neither. The other direction matters more: a
 * file could satisfy this rule with the word `isProfileDeleted` in a comment,
 * and blanking comments means the mention has to be code.
 */

/** Where the row readers live. */
export const PROFILES_MODULE = "@/lib/supabase-profiles";

/** The readers that answer with a LIST of other people's rows. */
export const PROFILE_LIST_READERS = ["fetchProfiles", "searchProfiles"] as const;

/** The question a direct reader has to ask before it renders a row. */
export const VISIBILITY_PREDICATE = "isProfileDeleted";

/** One file that reads profile rows and consults no visibility decision. */
export interface ProfileVisibilityFinding {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** 1-indexed line of the import that makes it a subject. */
  readonly line: number;
  /** Which readers it imports, in the order the rule names them. */
  readonly readers: readonly string[];
}

/** `import { … } from "@/lib/supabase-profiles"`, braces possibly wrapped. */
const PROFILES_IMPORT = new RegExp(
  `import\\s*\\{([^}]*)\\}\\s*from\\s*"${PROFILES_MODULE.replace("/", "\\/")}"`,
  "g",
);

/** 1-indexed line of an offset. */
function lineOf(source: string, at: number): number {
  return source.slice(0, at).split("\n").length;
}

/** The list readers this file imports, and where the import is. */
export function profileListReaderImport(
  source: string,
): { readers: string[]; line: number } | null {
  const code = stripComments(source);
  for (const match of code.matchAll(PROFILES_IMPORT)) {
    const bound = match[1];
    const readers = PROFILE_LIST_READERS.filter((name) =>
      new RegExp(`\\b${name}\\b`).test(bound),
    );
    if (readers.length > 0) return { readers: [...readers], line: lineOf(code, match.index) };
  }
  return null;
}

/** Whether this file consults the tombstone at all. */
export function consultsProfileVisibility(source: string): boolean {
  return new RegExp(`\\b${VISIBILITY_PREDICATE}\\b`).test(stripComments(source));
}

/** The finding for one file, or none. */
export function findProfileVisibilityRisks(
  file: string,
  source: string,
): ProfileVisibilityFinding[] {
  const imported = profileListReaderImport(source);
  if (!imported) return [];
  if (consultsProfileVisibility(source)) return [];
  return [{ file, line: imported.line, readers: imported.readers }];
}

/** Human-readable failure report; empty string when there is nothing to say. */
export function formatProfileVisibilityReport(
  findings: readonly ProfileVisibilityFinding[],
): string {
  if (findings.length === 0) return "";
  const lines = [
    `Found ${findings.length} file(s) reading profile rows without consulting ${VISIBILITY_PREDICATE}.`,
    `\`fetchProfiles\`/\`searchProfiles\` answer with the table's rows, which include the profiles an admin deleted — that set lives in \`SocialProvider\` and cannot be applied inside the fetch. Take \`${VISIBILITY_PREDICATE}\` from \`useSocial()\` and drop those rows before anything renders them.`,
  ];
  for (const f of findings) {
    lines.push(`  ${f.file}:${f.line}  imports ${f.readers.join(", ")} and names no ${VISIBILITY_PREDICATE}`);
  }
  return lines.join("\n");
}

/** The same findings as GitHub Actions annotations. */
export function profileVisibilityAnnotations(
  findings: readonly ProfileVisibilityFinding[],
): string[] {
  return findings.map((f) =>
    annotation(
      "error",
      `${f.readers.join("/")} answers with rows an admin may have deleted — filter them with ${VISIBILITY_PREDICATE} from useSocial().`,
      { file: f.file, line: f.line, title: "Profile rows rendered without a visibility decision" },
    ),
  );
}
