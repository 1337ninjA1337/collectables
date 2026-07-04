import { forwardRef } from "react";
import { Platform, TextInput, type TextInputProps } from "react-native";

/**
 * Drop-in replacement for react-native's `TextInput` that stamps the
 * Microsoft Clarity masking attribute (`data-clarity-mask="True"`) onto the
 * rendered DOM node on web, so session replays never capture what the user
 * types (see docs/analytics-platform.md "mask every input" requirement).
 *
 * On native platforms the extra prop is omitted — Clarity only runs on web.
 *
 * `scripts/check-clarity-input-mask.ts` (`npm run lint:clarity-mask`) fails
 * CI when a raw `<TextInput` / `<input` is used anywhere under `app/` or
 * `components/`, so always reach for this wrapper instead. This file is the
 * one allowed raw-`<TextInput` site.
 */

// react-native-web renders `dataSet` keys verbatim as `data-<key>`
// attributes; the key must therefore already be hyphenated. `dataSet` is a
// web-only prop absent from the RN core types, hence the cast.
const clarityMaskProps = Platform.select<Partial<TextInputProps>>({
  web: { dataSet: { "clarity-mask": "True" } } as Partial<TextInputProps>,
  default: {},
});

export const MaskedTextInput = forwardRef<TextInput, TextInputProps>(
  function MaskedTextInput(props, ref) {
    return <TextInput ref={ref} {...props} {...clarityMaskProps} />;
  },
);
