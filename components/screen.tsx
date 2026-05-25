import { LinearGradient } from "expo-linear-gradient";
import { PropsWithChildren } from "react";
import { Platform, RefreshControl, SafeAreaView, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { NestableScrollContainer } from "./DraggableList";

import { ACCENT_DEEP, CARD_BG_7, PAGE_BG_2, PAGE_BG_3 } from "@/lib/design-tokens";

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
    <LinearGradient colors={[CARD_BG_7, PAGE_BG_2, PAGE_BG_3]} style={styles.gradient}>
      <SafeAreaView style={styles.safeArea}>{content}</SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
    gap: 18,
  },
  fillContent: {
    flex: 1,
  },
});
