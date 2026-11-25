export const PASTEL_COLORS = [
  "#fef3c7",
  "#dbeafe",
  "#dcfce7",
  "#fce7f3",
  "#f3e8ff",
  "#fed7aa",
  "#e0f2fe",
  "#fae8ff",
] as const;

export function isAllowedColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (PASTEL_COLORS as readonly string[]).includes(value)
  );
}

export function randomPastelColor() {
  return PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
}
