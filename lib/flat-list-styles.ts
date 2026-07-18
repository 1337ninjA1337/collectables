import { StyleSheet } from "react-native";

import { SPACING_LIST } from "@/lib/design-tokens";

/**
 * Shared styles for the "screen-owning FlatList" pattern VM-D established on
 * `app/collection/[id].tsx`: a `<FlatList>` rendered directly inside
 * `<Screen scroll={false}>` so virtualization can recycle off-screen rows.
 * Lifted here so every screen adopting the pattern (wishlist, collections
 * feed, future profile lists) imports one module instead of copying the two
 * style entries.
 */
export const flatListStyles = StyleSheet.create({
  // The FlatList itself owns the scroll — flex:1 so it fills the Screen's
  // inner View vertically (the inner View is flex:1 when scroll=false).
  viewerFlatList: {
    flex: 1,
  },
  // The Screen's inner View (scroll=false) already pads 20px / 32 on bottom
  // around the FlatList, so contentContainerStyle adds only the row gap.
  // Mirrors the 10px row gap of the pre-VM-D inline masonry FlatList so the
  // visual rhythm is preserved.
  viewerFlatListContent: {
    gap: SPACING_LIST,
  },
});
