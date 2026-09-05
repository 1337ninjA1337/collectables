/**
 * A module's own doc comment, and the code names it points at.
 *
 * `plural.test.ts` wrote the extraction first, for one invariant: the header of
 * `lib/plural.ts` names its callers in prose, so a fourth caller would leave the
 * paragraph describing three and nothing would say so. The same shape has now
 * arrived a second time one directory over — `scripts/check-audit-baseline.ts`
 * opens by saying every decision is `runAuditGate` in `lib/audit-baseline.ts`,
 * and a rename moves the code while the sentence keeps pointing where it used
 * to be. The extraction is the half both need; keeping it in the suite that
 * happened to want it first is how the second copy gets written.
 *
 * ## What counts as the header
 *
 * The first `/**` block, from its opener to the `*\/` that closes THAT block.
 *
 * Written first as `slice(0, indexOf("*\/"))` — the leading text up to the first
 * close, which is the doc comment only while the doc comment is the first thing
 * in the file. A `/* eslint … *\/` line above it, or a licence header, or the
 * `#!/usr/bin/env tsx` shebang every gate script carries, would cut the search
 * text down to that line and report every name as unresolved: a red run about
 * the extraction, wearing a message about the prose. Anchoring on `/**` and
 * closing from there answers the question asked, and an unparseable file is
 * refused rather than read as empty — an empty search text agrees that nothing
 * is named, which is the wrong answer given confidently.
 *
 * ## What counts as a name
 *
 * {@link backtickedNames} returns every `` `…` `` span in the header, in
 * source order, and {@link classifyProseName} sorts each one by SHAPE alone:
 * an identifier, a repo path, or neither. Shape rather than a list of known
 * words, because a list is the thing that goes stale beside the prose it
 * guards.
 *
 * "Neither" is a real answer and most of the header is in it. `npm audit
 * --json` is a command, `check-expo-install` is a check's name as much as a
 * file's, `SIGKILL` is the kernel's and `pull_request` is GitHub's. A rule that
 * demanded those resolve to something in this tree would be red on correct
 * prose, which is the rule somebody exempts and then ignores. What is left is
 * the population a rename actually breaks: a camel/Pascal/SCREAMING_SNAKE
 * identifier, and a path with a slash and an extension.
 *
 * Callers resolve; this module only classifies. WHERE a name has to be found —
 * exported by `lib/`, present in the tree, on disk — is a decision about the
 * header being read, and the two headers reading their own names today do not
 * agree on it.
 */

import assert from "node:assert/strict";

/**
 * The module's own doc comment: the first `/**` block, opener to close.
 *
 * Throws on a file with no doc comment, for the reason a structural test that
 * cannot open its subject should stop rather than report every assertion as a
 * finding about the code.
 */
export function moduleDoc(source: string): string {
  const open = source.indexOf("/**");
  const close = open === -1 ? -1 : source.indexOf("*/", open);
  assert.ok(
    open !== -1 && close !== -1,
    "the module has no doc comment to read, so the names it points at cannot be looked for in it",
  );
  return source.slice(open, close);
}

/**
 * Every backticked span in a doc comment, in source order, duplicates kept.
 *
 * Bounded to one line on purpose: a lone backtick in prose would otherwise
 * swallow the paragraph after it and hand the caller a "name" the width of the
 * header. Duplicates are kept because the caller reports names, and a name
 * written twice is written twice — de-duplicating here would make the count a
 * different question from the one the message asks.
 */
export function backtickedNames(doc: string): readonly string[] {
  return [...doc.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

/** What shape a backticked span has, and therefore whether it is resolvable. */
export type ProseNameKind = "identifier" | "path" | "prose";

/**
 * An identifier this repository would have written: `runAuditGate`,
 * `AuditRead`, `LINT_GUARDS`.
 *
 * The case transition is the whole test. A single lowercase word (`tsc`,
 * `nanoid`, `postinstall`) is as likely to be a binary, a package or an npm
 * lifecycle hook as one of ours; a single uppercase run (`ENOENT`, `SIGKILL`)
 * belongs to Node or the kernel far more often than to us. Neither can be told
 * from a local by looking, so neither is claimed. What IS claimed is the shape
 * nothing outside a TypeScript file is spelled in.
 */
const IDENTIFIER = /^(?:[A-Za-z_$][A-Za-z0-9_$]*)$/;
const OURS = /[a-z][A-Z]|^[A-Z][A-Z0-9]*_[A-Z0-9_]*$/;

/** A repo-relative path: at least one slash, and an extension we keep here. */
const PATH = /^[\w.@/[\]-]+\.(?:ts|tsx|js|mjs|md|ya?ml|json|sql)$/;

/**
 * Which of the three a backticked span is.
 *
 * `prose` is the default and the largest bucket, and a caller must treat it as
 * "not checkable" rather than "fine": the point of naming it is that the
 * distinction is visible at the call site instead of buried in a filter.
 */
export function classifyProseName(text: string): ProseNameKind {
  if (IDENTIFIER.test(text)) return OURS.test(text) ? "identifier" : "prose";
  if (PATH.test(text) && text.includes("/")) return "path";
  return "prose";
}

/** The checkable spans of a header, split by kind, in source order. */
export function proseNames(doc: string): {
  readonly identifiers: readonly string[];
  readonly paths: readonly string[];
} {
  const named = backtickedNames(doc);
  return {
    identifiers: named.filter((name) => classifyProseName(name) === "identifier"),
    paths: named.filter((name) => classifyProseName(name) === "path"),
  };
}
