import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";
import { CurrencySheet } from "@/components/currency-sheet";
import { useAppTheme } from "@/components/use-app-theme";
import {
  BORDER,
  CARD_BG_2,
  HERO_DARK,
  MUTED_27,
  PLACEHOLDER,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD } from "@/lib/fonts";
import { CURRENCY_CHIPS, getDefaultCurrencyForLanguage } from "@/lib/locale-helpers";

export { getDefaultCurrencyForLanguage };

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const theme = useAppTheme();

  // Always show the active currency as a chip — even a non-shortlist pick (e.g.
  // HUF chosen via the full picker) so the selection stays visible.
  const chipCodes: string[] = (CURRENCY_CHIPS as readonly string[]).includes(currency)
    ? [...CURRENCY_CHIPS]
    : [currency, ...CURRENCY_CHIPS];

  return (
    <View style={styles.container}>
      <View style={{ ...styles.inputRow, backgroundColor: theme.card, borderColor: theme.border }}>
        <Text style={styles.currencySymbol}>{currency}</Text>
        <MaskedTextInput
          value={value}
          onChangeText={(raw) => onChangeValue(sanitize(raw))}
          placeholder={placeholder}
          placeholderTextColor={PLACEHOLDER}
          keyboardType="decimal-pad"
          style={{ ...styles.input, color: theme.text }}
          returnKeyType="done"
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {chipCodes.map((c) => {
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
        <Pressable
          style={[styles.chip, styles.moreChip]}
          onPress={() => {
            setQuery("");
            setSheetOpen(true);
          }}
          accessibilityLabel="More currencies"
        >
          <Ionicons name="ellipsis-horizontal" size={14} color={MUTED_27} />
        </Pressable>
      </ScrollView>

      <CurrencySheet
        visible={sheetOpen}
        selectedCode={currency}
        query={query}
        onQueryChange={setQuery}
        onSelect={(code) => {
          onChangeCurrency(code);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
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
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  currencySymbol: {
    color: MUTED_27,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  input: {
    flex: 1,
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
    borderColor: BORDER,
    backgroundColor: CARD_BG_2,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginRight: 6,
  },
  chipActive: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  moreChip: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  chipText: {
    color: MUTED_27,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  chipTextActive: {
    color: TEXT_ON_DARK_2,
  },
});
