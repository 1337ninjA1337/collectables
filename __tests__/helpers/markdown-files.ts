/**
 * The repository's prose, listed rather than named one file at a time.
 *
 * The documentation sweeps here have all been written against a hardcoded pair
 * of filenames — `CLAUDE.md` and `SECURITY.md`, because those are the two the
 * author had in mind. A rule that only reads the files it was written for
 * cannot fail on the third copy, and the third copy is the one that goes
 * stale: the sentence lands in `README-DEPLOY.md` or a new page under `docs/`
 * and nothing has an opinion about it.
 *
 * Roots come in as arguments, deliberately. `helpers/source-files.ts` names
 * the same decision for the TypeScript tree: a walk that hardcodes its
 * directory is a walk that stops covering new code silently, and the guard in
 * `source-files-helper.test.ts` bans exactly that shape in a suite. This is
 * the markdown half of it, and it is the only `readdirSync` over the doc tree.
 *
 * ONE LEVEL, not recursive: `.md` files in this repository live at the root,
 * in `docs/`, in `.github/` and in `.tasks/`, all flat. A nested one would be
 * a surprise worth noticing rather than a file to sweep quietly, and the
 * shallow walk keeps `node_modules` out of reach by construction rather than
 * by a skip list that has to stay right.
 */

import { readdirSync } from "node:fs";
import path from "node:path";

import { repoPath } from "./repo-file";

/**
 * The markdown files directly inside each directory, repo-relative and sorted.
 *
 * `markdownFiles(".", "docs")` → `[".github/…", "CLAUDE.md", "docs/…"]`-shaped
 * paths, ready to hand to {@link import("./repo-file").readRepoFile} and ready
 * to print in an offender list.
 *
 * Dotfiles are included — `.tasks/.tasks.md` and `.github/`'s templates are
 * both prose somebody reads — which is why the filter is on the extension
 * alone.
 */
export function markdownFiles(...dirs: readonly string[]): readonly string[] {
  return dirs
    .flatMap((dir) =>
      readdirSync(repoPath(dir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => path.join(dir, entry.name).split(path.sep).join("/")),
    )
    .sort();
}
