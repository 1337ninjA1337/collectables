/**
 * Clarity input-masking props shared by every text input in the app.
 *
 * Microsoft Clarity records the web DOM, including text typed into form
 * fields, unless the element carries `data-clarity-mask="True"` (or sits
 * inside a `class="ms-clarity-mask"` wrapper) — see
 * docs/analytics-platform.md "Privacy implications". react-native-web maps
 * the `dataSet` prop onto the element's `dataset`, so
 * `dataSet={{ clarityMask: "True" }}` renders as `data-clarity-mask="True"`
 * in the DOM. Native platforms ignore the unknown prop entirely, so the
 * spread is safe on iOS/Android bundles.
 *
 * Every `<TextInput` under `app/` and `components/` must spread these props
 * ({...CLARITY_MASK_PROPS}); `npm run lint:clarity-mask`
 * (scripts/check-clarity-mask.ts) enforces the convention in CI.
 *
 * Pure module: no React Native imports, node-testable.
 */

/** The DOM attribute Clarity looks for on masked elements. */
export const CLARITY_MASK_ATTRIBUTE = "data-clarity-mask";

/** The dataset key react-native-web maps to `data-clarity-mask`. */
export const CLARITY_MASK_DATASET_KEY = "clarityMask";

/**
 * Spread onto any text input so Clarity masks its contents in replays.
 * `as const` keeps the value literally `"True"` (Clarity's documented
 * casing) rather than widening to `string`.
 */
export const CLARITY_MASK_PROPS = {
  dataSet: { [CLARITY_MASK_DATASET_KEY]: "True" },
} as const;
