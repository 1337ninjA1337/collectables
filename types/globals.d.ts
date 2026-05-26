/**
 * Project-wide ambient type declarations.
 *
 * `__DEV__` is injected by Metro / React Native at bundle time. Declaring it
 * here lets any module reference it without the
 * `(globalThis as { __DEV__?: boolean }).__DEV__` cast that two call sites
 * previously had to roll. Strictly typed as `boolean` (Metro guarantees the
 * variable exists in both dev and prod bundles), so misspelled accesses
 * (e.g. `__dev__`) become TypeScript errors.
 */
declare const __DEV__: boolean;
