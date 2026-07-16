import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";
import { CurrencySheet } from "@/components/currency-sheet";
import { ErrorPill } from "@/components/error-pill";
import { useAppTheme } from "@/components/use-app-theme";
import {
  BORDER,
  CARD_BG_2,
  HERO_DARK,
  MUTED_27,
  PLACEHOLDER,
  RADIUS_CARD,
  RADIUS_PILL,
  SPACING_INLINE,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD } from "@/lib/fonts";
import { CURRENCY_CHIPS, getCurrencySymbol, getDefaultCurrencyForLanguage } from "@/lib/locale-helpers";

export { getDefaultCurrencyForLanguage };

type CurrencyInputProps = {
  value: string;
  currency: string;
  onChangeValue: (v: string) => void;
  onChangeCurrency: (c: string) => void;
  placeholder?: string;
  /** Already-translated inline validation message; null/undefined hides the pill. */
  error?: string | null;
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
  error,
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
        {/* Glyph for the visual cue ($ / € / ₽); the code stays announced for screen readers. */}
        <Text style={styles.currencySymbol} accessibilityLabel={currency}>
          {getCurrencySymbol(currency)}
        </Text>
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
      <ErrorPill label={error ?? ""} />
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

/**
 * Why a value failed to parse. Deliberately the same vocabulary as
 * `InvalidPriceReason` (lib/analytics-helpers.ts) so the inline error a user
 * sees and the `listing_price_invalid.reason` the funnel records can never
 * disagree about what went wrong.
 */
export type CurrencyValueError = "empty" | "unparseable" | "non_positive";

export type ParsedCurrencyValue =
  | { value: number; error: null }
  | { value: null; error: CurrencyValueError };

/**
 * `parseCurrencyValue` with the failure reason attached, for callers that
 * surface inline errors instead of silently dropping the input. Gate order
 * mirrors `parseCurrencyValue` (empty → non-finite → <= 0) so the two can
 * never accept different values.
 */
export function parseCurrencyValueDetailed(value: string): ParsedCurrencyValue {
  if (!value.trim()) return { value: null, error: "empty" };
  const n = Number(value);
  if (!Number.isFinite(n)) return { value: null, error: "unparseable" };
  if (n <= 0) return { value: null, error: "non_positive" };
  return { value: n, error: null };
}

/**
 * i18n key per failure reason, so every form maps the shared error vocabulary
 * to the same three strings. Translation itself stays at the caller (`t()`).
 */
export const CURRENCY_ERROR_I18N_KEY = {
  empty: "currencyErrorEmpty",
  unparseable: "currencyErrorUnparseable",
  non_positive: "currencyErrorNonPositive",
} as const satisfies Record<CurrencyValueError, string>;

const styles = StyleSheet.create({
  container: {
    gap: SPACING_INLINE,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: RADIUS_CARD,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: SPACING_INLINE,
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
    borderRadius: RADIUS_PILL,
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
