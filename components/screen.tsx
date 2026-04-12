import { LinearGradient } from "expo-linear-gradient";
import { PropsWithChildren } from "react";
import { RefreshControl, SafeAreaView, ScrollView, StyleSheet, View } from "react-native";
import { NestableScrollContainer } from "./DraggableList";

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  nestable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}>;

export function Screen({ children, scroll = true, nestable = false, refreshing, onRefresh }: ScreenProps) {
  const refreshControl = onRefresh ? (
    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor="#8a5a2b" colors={["#8a5a2b"]} />
  ) : undefined;

  const content = nestable ? (
    <NestableScrollContainer contentContainerStyle={styles.scrollContent} refreshControl={refreshControl}>
      {children}
    </NestableScrollContainer>
  ) : scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={refreshControl}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.scrollContent}>{children}</View>
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
