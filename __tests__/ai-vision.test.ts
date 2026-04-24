import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractJson } from "@/lib/ai-vision";

describe("extractJson", () => {
  it("parses plain JSON object", () => {
    const parsed = extractJson('{"title":"A","description":"B","variants":""}');
    assert.deepEqual(parsed, { title: "A", description: "B", variants: "" });
  });

  it("strips markdown code fences with json tag", () => {
    const input = "```json\n{\"title\":\"X\"}\n```";
    const parsed = extractJson(input) as Record<string, unknown>;
    assert.equal(parsed.title, "X");
  });

  it("strips markdown code fences without language tag", () => {
    const input = "```\n{\"title\":\"Y\"}\n```";
    const parsed = extractJson(input) as Record<string, unknown>;
    assert.equal(parsed.title, "Y");
  });

  it("finds the first JSON object embedded in extra text", () => {
    const input = "Sure, here you go: {\"title\":\"Z\",\"description\":\"d\"} — hope that helps!";
    const parsed = extractJson(input) as Record<string, unknown>;
    assert.equal(parsed.title, "Z");
    assert.equal(parsed.description, "d");
  });

  it("throws when there is no JSON at all", () => {
    assert.throws(() => extractJson("no json here"), /valid JSON/i);
  });

  it("trims whitespace around the payload", () => {
    const parsed = extractJson('   \n  {"ok":true}\n  ') as Record<string, unknown>;
    assert.equal(parsed.ok, true);
  });
});
