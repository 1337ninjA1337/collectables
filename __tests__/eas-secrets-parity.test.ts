import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Cross-artefact parity for build-time env vars. The same `EXPO_PUBLIC_*`
 * names live in three places that are maintained separately:
 *  - `.github/workflows/deploy.yml` — injected into the GitHub Pages web build;
 *  - `APPSTORE-SUBMISSION.md` section 14 — the `eas secret:create` commands
 *    that iOS/EAS builds rely on;
 *  - `eas.json` — may grow per-profile `env` blocks.
 * A var added to the web deploy but missed in the EAS list (or vice versa)
 * ships a build with silently-different behaviour; this suite catches the
 * drift in CI. README-DEPLOY.md remains the canonical documentation superset
 * (already enforced against `lib/*-config.ts` by runtime-config-parity).
 */

const root = process.cwd();
const deployYml = readFileSync(
  path.join(root, ".github", "workflows", "deploy.yml"),
  "utf8",
);
const guide = readFileSync(path.join(root, "APPSTORE-SUBMISSION.md"), "utf8");
const easJsonRaw = readFileSync(path.join(root, "eas.json"), "utf8");
const readmeDeploy = readFileSync(path.join(root, "README-DEPLOY.md"), "utf8");

/**
 * Vars injected by the web deploy that are deliberately NOT EAS secrets.
 * Each exemption carries its reason so a future reader can re-evaluate.
 */
const EAS_EXEMPT: Record<string, string> = {
  EXPO_PUBLIC_SENTRY_RELEASE:
    "workflow-derived (collectables@${{ github.sha }}), not a secret; on EAS " +
    "the @sentry/react-native/expo plugin derives the release itself",
  EXPO_PUBLIC_SENTRY_SOURCEMAPS:
    "workflow-derived (SENTRY_AUTH_TOKEN != '' gate), not a secret; on EAS " +
    "the @sentry/react-native/expo plugin uploads sourcemaps itself, so the " +
    "web-only diagnostics flag has no EAS counterpart",
};

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** EXPO_PUBLIC_* names the web deploy injects (env: blocks + validation loops). */
const deployVars = unique(
  deployYml.match(/EXPO_PUBLIC_[A-Z0-9_]+/g) ?? [],
);

/** Names registered via `eas secret:create --name <NAME>` in the guide. */
const easSecretNames = unique(
  [...guide.matchAll(/eas secret:create --scope project --name ([A-Z0-9_]+)/g)].map(
    (m) => m[1],
  ),
);
const easExpoPublic = easSecretNames.filter((n) =>
  n.startsWith("EXPO_PUBLIC_"),
);

describe("EAS secrets parity", () => {
  it("scanner sanity: both sources yield names", () => {
    assert.ok(
      deployVars.length >= 2,
      "deploy.yml scan found too few EXPO_PUBLIC_ vars — regex rot?",
    );
    assert.ok(
      easExpoPublic.length >= 5,
      "guide eas-secret scan found too few names — did section 14 move?",
    );
  });

  it("every web-deploy var is an EAS secret or explicitly exempt", () => {
    for (const name of deployVars) {
      if (name in EAS_EXEMPT) continue;
      assert.ok(
        easExpoPublic.includes(name),
        `${name} is injected in deploy.yml but has no 'eas secret:create' line in APPSTORE-SUBMISSION.md section 14 — iOS builds would miss it. Add the command (or an EAS_EXEMPT entry with a reason).`,
      );
    }
  });

  it("exemptions stay real: each exempt var is still in deploy.yml only", () => {
    for (const name of Object.keys(EAS_EXEMPT)) {
      assert.ok(
        deployVars.includes(name),
        `stale exemption: ${name} is no longer injected by deploy.yml`,
      );
      assert.ok(
        !easExpoPublic.includes(name),
        `stale exemption: ${name} is now an EAS secret — drop it from EAS_EXEMPT`,
      );
    }
  });

  it("every EXPO_PUBLIC_ EAS secret is documented in README-DEPLOY.md", () => {
    for (const name of easExpoPublic) {
      assert.ok(
        readmeDeploy.includes(name),
        `${name} is an EAS secret in APPSTORE-SUBMISSION.md but undocumented in README-DEPLOY.md`,
      );
    }
  });

  it("non-EXPO EAS secrets mirror the deploy workflow's sourcemap step", () => {
    const nonExpo = easSecretNames.filter(
      (n) => !n.startsWith("EXPO_PUBLIC_"),
    );
    assert.ok(nonExpo.length >= 3, "expected the SENTRY_* trio at minimum");
    for (const name of nonExpo) {
      assert.ok(
        deployYml.includes(name),
        `${name} is an EAS secret but never used in deploy.yml — is it still needed?`,
      );
    }
  });

  it("eas.json env blocks (if any) only use vars from the EAS-secret list", () => {
    const easJson = JSON.parse(easJsonRaw);
    const profiles: Record<string, unknown> = easJson.build ?? {};
    for (const [profile, config] of Object.entries(profiles)) {
      const env =
        config && typeof config === "object"
          ? (config as { env?: Record<string, unknown> }).env
          : undefined;
      if (!env) continue;
      for (const name of Object.keys(env)) {
        if (!name.startsWith("EXPO_PUBLIC_")) continue;
        assert.ok(
          easExpoPublic.includes(name) || name in EAS_EXEMPT,
          `eas.json build.${profile}.env.${name} is not in the guide's EAS-secret list`,
        );
      }
    }
  });

  it("anchors: the web-critical Supabase pair is in all sources", () => {
    for (const name of [
      "EXPO_PUBLIC_SUPABASE_URL",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]) {
      assert.ok(deployVars.includes(name), `${name} missing from deploy.yml`);
      assert.ok(
        easExpoPublic.includes(name),
        `${name} missing from the EAS-secret list`,
      );
      assert.ok(
        readmeDeploy.includes(name),
        `${name} missing from README-DEPLOY.md`,
      );
    }
  });
});
