import { Stack } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { AppLanguage, useI18n } from "@/lib/i18n-context";

export default function SettingsScreen() {
  const { t, language, setLanguage, languageOptions } = useI18n();

  return (
    <Screen>
      <Stack.Screen options={{ title: t("settings") }} />

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("settings")}</Text>
        <Text style={styles.title}>{t("settingsTitle")}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("language")}</Text>
        <Text style={styles.sectionText}>{t("languageSubtitle")}</Text>
        <View style={styles.languageRow}>
          {languageOptions.map((option) => (
            <Pressable
              key={option.code}
              style={{...styles.languageChip, ...(language === option.code ? styles.languageChipActive : {})}}
              onPress={() => void setLanguage(option.code as AppLanguage)}
            >
              <Text style={{...styles.languageChipText, ...(language === option.code ? styles.languageChipTextActive : {})}}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: "#261b14",
    borderRadius: 32,
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    color: "#f5c99a",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  title: {
    color: "#fff8ef",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
  },
  card: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#2f2318",
  },
  sectionText: {
    color: "#6b5647",
    lineHeight: 22,
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  languageChip: {
    borderRadius: 999,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  languageChipActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  languageChipText: {
    color: "#2a1d15",
    fontWeight: "700",
  },
  languageChipTextActive: {
    color: "#fff4e8",
  },
});
