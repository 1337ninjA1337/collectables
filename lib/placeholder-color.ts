/**
 * Returns a deterministic warm-palette color based on a string ID.
 * Same ID always produces the same color.
 */

const PALETTE = [
  "#8B6F5E", // warm brown
  "#A0785A", // caramel
  "#7A6B5D", // taupe
  "#6B7D6A", // sage
  "#8B7355", // khaki brown
  "#6D8B8A", // muted teal
  "#9B7A5B", // amber
  "#7B6880", // dusty mauve
  "#8A7E6B", // olive tan
  "#6B7B8B", // slate blue
  "#8B6B6B", // rosewood
  "#7A8B6B", // moss
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function placeholderColor(id: string): string {
  return PALETTE[hashCode(id) % PALETTE.length];
}
