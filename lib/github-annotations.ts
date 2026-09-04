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

/** What a workflow command says about severity. `notice` is the quietest. */
export type AnnotationLevel = "error" | "warning" | "notice";

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
