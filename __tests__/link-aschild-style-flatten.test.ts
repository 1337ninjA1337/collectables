import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression guard for the web-only crash:
 *
 *   TypeError: Failed to set an indexed property [0] on 'CSSStyleDeclaration':
 *   Indexed property setter is not supported.
 *
 * `<Link asChild>` from expo-router renders its child through Radix's `Slot`
 * (see `expo-router/build/ui/Slot.js` → `@radix-ui/react-slot`). `Slot`'s
 * `mergeProps` merges the two `style` props with a PLAIN OBJECT SPREAD:
 *
 *   overrideProps.style = { ...slotPropValue, ...childPropValue }
 *
 * That is fine for an object style, but spreading an ARRAY turns the positional
 * entries into numeric keys — `{0: {...}, 1: {...}}`. react-native-web then
 * forwards those keys to the DOM node's inline style, React DOM runs
 * `node.style["0"] = …`, and `CSSStyleDeclaration` throws because its indexed
 * properties are read-only. On the deployed web build that took down the whole
 * app: every collection screen rendered the root error boundary instead of the
 * item grid.
 *
 * So: the direct child of `<Link asChild>` must never receive a bare array
 * `style={[…]}`. Wrap it in `StyleSheet.flatten([...])` (or use an object
 * literal) so `Slot` spreads a flat object.
 */

const repoRoot = path.join(__dirname, "..");
const SCAN_DIRS = ["app", "components"];

function collectTsxFiles(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsxFiles(rel));
    else if (entry.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/**
 * Every `style={[` that appears on the direct child element of a `<Link …
 * asChild>` opening tag. The child element is the first JSX tag opened after
 * the `asChild` link tag closes, so we scan forward from `asChild` until that
 * tag's own `>` — which is exactly the window a `style=` prop can live in.
 */
function findArrayStylesUnderAsChild(source: string): string[] {
  const hits: string[] = [];
  const linkOpen = /<Link\b[^>]*\basChild\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = linkOpen.exec(source)) !== null) {
    const after = source.slice(m.index + m[0].length);
    // First JSX element opened after the <Link …> tag.
    const childStart = after.search(/<[A-Za-z]/);
    if (childStart === -1) continue;
    const childTagEnd = after.indexOf(">", childStart);
    if (childTagEnd === -1) continue;
    const childTag = after.slice(childStart, childTagEnd + 1);
    if (/\bstyle=\{\[/.test(childTag)) {
      const line = source.slice(0, m.index + m[0].length + childStart).split("\n").length;
      hits.push(`line ${line}: ${childTag.split("\n")[0].trim().slice(0, 120)}`);
    }
  }
  return hits;
}

describe("findArrayStylesUnderAsChild", () => {
  it("flags the exact shape that shipped the crash", () => {
    // The pre-fix `components/item-card.tsx`, verbatim.
    const before = `
      <Link href={\`/item/\${item.id}\`} asChild>
        <Pressable style={[styles.card, { backgroundColor: theme.card }, SHADOW_SOFT, style]}>
      </Link>`;
    assert.equal(findArrayStylesUnderAsChild(before).length, 1);
  });

  it("accepts the flattened and object-literal forms", () => {
    const flattened = `
      <Link href="/x" asChild>
        <Pressable style={StyleSheet.flatten([styles.card, style])}>
      </Link>`;
    const objectLiteral = `
      <Link href="/x" asChild>
        <Pressable style={{ ...styles.card, backgroundColor: "red" }}>
      </Link>`;
    assert.deepEqual(findArrayStylesUnderAsChild(flattened), []);
    assert.deepEqual(findArrayStylesUnderAsChild(objectLiteral), []);
  });

  it("ignores array styles that are not the Link's direct child", () => {
    const nested = `
      <Link href="/x" asChild>
        <Pressable style={StyleSheet.flatten([styles.card])}>
          <View style={[styles.inner, { flex: 1 }]} />
        </Pressable>
      </Link>`;
    assert.deepEqual(findArrayStylesUnderAsChild(nested), []);
  });
});

describe("<Link asChild> style merging", () => {
  it("no direct child of <Link asChild> passes a bare array style", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const rel of collectTsxFiles(dir)) {
        const source = fs.readFileSync(path.join(repoRoot, rel), "utf8");
        for (const hit of findArrayStylesUnderAsChild(source)) {
          offenders.push(`${rel} ${hit}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "Radix Slot spreads the child's style with `{...slotStyle, ...childStyle}`, " +
        "so an array style becomes {0:…,1:…} and react-native-web crashes the web " +
        "build with \"Failed to set an indexed property [0] on 'CSSStyleDeclaration'\". " +
        "Wrap these in StyleSheet.flatten([...]):\n  " +
        offenders.join("\n  "),
    );
  });

  // Only the OUTER Pressable of each branch is the direct child of
  // `<Link asChild>` and therefore goes through Radix's Slot merge. The card
  // also nests a Pressable around the art window (it opens the gallery instead
  // of navigating) — that one is an ordinary child and needs no flattening, so
  // the assertion targets the two Slot-merged tags rather than every Pressable
  // in the file. The repo-wide `findArrayStylesUnderAsChild` scan above is what
  // guards the general shape.
  it("item-card keeps its forwarded style flattened on both Link children", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "components/item-card.tsx"),
      "utf8",
    );
    assert.equal(
      findArrayStylesUnderAsChild(source).length,
      0,
      "no bare array style may reach a <Link asChild> child in item-card.tsx",
    );
    const flattened = source.match(/<Pressable style=\{StyleSheet\.flatten\(\[/g) ?? [];
    assert.equal(
      flattened.length,
      2,
      `expected both the compact and full cards to flatten their forwarded style, got ${flattened.length}`,
    );
  });
});

describe("Radix Slot style-merge semantics", () => {
  /** Verbatim copy of `mergeProps`' style branch in @radix-ui/react-slot. */
  const slotMergeStyle = (slotStyle: unknown, childStyle: unknown) => ({
    ...(slotStyle as object),
    ...(childStyle as object),
  });

  const hasNumericKey = (o: object) => Object.keys(o).some((k) => /^\d+$/.test(k));

  it("spreading an array style produces the numeric keys that crash the DOM", () => {
    const merged = slotMergeStyle(undefined, [{ margin: 1 }, { padding: 2 }]);
    assert.ok(
      hasNumericKey(merged),
      "this is the failure mode the guard above exists to prevent",
    );
  });

  it("spreading a flattened style stays a plain, DOM-safe object", () => {
    // What StyleSheet.flatten([{margin:1},{padding:2}]) yields.
    const merged = slotMergeStyle(undefined, { margin: 1, padding: 2 });
    assert.equal(hasNumericKey(merged), false);
    assert.deepEqual(merged, { margin: 1, padding: 2 });
  });
});
