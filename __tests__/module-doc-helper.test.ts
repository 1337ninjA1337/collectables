import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  backtickedNames,
  classifyProseName,
  moduleDoc,
  proseNames,
} from "./helpers/module-doc";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The extraction two headers now depend on.
 *
 * These cases were `plural.test.ts`'s, written beside the one invariant that
 * wanted them. A second header reads its own names now — the audit gate's, in
 * `audit-baseline.test.ts` — so the extraction is a helper and its cases are
 * here, where a third caller can find them instead of discovering that the
 * function it wants is inside a suite about Russian plurals.
 *
 * What the fixtures cannot show is checked against the real tree at the end:
 * an extraction that quietly returned the whole file would pass every
 * fixture, and both callers would keep agreeing because the names they look
 * for are in there somewhere.
 */

describe("moduleDoc", () => {
  it("is the first /** block, not the text before the first close", () => {
    // The shape that broke it: a comment above the doc comment. The old
    // extraction returned the eslint line and nothing else.
    const source = ["/* eslint-disable no-bitwise */", "/**", " * lib/caller.ts asks.", " */", "export const x = 1;"].join("\n");
    assert.match(moduleDoc(source), /lib\/caller\.ts asks\./);
    assert.doesNotMatch(moduleDoc(source), /eslint-disable/);
  });

  it("skips a shebang, which is what every gate script opens with", () => {
    // `scripts/check-audit-baseline.ts` is `#!/usr/bin/env tsx` and then its
    // header. Anchoring on `/**` handles it for the same reason it handles the
    // eslint line, and this is the case that says so for the file that has it.
    const source = ["#!/usr/bin/env tsx", "/**", " * `runAuditGate` decides.", " */", ""].join("\n");
    assert.match(moduleDoc(source), /runAuditGate/);
    assert.doesNotMatch(moduleDoc(source), /usr\/bin/);
  });

  it("stops at its own close, so the whole file is not the doc comment", () => {
    const source = ["/**", " * lib/caller.ts asks.", " */", "// lib/impostor.ts does not.", ""].join("\n");
    assert.doesNotMatch(moduleDoc(source), /impostor/);
  });

  it("refuses a file with no doc comment rather than reading one as empty", () => {
    // An empty search text agrees that nothing is named, which is the wrong
    // answer given confidently: every name would read as unresolved.
    assert.throws(() => moduleDoc("export const x = 1;\n"), /no doc comment/);
  });

  for (const file of ["lib/plural.ts", "scripts/check-audit-baseline.ts"]) {
    it(`returns the real header of ${file}, which the fixtures cannot show`, () => {
      const source = readRepoFile(file);
      const doc = moduleDoc(source);
      assert.ok(doc.startsWith("/**"), "the extracted text does not begin at a doc comment opener");
      // Longer than every FUNCTION doc in the same file, derived rather than
      // written: an anchor on `/**` can land on either, and a number typed here
      // would be a third thing to keep in step with the prose above it.
      const others = [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)]
        .slice(1)
        .map((match) => match[0].length);
      const longest = Math.max(...others);
      assert.ok(
        others.length > 0 && doc.length > longest,
        `the extracted block is ${String(doc.length)} characters and the longest function doc in ${file} is ${String(longest)} — the header is the one the names live in, and this is not it`,
      );
      // The half a length floor cannot state: the block ends before the code.
      // Any export, not one by name — the property is "stops at the source",
      // and pinning one identifier makes a rename the thing that would notice.
      assert.doesNotMatch(doc, /^export /m);
    });
  }
});

describe("backtickedNames", () => {
  it("returns every span in source order, duplicates kept", () => {
    const doc = "/**\n * `a` then `b` then `a`.\n";
    assert.deepEqual(backtickedNames(doc), ["a", "b", "a"]);
  });

  it("stops at the line end, so an unclosed backtick takes one line and not the rest", () => {
    // A lone backtick in prose used to swallow the paragraph after it and hand
    // the caller a "name" the width of the header, which then resolved to
    // nothing and reported the whole sentence as missing.
    const doc = ["/**", " * an unclosed ` here", " * and `runAuditGate` below.", " */"].join("\n");
    assert.deepEqual(backtickedNames(doc), ["runAuditGate"]);
  });

  it("finds nothing in a header that names nothing", () => {
    assert.deepEqual(backtickedNames("/**\n * Plain prose.\n */"), []);
  });
});

describe("classifyProseName", () => {
  it("calls a camel, Pascal or SCREAMING_SNAKE name ours", () => {
    for (const name of ["runAuditGate", "readAuditPayload", "AuditRead", "LINT_GUARDS", "AUDIT_TIMEOUT_MS"]) {
      assert.equal(classifyProseName(name), "identifier", `${name} should be checkable`);
    }
  });

  it("leaves a single-case word alone, because it is as likely to be somebody else's", () => {
    // Every one of these is backticked in a header in this tree today, and
    // none of them is a declaration here: npm's lifecycle hook, the compiler,
    // a package, GitHub's event name, Node's error code, the kernel's signal.
    for (const name of ["postinstall", "tsc", "nanoid", "pull_request", "ENOENT", "SIGKILL"]) {
      assert.equal(classifyProseName(name), "prose", `${name} should not be claimed`);
    }
  });

  it("calls a slashed path with a known extension a path", () => {
    for (const name of ["lib/audit-baseline.ts", "app/collection/[id].tsx", ".github/workflows/ci.yml"]) {
      assert.equal(classifyProseName(name), "path", `${name} should be checkable`);
    }
  });

  it("leaves a bare filename alone, because it names a check as often as a file", () => {
    // `check-expo-install` is a script, an npm script and a CI step, and
    // `MANUAL-TASKS.md` sits at the root of a tree where four directories
    // could hold a file of that name. Neither resolves without guessing.
    for (const name of ["check-expo-install", "MANUAL-TASKS.md", "package.json"]) {
      assert.equal(classifyProseName(name), "prose", `${name} should not be claimed`);
    }
  });

  it("leaves a command alone, whatever it contains", () => {
    for (const name of ["npm audit --json", "npm run verify", "tsc --noEmit"]) {
      assert.equal(classifyProseName(name), "prose", `${name} should not be claimed`);
    }
  });
});

describe("proseNames", () => {
  it("splits a header into the two checkable populations", () => {
    const doc = [
      "/**",
      " * Every decision is `runAuditGate` in `lib/audit-baseline.ts`, and a run",
      " * that cannot reach the registry is the call `check-expo-install` makes.",
      " * `npm audit --json` exits non-zero whenever it finds anything.",
      " */",
    ].join("\n");
    assert.deepEqual(proseNames(doc), {
      identifiers: ["runAuditGate"],
      paths: ["lib/audit-baseline.ts"],
    });
  });
});
