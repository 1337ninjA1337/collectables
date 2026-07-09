/**
 * Shared typed helper for the `readFooEnvFromProcess()` pattern used by
 * `lib/sentry-config.ts`, `lib/analytics-config.ts` and
 * `lib/cloudinary-config.ts`.
 *
 * Metro / babel-preset-expo only inlines `process.env.EXPO_PUBLIC_*` when the
 * access is a *literal member expression* in source, so a fully dynamic
 * `readExpoPublicEnv(names)` that loops `process.env[name]` can never work —
 * the bundle would read `undefined` for every key (and `lint:env-inlining`
 * rejects the pattern). What CAN be shared is the parity contract: each
 * config module declares its supported var names once as a `const` tuple and
 * supplies the literal-access object; this factory makes the compiler reject
 * a missing/extra/typo'd key in either half, and adds a defensive runtime
 * check behind it. Adding a new EXPO_PUBLIC_ var is then a two-line,
 * un-typo-able change (one tuple entry + one literal line).
 *
 * Pure module: no React Native imports, unit-testable under `node --test`.
 */

export type ExpoPublicVarName = `EXPO_PUBLIC_${string}`;

/** The exact env-object shape for a declared tuple of var names. */
export type ExpoPublicEnv<Names extends readonly ExpoPublicVarName[]> = {
  [K in Names[number]]: string | undefined;
};

// One-shot guard so a parity bug surfaces once per module, not once per call.
const warnedReaders = new Set<string>();

export function __resetExpoPublicEnvWarningsForTests(): void {
  warnedReaders.clear();
}

/**
 * Builds a `readFooEnvFromProcess`-style reader from a declared name tuple
 * and a literal-access producer. The producer MUST reference each
 * `process.env.EXPO_PUBLIC_*` var literally (Metro inlining); the tuple/type
 * plumbing enforces that both halves declare exactly the same keys at
 * compile time. The runtime key-diff is a backstop for `as`-cast escapes:
 * it warns (never throws — a parity bug must not brick app startup) and
 * still returns the producer's object.
 */
export function makeExpoPublicEnvReader<
  const Names extends readonly ExpoPublicVarName[],
>(
  moduleLabel: string,
  names: Names,
  readLiterals: () => ExpoPublicEnv<Names>,
): () => ExpoPublicEnv<Names> {
  return () => {
    const env = readLiterals();
    const actual = Object.keys(env).sort();
    const declared = [...names].sort();
    const mismatch =
      actual.length !== declared.length ||
      actual.some((key, i) => key !== declared[i]);
    if (mismatch && !warnedReaders.has(moduleLabel)) {
      warnedReaders.add(moduleLabel);
      console.warn(
        `[expo-public-env] ${moduleLabel}: declared var names [${declared.join(", ")}] ` +
          `do not match the keys read from process.env [${actual.join(", ")}] — ` +
          "update the tuple and the literal-access object together.",
      );
    }
    return env;
  };
}
