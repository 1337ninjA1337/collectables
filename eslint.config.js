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
 * ## Why it is not a `verify` leg yet
 *
 * `verify` chains nine steps and `verify-gate-script.test.ts` reads that list
 * out of ci.yml, so a tenth is a decision rather than an addition. This config
 * is the piece that had to exist before the decision could be argued, and the
 * argument is in `.tasks/.tasks.md` under the third piece. Until then `npm run
 * lint` is a report, like `bundle:composition` and `bundle:native` — runnable,
 * reproducible, and gating nothing.
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
