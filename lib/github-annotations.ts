/**
 * GitHub Actions workflow commands, and the escaping they need.
 *
 * A CI step that only writes to stdout is read by whoever is already reading
 * the log, which is whoever already knows something is wrong. An annotation is
 * read by everyone: it appears on the run summary and, given a file and line,
 * on the diff. The difference matters most for the things that DO NOT fail —
 * `check-audit-baseline` can decline to answer when the npm registry is down,
 * and until it annotated, a week of outages would have been a week of green
 * runs with the reason buried in a log nobody opens on a green run.
 *
 * The escaping is not optional and it is not one rule: a message escapes `%`
 * and the two newline characters, and a PROPERTY value escapes those plus `:`
 * and `,`, which are what separate one property from the next and the
 * properties from the message. Getting it wrong truncates the annotation at
 * the first colon rather than failing, which is the kind of bug that ships.
 *
 * This lives on its own because two modules produce annotations now —
 * `check-inline-hex` a per-finding `::error`, the audit gate a `::warning` for
 * a skip — and the escapers were private to the first of them. A second copy
 * of a rule with five replacements in it is how the two stop agreeing.
 */

/**
 * What a workflow command says about severity. `notice` is the quietest.
 *
 * The array is the declaration and the type is derived from it, rather than the
 * other way round: {@link isAnnotationLine} has to match every level, and a
 * fourth spelled only in a union is a level `annotation` can emit and the
 * classifier cannot recognise.
 */
export const ANNOTATION_LEVELS = ["error", "warning", "notice"] as const;

export type AnnotationLevel = (typeof ANNOTATION_LEVELS)[number];

/**
 * Whether a printed line is a workflow command rather than a sentence.
 *
 * The gate scripts return their whole output as one list — log lines and
 * annotations together, because the caller prints them all — and the only thing
 * telling the two apart was a `::` prefix that five cases in
 * `audit-baseline.test.ts` matched for themselves. The prefix is this module's
 * to know: {@link annotation} decides where the level goes and whether a
 * property list follows it, and a check reading `startsWith("::")` is a copy of
 * half that decision, kept in step by nobody.
 *
 * Anchored on the levels rather than on `::` alone, because `::` alone is also
 * how a TypeScript type annotation looks in a line of source a guard is quoting
 * back — and these checks quote source at people constantly.
 */
export function isAnnotationLine(line: string): boolean {
  return new RegExp(`^::(?:${ANNOTATION_LEVELS.join("|")})(?: |::)`).test(line);
}

/** The optional `key=value` pairs an annotation can carry. */
export interface AnnotationProperties {
  readonly file?: string;
  readonly line?: number;
  readonly col?: number;
  /** The bold heading on the annotation; the message is its body. */
  readonly title?: string;
}

/** Escape a workflow-command message (the part after `::`). */
export function escapeAnnotationMessage(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Escape a workflow-command property value (`file=…`, `title=…`).
 *
 * Everything a message escapes, plus the two separators: `,` ends a property
 * and `:` ends the property list. A title with a colon in it — which is how
 * every check here names itself — would otherwise cut the annotation in half.
 */
export function escapeAnnotationProperty(value: string): string {
  return escapeAnnotationMessage(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * One workflow-command line: `::level key=value,key=value::message`.
 *
 * Properties are omitted when undefined rather than written empty, because
 * `file=` with nothing after it is a property GitHub tries to resolve.
 */
export function annotation(
  level: AnnotationLevel,
  message: string,
  properties: AnnotationProperties = {},
): string {
  const pairs = [
    properties.file === undefined ? undefined : `file=${escapeAnnotationProperty(properties.file)}`,
    properties.line === undefined ? undefined : `line=${String(properties.line)}`,
    properties.col === undefined ? undefined : `col=${String(properties.col)}`,
    properties.title === undefined
      ? undefined
      : `title=${escapeAnnotationProperty(properties.title)}`,
  ].filter((pair): pair is string => pair !== undefined);
  const prefix = pairs.length === 0 ? `::${level}::` : `::${level} ${pairs.join(",")}::`;
  return prefix + escapeAnnotationMessage(message);
}

/**
 * Whether to emit annotations at all.
 *
 * Locally they are noise — a line of `::warning title=…::` in a terminal is
 * strictly worse than the sentence it wraps, which every one of these checks
 * also prints.
 */
export function runningUnderActions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.GITHUB_ACTIONS === "true";
}
