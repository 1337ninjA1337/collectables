import { PropsWithChildren } from "react";
import { Platform, RefreshControl, SafeAreaView, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { NestableScrollContainer } from "./DraggableList";

import { useAppTheme } from "@/components/use-app-theme";
import { ACCENT_DEEP, SPACING_AIRY, SPACING_GUTTER } from "@/lib/design-tokens";

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  nestable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}>;

export function useResponsive() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isMobile = !isWeb || width < 600;
  const isTablet = isWeb && width >= 600 && width < 1024;
  const isDesktop = isWeb && width >= 1024;
  const contentMaxWidth = isDesktop ? 860 : isTablet ? 680 : undefined;
  return { width, isMobile, isTablet, isDesktop, contentMaxWidth };
}

export function Screen({ children, scroll = true, nestable = false, refreshing, onRefresh }: ScreenProps) {
  const { contentMaxWidth } = useResponsive();
  const theme = useAppTheme();

  const refreshControl = onRefresh ? (
    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={ACCENT_DEEP} colors={[ACCENT_DEEP]} />
  ) : undefined;

  const innerStyle = contentMaxWidth
    ? { ...styles.scrollContent, maxWidth: contentMaxWidth, width: "100%" as const, alignSelf: "center" as const }
    : styles.scrollContent;

  // When scroll=false the inner View must fill the SafeAreaView so a
  // virtualized list (FlatList/SectionList) inside can size its viewport and
  // recycle off-screen rows. Without `flex: 1` the View would shrink to its
  // intrinsic size and the nested FlatList would have height 0.
  const staticInnerStyle = [innerStyle, styles.fillContent];

  const content = nestable ? (
    <NestableScrollContainer contentContainerStyle={innerStyle} refreshControl={refreshControl}>
      {children}
    </NestableScrollContainer>
  ) : scroll ? (
    <ScrollView contentContainerStyle={innerStyle} refreshControl={refreshControl}>
      {children}
    </ScrollView>
  ) : (
    <View style={staticInnerStyle}>{children}</View>
  );

  return (
    <View style={{ ...styles.page, backgroundColor: theme.page }}>
      <SafeAreaView style={styles.safeArea}>{content}</SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING_GUTTER,
    paddingBottom: 32,
    gap: SPACING_AIRY,
  },
  fillContent: {
    flex: 1,
  },
});
