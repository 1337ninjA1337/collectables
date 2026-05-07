import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const breadcrumbsSrc = readFileSync(
  path.join(process.cwd(), "components", "navigation-breadcrumbs.tsx"),
  "utf8",
);

const layoutSrc = readFileSync(
  path.join(process.cwd(), "app", "_layout.tsx"),
  "utf8",
);

describe("Crash #6 — NavigationBreadcrumbs component", () => {
  it("imports usePathname from expo-router", () => {
    assert.match(
      breadcrumbsSrc,
      /import\s*\{\s*usePathname\s*\}\s*from\s*["']expo-router["']/,
    );
  });

  it("imports addBreadcrumb from @/lib/sentry", () => {
    assert.match(
      breadcrumbsSrc,
      /import\s*\{\s*addBreadcrumb\s*\}\s*from\s*["']@\/lib\/sentry["']/,
    );
  });

  it("calls addBreadcrumb inside a useEffect keyed on pathname", () => {
    assert.match(
      breadcrumbsSrc,
      /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?addBreadcrumb\([\s\S]*?\)[\s\S]*?\}\s*,\s*\[\s*pathname\s*\]\s*\)/,
    );
  });

  it("renders nothing (returns null)", () => {
    assert.match(breadcrumbsSrc, /return\s+null;/);
  });

  it("dedupes consecutive identical pathnames via a previous ref", () => {
    assert.match(
      breadcrumbsSrc,
      /useRef[\s\S]*?previous\.current\s*===\s*pathname/,
      "must skip when pathname has not changed",
    );
  });

  it("includes from + to in breadcrumb data so flows are debuggable", () => {
    assert.match(breadcrumbsSrc, /from:\s*previous\.current/);
    assert.match(breadcrumbsSrc, /to:\s*pathname/);
  });
});

describe("Crash #6 — _layout.tsx mounts NavigationBreadcrumbs", () => {
  it("imports the component", () => {
    assert.match(
      layoutSrc,
      /import\s*\{\s*NavigationBreadcrumbs\s*\}\s*from\s*["']@\/components\/navigation-breadcrumbs["']/,
    );
  });

  it("renders <NavigationBreadcrumbs /> inside the AppShell tree", () => {
    assert.match(layoutSrc, /<NavigationBreadcrumbs\s*\/>/);
  });
});
