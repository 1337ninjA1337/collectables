/**
 * Sentry SDK version-drift scanner used by `scripts/check-sentry-version.ts`
 * and its tests.
 *
 * Pure module: no filesystem access. The CLI wrapper reads package.json and
 * package-lock.json and passes the relevant strings here so the rules can be
 * unit-tested under `node --test` without mocking `fs`.
 *
 * Why: `lib/sentry.ts` lazy-loads `@sentry/react-native` and depends on its
 * config shape, which Sentry has rewritten on every major since 5.0. The
 * declared tilde range (`~7.5.0`) is fine, but nothing stopped a fresh
 * `npm install` (or a hand-edited range) from silently jumping majors. This
 * guard fails CI when the declared range leaves the pinned major or the
 * lockfile drifts outside the declared range's major.
 */

/** The major version `lib/sentry.ts` is written against. */
export const EXPECTED_SENTRY_MAJOR = 7;

/** Extract the major version from a range like `~7.5.0`, `^7.5.0`, `7.5.0`. */
export function majorOfRange(range: string): number | null {
  const m = range.trim().match(/^[~^]?(\d+)\./);
  return m ? Number(m[1]) : null;
}

/** Extract the major version from an exact version like `7.5.2`. */
export function majorOfVersion(version: string): number | null {
  const m = version.trim().match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

export interface SentryVersionInput {
  /** The range declared in package.json dependencies. */
  declaredRange: string | undefined;
  /** The exact version resolved in package-lock.json. */
  lockedVersion: string | undefined;
}

/** Validate the declared range and locked version. Sorted issue list. */
export function findSentryVersionIssues(input: SentryVersionInput): string[] {
  const issues: string[] = [];

  if (!input.declaredRange) {
    issues.push(
      "package.json no longer declares @sentry/react-native in dependencies",
    );
  } else {
    const declaredMajor = majorOfRange(input.declaredRange);
    if (declaredMajor === null) {
      issues.push(
        `cannot parse a major version from the declared range '${input.declaredRange}' — use a ~x.y.z / ^x.y.z / x.y.z range`,
      );
    } else if (declaredMajor !== EXPECTED_SENTRY_MAJOR) {
      issues.push(
        `declared range '${input.declaredRange}' targets major ${declaredMajor}, but lib/sentry.ts is written against major ${EXPECTED_SENTRY_MAJOR} — audit the SDK's config-shape changes and bump EXPECTED_SENTRY_MAJOR in lib/check-sentry-version.ts deliberately`,
      );
    }
  }

  if (!input.lockedVersion) {
    issues.push(
      "package-lock.json has no entry for node_modules/@sentry/react-native — run npm install",
    );
  } else {
    const lockedMajor = majorOfVersion(input.lockedVersion);
    if (lockedMajor === null) {
      issues.push(
        `cannot parse the locked version '${input.lockedVersion}'`,
      );
    } else if (lockedMajor !== EXPECTED_SENTRY_MAJOR) {
      issues.push(
        `lockfile resolves @sentry/react-native@${input.lockedVersion} (major ${lockedMajor}), expected major ${EXPECTED_SENTRY_MAJOR}`,
      );
    }
  }

  return issues.sort();
}
