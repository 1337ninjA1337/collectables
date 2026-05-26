import QRCode from "qrcode";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { HERO_DARK, PURE_WHITE, type BackgroundColorValue, type ColorValue } from "@/lib/design-tokens";

type QrCodeProps = {
  value: string;
  size?: number;
  color?: ColorValue;
  background?: BackgroundColorValue;
};

/**
 * Pure-JS QR renderer: uses the `qrcode` library to build a module matrix,
 * then draws it with nested Views. No native dependency required — works on
 * iOS, Android and Web alike.
 */
export function QrCode({ value, size = 240, color = HERO_DARK, background = PURE_WHITE }: QrCodeProps) {
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
      const modules = qr.modules;
      const count = modules.size;
      const rows: boolean[][] = [];
      for (let y = 0; y < count; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < count; x++) {
          row.push(Boolean(modules.get(y, x)));
        }
        rows.push(row);
      }
      return rows;
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) {
    return <View style={{ width: size, height: size, backgroundColor: background }} />;
  }

  const count = matrix.length;
  const cellSize = size / count;

  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor: background }]}>
      {matrix.map((row, y) => (
        <View key={y} style={styles.row}>
          {row.map((filled, x) => (
            <View
              key={x}
              style={{
                width: cellSize,
                height: cellSize,
                backgroundColor: filled ? color : background,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 0,
  },
  row: {
    flexDirection: "row",
  },
});
