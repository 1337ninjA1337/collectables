import { LinearGradient } from "expo-linear-gradient";
import { PropsWithChildren } from "react";
import { Platform, RefreshControl, SafeAreaView, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { NestableScrollContainer } from "./DraggableList";

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
    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor="#8a5a2b" colors={["#8a5a2b"]} />
  ) : undefined;

  const innerStyle = contentMaxWidth
    ? { ...styles.scrollContent, maxWidth: contentMaxWidth, width: "100%" as const, alignSelf: "center" as const }
    : styles.scrollContent;

  const content = nestable ? (
    <NestableScrollContainer contentContainerStyle={innerStyle} refreshControl={refreshControl}>
      {children}
    </NestableScrollContainer>
  ) : scroll ? (
    <ScrollView contentContainerStyle={innerStyle} refreshControl={refreshControl}>
      {children}
    </ScrollView>
  ) : (
    <View style={innerStyle}>{children}</View>
  );

  return (
    <LinearGradient colors={["#f4ecdf", "#fffaf4", "#f4f1ea"]} style={styles.gradient}>
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
});
