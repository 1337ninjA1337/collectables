/**
 * Node-loadable stand-in for `@expo/vector-icons`.
 *
 * The real package's `createIconSet.js` is untranspiled JSX inside a `.js`
 * file, so esbuild bails with "The JSX syntax extension is not currently
 * enabled" the moment anything under `components/` is imported. Aliasing the
 * specifier onto this file is what makes those modules loadable at all.
 *
 * Each icon family is a bare host-component string, so `<Ionicons name="x" />`
 * renders as a tree node of type `"Ionicons"` whose `name`/`size`/`color`
 * props can be asserted directly. They are deliberately NOT objects carrying a
 * `glyphMap`: a string primitive is what `typeof type === "string"` (the
 * renderer's host-element test) needs, and `Object.assign`-ing a property onto
 * one would box it into a `String` object and break that check. The
 * `keyof typeof Ionicons.glyphMap` icon-name props across the app are resolved
 * by `tsc` against the REAL package's types — this file is only ever loaded at
 * test runtime — so nothing reads `glyphMap` in a Node render.
 */

export const Ionicons = "Ionicons";
export const MaterialIcons = "MaterialIcons";
export const MaterialCommunityIcons = "MaterialCommunityIcons";
export const FontAwesome = "FontAwesome";
export const Feather = "Feather";
export const AntDesign = "AntDesign";

export default {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  FontAwesome,
  Feather,
  AntDesign,
};
