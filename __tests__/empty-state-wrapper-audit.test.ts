import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_WRAPPER_BACKGROUNDS,
  findEmptyStateWrapperOverrides,
  formatEmptyStateWrapperReport,
} from "../lib/check-empty-state-wrappers";

import { readRepoFile } from "./helpers/repo-file";
import { readSource, sourceFiles } from "./helpers/source-files";

describe("findEmptyStateWrapperOverrides — matcher", () => {
  it("flags an EmptyState wrapped in a View with a card-colored StyleSheet background", () => {
    const src = [
      'import { EmptyState } from "@/components/empty-state";',
      "function S() {",
      "  return (",
      "    <View style={styles.card}>",
      '      <EmptyState title="x" />',
      "    </View>",
      "  );",
      "}",
      "const styles = StyleSheet.create({",
      "  card: { backgroundColor: CARD_BG_3, padding: 12 },",
      "});",
    ].join("\n");
    const findings = findEmptyStateWrapperOverrides("app/x.tsx", src);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].background, "CARD_BG_3");
    assert.equal(findings[0].source, "styles.card");
    assert.equal(findings[0].line, 5);
  });

  it("flags an inline backgroundColor on the wrapper", () => {
    const src = [
      "return (",
      '  <View style={{ backgroundColor: "#d89c5b" }}>',
      '    <EmptyState title="x" />',
      "  </View>",
      ");",
    ].join("\n");
    const findings = findEmptyStateWrapperOverrides("app/x.tsx", src);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].background, '"#d89c5b"');
    assert.equal(findings[0].source, "inline");
  });

  it("flags a background hidden in an array/conditional style", () => {
    const src = [
      "return (",
      "  <View style={[styles.page, active && styles.tinted]}>",
      '    <EmptyState title="x" />',
      "  </View>",
      ");",
      "const styles = StyleSheet.create({",
      "  page: { flex: 1 },",
      "  tinted: { backgroundColor: AMBER_SOFT_3 },",
      "});",
    ].join("\n");
    const findings = findEmptyStateWrapperOverrides("app/x.tsx", src);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].source, "styles.tinted");
  });

  it("allows PAGE_BG_* wrappers (the CrashFallback screen stand-in)", () => {
    const src = [
      "return (",
      "  <View style={styles.wrap}>",
      '    <EmptyState title="x" />',
      "  </View>",
      ");",
      "const styles = StyleSheet.create({",
      "  wrap: { flex: 1, backgroundColor: PAGE_BG_2 },",
      "});",
    ].join("\n");
    assert.deepEqual(findEmptyStateWrapperOverrides("app/x.tsx", src), []);
  });

  it("ignores colored sibling Views that closed before the EmptyState", () => {
    const src = [
      "return isSelf ? (",
      "  <View style={styles.selfHint}>",
      "    <Text>hint</Text>",
      "  </View>",
      ") : (",
      '  <EmptyState title="x" />',
      ");",
      "const styles = StyleSheet.create({",
      "  selfHint: { backgroundColor: CARD_BG_3 },",
      "});",
    ].join("\n");
    assert.deepEqual(findEmptyStateWrapperOverrides("app/x.tsx", src), []);
  });

  it("ignores self-closing Views and uncolored wrappers", () => {
    const src = [
      "return (",
      "  <View style={styles.list}>",
      "    <View style={styles.divider} />",
      '    <EmptyState title="x" />',
      "  </View>",
      ");",
      "const styles = StyleSheet.create({",
      "  list: { gap: SPACING_AIRY },",
      "  divider: { backgroundColor: CARD_BG_3, height: 1 },",
      "});",
    ].join("\n");
    assert.deepEqual(findEmptyStateWrapperOverrides("app/x.tsx", src), []);
  });

  it("does not trip on comments describing the pattern", () => {
    const src = [
      "// <View style={{ backgroundColor: CARD_BG_3 }}><EmptyState /></View>",
      "export const nothing = 1;",
    ].join("\n");
    assert.deepEqual(findEmptyStateWrapperOverrides("app/x.tsx", src), []);
  });

  it("formats findings with file:line and the offending value", () => {
    const report = formatEmptyStateWrapperReport([
      {
        file: "app/x.tsx",
        line: 5,
        background: "CARD_BG_3",
        source: "styles.card",
      },
    ]);
    assert.match(report, /app\/x\.tsx:5/);
    assert.match(report, /styles\.card/);
    assert.match(report, /CARD_BG_3/);
  });
});

describe("EmptyState wrapper audit — codebase sweep", () => {
  const files = sourceFiles("app", "components");

  it("finds the component and real callers to scan", () => {
    assert.ok(files.length > 10, "expected app/ + components/ sources");
    const callers = files.filter((f) => readSource(f).includes("<EmptyState"));
    assert.ok(
      callers.length >= 5,
      "expected several <EmptyState> call sites — did the component get renamed?",
    );
  });

  it("no caller wraps <EmptyState> in a custom-colored container", () => {
    const findings = files.flatMap((f) => findEmptyStateWrapperOverrides(f, readSource(f)));
    assert.deepEqual(
      findings,
      [],
      `\n${formatEmptyStateWrapperReport(findings)}`,
    );
  });

  it("CrashFallback's PAGE_BG_2 wrapper stays on the allowlist", () => {
    const src = readRepoFile("components/crash-fallback.tsx");
    assert.match(
      src,
      /backgroundColor:\s*PAGE_BG_2/,
      "CrashFallback wraps its EmptyState in a page-background stand-in",
    );
    assert.ok(
      ALLOWED_WRAPPER_BACKGROUNDS.some((rule) => rule.test("PAGE_BG_2")),
      "PAGE_BG_2 must stay allowlisted",
    );
    assert.deepEqual(
      findEmptyStateWrapperOverrides("components/crash-fallback.tsx", src),
      [],
    );
  });
});
