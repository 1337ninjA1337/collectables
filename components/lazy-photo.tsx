import { memo, useState } from "react";
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from "react-native";

import { AMBER_MUTED_3 } from "@/lib/design-tokens";

type LazyPhotoProps = {
  /** Fully-resolved image URL (already routed through withCloudinaryThumbUrl). */
  uri: string;
  /** Geometry/border styles for the photo slot; the skeleton fills the same box. */
  style: StyleProp<ImageStyle>;
  /**
   * Shown when the photo fails to load — pass the item's deterministic
   * placeholderColor so a broken URL degrades to the same visual as "no photo"
   * instead of an empty rectangle.
   */
  fallbackColor: string;
};

/**
 * Remote photo with a loading skeleton and an error fallback. While the
 * request is in flight the slot renders as an AMBER_MUTED_3 skeleton (the
 * palette's image-placeholder tone); a failed load swaps to `fallbackColor`
 * permanently. True offscreen deferral (`priority="low"`) needs the
 * expo-image migration — see .tasks/.tasks.md — this shim only owns the
 * in-flight/error presentation on the existing RN Image.
 */
export const LazyPhoto = memo(function LazyPhoto({ uri, style, fallbackColor }: LazyPhotoProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  if (status === "error") {
    return <View style={[style, { backgroundColor: fallbackColor }]} />;
  }

  return (
    <View style={[style, styles.frame]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        onLoadStart={() => setStatus("loading")}
        onLoadEnd={() => setStatus("loaded")}
        onError={() => setStatus("error")}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  // The caller's style owns geometry (size, borderRadius); the frame adds the
  // skeleton tone underneath the image and clips it to the rounded corners.
  frame: {
    backgroundColor: AMBER_MUTED_3,
    overflow: "hidden",
  },
});
