type CropLegendItem = {
  key: string;
  label: string;
  color: string;
  aliases: string[];
};

export const CROP_COLOR_LEGEND: CropLegendItem[] = [
  { key: "potato", label: "Картофель", color: "#d97706", aliases: ["картофель", "картошка", "potato"] },
  { key: "wheat", label: "Пшеница", color: "#facc15", aliases: ["пшеница", "wheat"] },
  { key: "carrot", label: "Морковь", color: "#f97316", aliases: ["морковь", "carrot"] },
  { key: "barley", label: "Ячмень", color: "#eab308", aliases: ["ячмень", "barley"] },
  { key: "oats", label: "Овёс", color: "#84cc16", aliases: ["овес", "овёс", "oats"] },
  { key: "corn", label: "Кукуруза", color: "#22c55e", aliases: ["кукуруза", "corn"] },
  {
    key: "perennial",
    label: "Многолетние травы",
    color: "#16a34a",
    aliases: ["многолетние травы", "травы", "perennial", "forage"],
  },
  { key: "fallow", label: "Пар / нет культуры", color: "#64748b", aliases: ["пар", "fallow", "нет культуры"] },
  { key: "unknown", label: "Неизвестно", color: "#475569", aliases: [] },
];

function normalize(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/gu, " ");
}

export function resolveCropColor(cropName: string | null | undefined): string {
  const token = normalize(cropName);
  if (!token) return CROP_COLOR_LEGEND.find((item) => item.key === "unknown")?.color || "#475569";

  for (const item of CROP_COLOR_LEGEND) {
    if (item.aliases.some((alias) => token.includes(alias))) {
      return item.color;
    }
  }

  return CROP_COLOR_LEGEND.find((item) => item.key === "unknown")?.color || "#475569";
}
