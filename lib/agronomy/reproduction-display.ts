const NUMERIC_REPRODUCTIONS: Array<[RegExp, string]> = [
  [/^(?:1|1-я|i|r1|rs1|рс1|первая)(?:\s+репродукция)?$/i, "1"],
  [/^(?:2|2-я|ii|r2|rs2|рс2|вторая)(?:\s+репродукция)?$/i, "2"],
  [/^(?:3|3-я|iii|r3|rs3|рс3|третья)(?:\s+репродукция)?$/i, "3"],
  [/^(?:4|4-я|iv|r4|rs4|рс4|четвертая|четвёртая)(?:\s+репродукция)?$/i, "4"],
  [/^репродукция\s*(\d+)$/i, "$1"],
];

export function compactReproductionLabel(value?: string | null): string {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  if (!label) return "—";
  for (const [pattern, replacement] of NUMERIC_REPRODUCTIONS) {
    if (pattern.test(label)) return label.replace(pattern, replacement);
  }
  return label;
}

