// @ts-check
/**
 * The tenth toolchain, written down rather than generated.
 *
 * `npm run lint` has been `expo lint` since this repository was created and
 * had never been run here: with no config in the tree, `expo lint` reaches the
 * Expo registry to work out which ESLint packages to install, and the dev
 * sandbox cannot reach it — the same wall `check-expo-install` already pins
 * versions by hand to get around. So the command existed, was documented, and
 * answered nothing.
 *
 * ## What this covers that the nine gate legs do not
 *
 * Every rule in `lib/lint-guards.ts` is a TEXT rule. That is a deliberate
 * design and it is stated in half those modules: a scan matches a shape, it
 * never resolves a scope, and the ones that would need to (`check-latest-ref`
 * says so in its own header) refuse the question rather than answer nine
 * tenths of it. ESLint parses. The rules worth having here are exactly the
 * ones a scan declines: whether a `.current` read is in a render body or in a
 * callback, whether a hook is called conditionally, whether a dependency array
 * is complete.
 *
 * ## Part of it gates, and the split is the decision
 *
 * `verify` chained nine steps when this landed, and `verify-gate-script.test.ts`
 * reads that list out of ci.yml, so a tenth was a decision rather than an
 * addition. It was argued on 2026-09-27 and the answer is a NAMED SUBSET:
 * `lint:eslint-gate` fails the run on three React-correctness rules the tree
 * was driven to zero for, and counts every other rule on every run so the
 * number stays visible. Which three, and why not the rest, is in
 * `lib/eslint-gate.ts`.
 *
 * `npm run lint` itself stays a report — the whole 200 findings, unfiltered,
 * like `bundle:composition` and `bundle:native`. The gate is the part somebody
 * has committed to keeping at zero.
 *
 * ## The scope
 *
 * The application source and the suites. `dist/` is build output and `.expo/`
 * is a cache; both would otherwise be linted at several thousand files each,
 * which is how a lint run becomes something nobody waits for.
 */
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  {
    ignores: ["dist/*", ".expo/*", "node_modules/*", "supabase/functions/*"],
  },
  {
    // The two CommonJS files in the tree. Expo's config assumes a React Native
    // module — browser and React Native globals, ES modules — and `__dirname`
    // is undefined in all of them, so `scripts/serve-dist.js` reported a
    // `no-undef` that is a fact about this config rather than about the file.
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { __dirname: "readonly", module: "writable", require: "readonly" } },
  },
];
