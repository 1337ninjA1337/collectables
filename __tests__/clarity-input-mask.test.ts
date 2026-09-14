import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";

import {
  CLARITY_MASK_ALLOWED_FILES,
  findClarityMaskViolations,
  findUnmaskedInputTags,
  formatClarityMaskReport,
} from "../lib/check-clarity-input-mask";

import { readRepoFile, repoPath } from "./helpers/repo-file";
import { readSource, tsxFiles } from "./helpers/source-files";

describe("check-clarity-input-mask", () => {
  it("flags a raw <TextInput> with no mask attribute", () => {
    const source = `<TextInput value={email} onChangeText={setEmail} style={styles.input} />`;
    const violations = findUnmaskedInputTags("app/login.tsx", source);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].tag, "TextInput");
    assert.equal(violations[0].line, 1);
  });

  it("flags a raw web <input>", () => {
    const violations = findUnmaskedInputTags(
      "components/web-form.tsx",
      `<View>\n  <input type="text" />\n</View>`,
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].tag, "input");
    assert.equal(violations[0].line, 2);
  });

  it("accepts a tag carrying data-clarity-mask", () => {
    const source = `<input type="text" data-clarity-mask="True" />`;
    assert.deepEqual(findUnmaskedInputTags("a.tsx", source), []);
  });

  it("accepts a tag carrying dataSet clarity-mask (the wrapper's shape)", () => {
    const source = `<TextInput ref={ref} {...props} dataSet={{ "clarity-mask": "True" }} />`;
    assert.deepEqual(findUnmaskedInputTags("a.tsx", source), []);
  });

  it("is not fooled by > inside handler arrow functions before the mask", () => {
    const source = [
      "<TextInput",
      "  onChangeText={(value) => setQuery(value.trim())}",
      '  dataSet={{ "clarity-mask": "True" }}',
      "/>",
    ].join("\n");
    assert.deepEqual(findUnmaskedInputTags("a.tsx", source), []);
  });

  it("does not treat TypeScript generics as JSX", () => {
    const source = [
      "const ref = useRef<TextInput>(null);",
      "const forwarded = forwardRef<TextInput, TextInputProps>(fn);",
    ].join("\n");
    assert.deepEqual(findUnmaskedInputTags("a.tsx", source), []);
  });

  it("does not match <MaskedTextInput usages", () => {
    const source = `<MaskedTextInput value={query} onChangeText={setQuery} />`;
    assert.deepEqual(findUnmaskedInputTags("a.tsx", source), []);
  });

  it("reports the correct line for a violation deep in a file", () => {
    const source = ["const a = 1;", "", "export function Screen() {", "  return (", "    <TextInput />", "  );", "}"].join("\n");
    const violations = findUnmaskedInputTags("a.tsx", source);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 5);
  });

  it("skips allow-listed files and sorts the full scan by path", () => {
    const violations = findClarityMaskViolations({
      "components/masked-text-input.tsx": `<TextInput ref={ref} />`, // allow-listed
      "app/z.tsx": `<TextInput />`,
      "app/a.tsx": `<input />`,
    });
    assert.deepEqual(
      violations.map((v) => v.file),
      ["app/a.tsx", "app/z.tsx"],
    );
  });

  it("formats a readable report", () => {
    const report = formatClarityMaskReport(
      findClarityMaskViolations({ "app/a.tsx": `<TextInput />` }),
    );
    assert.match(report, /app\/a\.tsx:1/);
    assert.match(report, /MaskedTextInput/);
  });

  it("the allow-list names files that exist", () => {
    for (const file of CLARITY_MASK_ALLOWED_FILES) {
      assert.doesNotThrow(() =>
        statSync(repoPath(file)),
      );
    }
  });

  it("the real app/ + components/ trees pass the scan", () => {
    const files = Object.fromEntries(
      tsxFiles("app", "components").map((relative) => [relative, readSource(relative)]),
    );
    assert.deepEqual(findClarityMaskViolations(files), []);
  });

  it("the wrapper itself carries the mask marker (fail-closed on refactor)", () => {
    const wrapper = readRepoFile("components", "masked-text-input.tsx");
    assert.match(wrapper, /clarity-mask/);
  });

  it("reads a mask that sits after a quoted `>`", () => {
    // The bug in the hand-rolled tag reader this guard carried until
    // 2026-09-14: it counted braces and did not skip string literals, so the
    // quoted bracket ended the tag and the attribute after it was never seen.
    // A masked input reported as unmasked.
    assert.deepEqual(
      findUnmaskedInputTags("app/a.tsx", `<TextInput placeholder=">" data-clarity-mask />`),
      [],
    );
  });

  it("reads a mask that sits after an inline arrow", () => {
    // The half the old reader DID have, kept as a case so the replacement is
    // held to both.
    assert.deepEqual(
      findUnmaskedInputTags(
        "app/a.tsx",
        `<TextInput onChangeText={(v) => set(v)} data-clarity-mask />`,
      ),
      [],
    );
  });

  it("reports a tag that never closes instead of trusting it", () => {
    // It used to `return source.length` — "treat the rest of the file as the
    // tag so the mask check still sees every attribute" — which means ONE
    // `clarity-mask` anywhere below an unclosed tag marks every input under it
    // compliant, and the guard reports a clean tree. The worst available
    // failure for a rule about a privacy marker.
    const source = [
      "<TextInput style={{ flex: 1", // brace depth never returns to 0
      "<TextInput data-clarity-mask />",
    ].join("\n");
    const found = findUnmaskedInputTags("app/a.tsx", source);
    // The old reader gave the first tag "the rest of the file", which holds
    // the marker on the line below — so it reported NOTHING for this source.
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 1);
    assert.match(found[0].hint, /never closes/);
  });
});
