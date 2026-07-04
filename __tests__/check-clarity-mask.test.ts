import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  findTagEnd,
  findUnmaskedInputs,
  formatClarityMaskReport,
} from "../lib/check-clarity-mask";
import {
  CLARITY_MASK_ATTRIBUTE,
  CLARITY_MASK_DATASET_KEY,
  CLARITY_MASK_PROPS,
} from "../lib/clarity-mask";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("CLARITY_MASK_PROPS", () => {
  it("carries the dataset key react-native-web maps to data-clarity-mask", () => {
    // DOM dataset camelCase ↔ hyphenated attribute: dataset.clarityMask is
    // exactly the data-clarity-mask attribute Clarity's masking looks for.
    assert.equal(CLARITY_MASK_DATASET_KEY, "clarityMask");
    const hyphenated = CLARITY_MASK_DATASET_KEY.replace(
      /[A-Z]/g,
      (c) => `-${c.toLowerCase()}`,
    );
    assert.equal(`data-${hyphenated}`, CLARITY_MASK_ATTRIBUTE);
  });

  it("uses Clarity's documented \"True\" value under the dataSet prop", () => {
    assert.deepEqual(CLARITY_MASK_PROPS, { dataSet: { clarityMask: "True" } });
  });
});

describe("findTagEnd", () => {
  it("finds the closing > of a simple tag", () => {
    const src = "<TextInput value={x} />";
    assert.equal(src[findTagEnd(src, "<TextInput".length)], ">");
  });

  it("skips > inside brace expressions (arrow functions)", () => {
    const src = "<TextInput onChangeText={(t) => setValue(t)} style={s.input} />";
    const end = findTagEnd(src, "<TextInput".length);
    assert.equal(end, src.length - 1);
  });

  it("skips braces and > inside string and template literals", () => {
    const src = '<TextInput placeholder={"a > b } c"} testID={`x > ${y}`} />';
    const end = findTagEnd(src, "<TextInput".length);
    assert.equal(end, src.length - 1);
  });

  it("returns source length when the tag never closes", () => {
    const src = "<TextInput value={x}";
    assert.equal(findTagEnd(src, "<TextInput".length), src.length);
  });
});

describe("findUnmaskedInputs", () => {
  it("returns empty for source with no inputs", () => {
    assert.deepEqual(findUnmaskedInputs("a.tsx", "<View><Text>hi</Text></View>"), []);
  });

  it("flags an unmasked <TextInput with 1-indexed line + column", () => {
    const src = 'const a = 1;\n  <TextInput value={x} onChangeText={setX} />\n';
    const v = findUnmaskedInputs("a.tsx", src);
    assert.equal(v.length, 1);
    assert.deepEqual(v[0], {
      file: "a.tsx",
      line: 2,
      column: 3,
      tag: "TextInput",
      reason: "unmasked",
    });
  });

  it("accepts the canonical {...CLARITY_MASK_PROPS} spread (multi-line)", () => {
    const src = "<TextInput\n  {...CLARITY_MASK_PROPS}\n  value={x}\n/>";
    assert.deepEqual(findUnmaskedInputs("a.tsx", src), []);
  });

  it("accepts an inline dataSet={{ clarityMask: ... }} literal", () => {
    const src = '<TextInput dataSet={{ clarityMask: "True" }} value={x} />';
    assert.deepEqual(findUnmaskedInputs("a.tsx", src), []);
  });

  it("accepts a literal data-clarity-mask attribute and ms-clarity-mask class", () => {
    assert.deepEqual(
      findUnmaskedInputs("a.tsx", '<TextInput data-clarity-mask="True" />'),
      [],
    );
    assert.deepEqual(
      findUnmaskedInputs("a.tsx", '<TextInput className="ms-clarity-mask" />'),
      [],
    );
  });

  it("does not credit a mask that appears only AFTER the tag closes", () => {
    // The marker must sit inside the opening tag's attribute region.
    const src = "<TextInput value={x} />\n{/* {...CLARITY_MASK_PROPS} */}\n";
    const v = findUnmaskedInputs("a.tsx", src);
    assert.equal(v.length, 1);
    assert.equal(v[0].reason, "unmasked");
  });

  it("is not fooled by > inside an onChangeText arrow before the mask", () => {
    const src =
      "<TextInput\n  onChangeText={(raw) => onChangeValue(sanitize(raw))}\n  {...CLARITY_MASK_PROPS}\n/>";
    assert.deepEqual(findUnmaskedInputs("a.tsx", src), []);
  });

  it("flags raw <input elements even when they carry the mask attribute", () => {
    const src = '<input data-clarity-mask="True" type="text" />\n<input type="email" />';
    const v = findUnmaskedInputs("a.tsx", src);
    assert.equal(v.length, 2);
    assert.ok(v.every((x) => x.tag === "input" && x.reason === "raw-input"));
  });

  it("does NOT match longer identifiers like <TextInputMask or <inputRange", () => {
    const src = "<TextInputMask value={x} />\n<inputRange />";
    assert.deepEqual(findUnmaskedInputs("a.tsx", src), []);
  });

  it("audits every tag independently (one masked, one not)", () => {
    const src =
      "<TextInput {...CLARITY_MASK_PROPS} value={a} />\n<TextInput value={b} />";
    const v = findUnmaskedInputs("a.tsx", src);
    assert.equal(v.length, 1);
    assert.equal(v[0].line, 2);
  });
});

