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
 * `lint:eslint-gate` fails the run on six rules the tree was driven to zero
 * for — three React-correctness rules, plus the three read on 2026-10-03 — and
 * counts every other rule on every run so the number stays visible. Which six,
 * and why not the rest, is in `lib/eslint-gate.ts`.
 *
 * A second list joined it the same day: four zeroed rules, held at zero for
 * what clearing them cost rather than for anything that breaks. `array-type`
 * is the largest of the three and the reason the list exists — 26 findings
 * `eslint --fix` took in one diff, in a population that had grown by one while
 * the argument about whether to gate it was being written.
 *
 * `npm run lint` itself stays a report — the whole report, unfiltered, like
 * `bundle:composition` and `bundle:native`. The gate is the part somebody has
 * committed to keeping at zero.
 *
 * ## The one rule option this file sets
 *
 * `@typescript-eslint/no-unused-vars` was 108 warnings on 2026-10-01 and 101
 * of them were imports left behind by a refactor — `join` forty times,
 * `path` twenty-two, in suites that moved to `readRepoFile` and never dropped
 * the import. Deleting those needed no argument. What was left was seven
 * bindings, six of them dead and one DELIBERATE: `jsxReach` walks for its
 * side effect and names the value it does not read `_tag`. The underscore
 * prefix is how that intent is spelled, and without these patterns it is
 * spelled the same way as a mistake.
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
    // The plugin is named again here rather than inherited: a flat-config
    // object may only set a rule whose plugin IT declares, and
    // `eslint-config-expo/flat` declares this one inside objects of its own.
    plugins: { "@typescript-eslint": require("@typescript-eslint/eslint-plugin") },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
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
