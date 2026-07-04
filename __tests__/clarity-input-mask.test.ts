import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  CLARITY_MASK_ALLOWED_FILES,
  findClarityMaskViolations,
  findUnmaskedInputTags,
  formatClarityMaskReport,
} from "../lib/check-clarity-input-mask";

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
        statSync(path.join(__dirname, "..", file)),
      );
    }
  });

  it("the real app/ + components/ trees pass the scan", () => {
    const repoRoot = path.join(__dirname, "..");
    const files: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx")) {
          files[path.relative(repoRoot, full).split(path.sep).join("/")] =
            readFileSync(full, "utf8");
        }
      }
    };
    walk(path.join(repoRoot, "app"));
    walk(path.join(repoRoot, "components"));
    assert.deepEqual(findClarityMaskViolations(files), []);
  });

  it("the wrapper itself carries the mask marker (fail-closed on refactor)", () => {
    const wrapper = readFileSync(
      path.join(__dirname, "..", "components", "masked-text-input.tsx"),
      "utf8",
    );
    assert.match(wrapper, /clarity-mask/);
  });
});
