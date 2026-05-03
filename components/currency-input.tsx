import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { FONT_BODY, FONT_BODY_BOLD } from "@/lib/fonts";

const CURRENCIES = ["USD", "EUR", "GBP", "RUB", "BYN", "PLN", "UAH", "CHF", "JPY", "CNY"];

const LANGUAGE_CURRENCY: Record<string, string> = {
  ru: "RUB",
  be: "BYN",
  de: "EUR",
  pl: "PLN",
  es: "EUR",
  en: "USD",
};

export function getDefaultCurrencyForLanguage(language: string): string {
  return LANGUAGE_CURRENCY[language] ?? "USD";
}

type CurrencyInputProps = {
  value: string;
  currency: string;
  onChangeValue: (v: string) => void;
  onChangeCurrency: (c: string) => void;
  placeholder?: string;
};

function sanitize(raw: string): string {
  // Normalise comma decimal separator and strip everything except digits and one dot.
  const normalised = raw.replace(",", ".");
  const stripped = normalised.replace(/[^0-9.]/g, "");
  // Keep only the first dot.
  const parts = stripped.split(".");
  if (parts.length <= 2) return stripped;
  return parts[0] + "." + parts.slice(1).join("");
}

export function CurrencyInput({
  value,
  currency,
  onChangeValue,
  onChangeCurrency,
  placeholder = "0.00",
}: CurrencyInputProps) {
  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <Text style={styles.currencySymbol}>{currency}</Text>
        <TextInput
          value={value}
          onChangeText={(raw) => onChangeValue(sanitize(raw))}
          placeholder={placeholder}
          placeholderTextColor="#9b8571"
          keyboardType="decimal-pad"
          style={styles.input}
          returnKeyType="done"
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {CURRENCIES.map((c) => {
          const active = c === currency;
          return (
            <Pressable
              key={c}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onChangeCurrency(c)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Parse the sanitized string to a positive number, or return null if invalid.
 */
export function parseCurrencyValue(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  currencySymbol: {
    color: "#5a4030",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  input: {
    flex: 1,
    color: "#2f2318",
    fontSize: 16,
    fontFamily: FONT_BODY,
    padding: 0,
  },
  chips: {
    flexGrow: 0,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#eadbc8",
    backgroundColor: "#fff7ef",
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginRight: 6,
  },
  chipActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  chipText: {
    color: "#5a4030",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  chipTextActive: {
    color: "#fff5ea",
  },
});