describe("formatClarityMaskReport", () => {
  it("returns empty string for no violations", () => {
    assert.equal(formatClarityMaskReport([]), "");
  });

  it("groups by file and names the fix", () => {
    const report = formatClarityMaskReport([
      { file: "app/a.tsx", line: 3, column: 5, tag: "TextInput", reason: "unmasked" },
      { file: "app/a.tsx", line: 9, column: 1, tag: "input", reason: "raw-input" },
      { file: "components/b.tsx", line: 2, column: 7, tag: "TextInput", reason: "unmasked" },
    ]);
    assert.match(report, /3 text input\(s\)/);
    assert.match(report, /CLARITY_MASK_PROPS/);
    assert.match(report, /app\/a\.tsx/);
    assert.match(report, /components\/b\.tsx/);
    assert.match(report, /3:5\s+<TextInput> — missing Clarity mask/);
    assert.match(report, /9:1\s+<input> — raw <input> element/);
  });
});

describe("real source tree", () => {
  const walkTsx = (dir: string, out: string[]): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkTsx(full, out);
      else if (entry.isFile() && full.endsWith(".tsx")) out.push(full);
    }
    return out;
  };

  it("every <TextInput under app/ and components/ is masked today", () => {
    const files = [
      ...walkTsx(path.join(REPO_ROOT, "app"), []),
      ...walkTsx(path.join(REPO_ROOT, "components"), []),
    ];
    assert.ok(files.length > 10, "scan roots unexpectedly empty");
    const violations = files.flatMap((file) =>
      findUnmaskedInputs(path.relative(REPO_ROOT, file), readFileSync(file, "utf8")),
    );
    assert.deepEqual(violations, []);
  });

  it("the login screen (email-OTP form) spreads CLARITY_MASK_PROPS", () => {
    // The task's motivating example: a forgotten mask here would leak the
    // user's email address into Microsoft's replay bucket.
    const src = read("components/login-screen.tsx");
    assert.match(src, /import \{ CLARITY_MASK_PROPS \} from "@\/lib\/clarity-mask";/);
    const spreads = src.match(/\{\.\.\.CLARITY_MASK_PROPS\}/g) ?? [];
    assert.ok(spreads.length >= 2, "email + OTP inputs must both be masked");
  });
});

describe("CI wiring", () => {
  it("package.json exposes lint:clarity-mask and chains it into lint:ci", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["lint:clarity-mask"], "tsx scripts/check-clarity-mask.ts");
    assert.match(pkg.scripts["lint:ci"], /npm run lint:clarity-mask/);
  });

  it("ci.yml runs the clarity-mask step", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /npm run lint:clarity-mask/);
  });

  it("the script wrapper scans app/ and components/ via the pure helper", () => {
    const script = read("scripts/check-clarity-mask.ts");
    assert.match(script, /from "\.\.\/lib\/check-clarity-mask"/);
    assert.match(script, /\["app", "components"\]/);
    assert.match(script, /process\.exit\(1\)/);
  });
});
