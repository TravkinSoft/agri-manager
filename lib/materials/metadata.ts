export const MATERIAL_RATE_BASIS = [
  "per_ha",
  "per_1000_l_solution",
  "per_l_water",
  "per_t_seed",
  "per_100kg_seed",
  "per_1000_seeds",
  "manual",
] as const;

export type MaterialRateBasis = (typeof MATERIAL_RATE_BASIS)[number];
export type LegacyMaterialRateBasis = "per_t_solution";
export type MaterialRateBasisInput = MaterialRateBasis | LegacyMaterialRateBasis | string | null | undefined;

export const MATERIAL_RATE_BASIS_LABELS_RU: Record<MaterialRateBasis, string> = {
  per_ha: "На гектар",
  per_1000_l_solution: "На 1000 л раствора",
  per_l_water: "На литр воды",
  per_t_seed: "На тонну семян",
  per_100kg_seed: "На 100 кг семян",
  per_1000_seeds: "На 1000 семян",
  manual: "Вручную",
};

export const MATERIAL_RATE_BASIS_UNIT_LABELS_RU: Record<MaterialRateBasis, Record<string, string>> = {
  per_ha: {
    l: "л/га",
    ml: "мл/га",
    kg: "кг/га",
    g: "г/га",
    pcs: "шт/га",
  },
  per_1000_l_solution: {
    l: "л/1000 л",
    ml: "мл/1000 л",
    kg: "кг/1000 л",
    g: "г/1000 л",
    pcs: "шт/1000 л",
  },
  per_l_water: {
    l: "мл/л",
    ml: "мл/л",
    kg: "г/л",
    g: "г/л",
  },
  per_t_seed: {
    l: "л/т семян",
    ml: "мл/т семян",
    kg: "кг/т семян",
    g: "г/т семян",
  },
  per_100kg_seed: {
    l: "л/100 кг семян",
    ml: "мл/100 кг семян",
    kg: "кг/100 кг семян",
    g: "г/100 кг семян",
  },
  per_1000_seeds: {
    l: "л/1000 семян",
    ml: "мл/1000 семян",
    kg: "кг/1000 семян",
    g: "г/1000 семян",
  },
  manual: {
    l: "л",
    ml: "мл",
    kg: "кг",
    g: "г",
    pcs: "шт",
  },
};

export const MATERIAL_STOCK_UNIT_LABELS_RU: Record<string, string> = {
  l: "л",
  lt: "л",
  liter: "л",
  litre: "л",
  "л": "л",
  ml: "мл",
  "мл": "мл",
  kg: "кг",
  "кг": "кг",
  g: "г",
  gr: "г",
  "г": "г",
  pcs: "шт",
  pc: "шт",
  piece: "шт",
  pieces: "шт",
  "шт": "шт",
  m: "м",
  "м": "м",
  roll: "бухта",
  "бухта": "бухта",
  unknown: "не указано",
};

const RATE_BASIS_SET = new Set<string>(MATERIAL_RATE_BASIS);

export function normalizeMaterialRateBasis(value: MaterialRateBasisInput, fallback: MaterialRateBasis = "per_ha"): MaterialRateBasis {
  const next = String(value || "").trim() as MaterialRateBasis | LegacyMaterialRateBasis;
  if (next === "per_t_solution") return "per_1000_l_solution";
  return RATE_BASIS_SET.has(next) ? (next as MaterialRateBasis) : fallback;
}

export function formatMaterialUnitRu(unit: string | null | undefined): string {
  const key = String(unit || "").trim().toLowerCase();
  return MATERIAL_STOCK_UNIT_LABELS_RU[key] || String(unit || "");
}

export function formatMaterialRateUnitRu(unit: string | null | undefined, basis: MaterialRateBasisInput): string {
  const normalizedBasis = normalizeMaterialRateBasis(basis);
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  return MATERIAL_RATE_BASIS_UNIT_LABELS_RU[normalizedBasis]?.[normalizedUnit] || formatMaterialUnitRu(unit);
}

export function isUnitAllowedForMaterialRateBasis(unit: string | null | undefined, basis: MaterialRateBasisInput): boolean {
  const normalizedBasis = normalizeMaterialRateBasis(basis);
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  if (normalizedBasis === "per_l_water") {
    return ["l", "ml", "kg", "g", "л", "мл", "кг", "г"].includes(normalizedUnit);
  }
  if (["per_t_seed", "per_100kg_seed", "per_1000_seeds"].includes(normalizedBasis)) {
    return ["l", "ml", "kg", "g", "л", "мл", "кг", "г"].includes(normalizedUnit);
  }
  return true;
}

export function isSolutionRateBasis(value: MaterialRateBasisInput): boolean {
  const normalized = normalizeMaterialRateBasis(value);
  return normalized === "per_1000_l_solution" || normalized === "per_l_water";
}

export function isSeedRateBasis(value: MaterialRateBasisInput): boolean {
  const normalized = normalizeMaterialRateBasis(value);
  return normalized === "per_t_seed" || normalized === "per_100kg_seed" || normalized === "per_1000_seeds";
}

function sourceRecord(source: unknown): Record<string, unknown> | null {
  return source && typeof source === "object" ? (source as Record<string, unknown>) : null;
}

function metadataValue(source: unknown, keys: string[]): string {
  const record = sourceRecord(source);
  if (!record) return "";
  return keys
    .map((key) => String(record[key] || "").trim())
    .filter(Boolean)
    .join(" ");
}

function metadataField(source: unknown, key: string): unknown {
  return sourceRecord(source)?.[key];
}

function normalizeMaterialStockUnitValue(value: unknown): string | null {
  const unit = String(value || "").trim().toLowerCase();
  if (!unit || unit === "unknown" || unit === "-") return null;
  if (["l", "lt", "liter", "litre", "л", "л."].includes(unit)) return "l";
  if (["ml", "мл", "мл."].includes(unit)) return "ml";
  if (["kg", "кг", "кг."].includes(unit)) return "kg";
  if (["g", "gr", "г", "г.", "гр"].includes(unit)) return "g";
  if (["pcs", "pc", "piece", "pieces", "шт", "шт."].includes(unit)) return "pcs";
  return null;
}

function materialMetadataText(source: unknown): string {
  return metadataValue(source, [
    "name",
    "trade_name",
    "normalized_name",
    "manufacturer",
    "product_type",
    "type",
    "category",
    "subcategory",
    "pesticide_category",
    "fertilizer_type",
    "formulation",
    "form",
    "notes",
  ])
    .toLowerCase()
    .replace(/ё/g, "е");
}

function hasLiquidMetadataSignal(text: string): boolean {
  return (
    /\b(phomazin|fomazin|technofit|curamin|celest top|revus top)\b/.test(text) ||
    text.includes("фомазин") ||
    text.includes("технофит") ||
    text.includes("курамин") ||
    text.includes("селест топ") ||
    text.includes("ревус топ") ||
    text.includes("anti-salt") ||
    text.includes("anti salt") ||
    text.includes("water conditioner") ||
    text.includes("ph corrector") ||
    text.includes("жидк") ||
    text.includes("концентрат") ||
    text.includes("корректор ph") ||
    text.includes("кондиционер воды") ||
    text.includes("антисоль") ||
    text.includes("прилип") ||
    text.includes("адъювант") ||
    text.includes("пеногас")
  );
}

function hasSolidMetadataSignal(text: string): boolean {
  return (
    text.includes("гранул") ||
    text.includes("порош") ||
    text.includes("вдг") ||
    text.includes("в. д. г") ||
    /\b(wg|wdg|granule|powder)\b/.test(text)
  );
}

export function inferMaterialStockUnit(
  source: unknown,
  fallback: string | null | undefined = "kg"
): string {
  const text = materialMetadataText(source);

  // Known imported rows where old `unit=kg` came from ambiguous photo rows, while the product is handled as liquid.
  if (hasLiquidMetadataSignal(text)) return "l";

  const explicit =
    normalizeMaterialStockUnitValue(metadataField(source, "stock_unit")) ||
    normalizeMaterialStockUnitValue(metadataField(source, "default_unit")) ||
    normalizeMaterialStockUnitValue(metadataField(source, "unit")) ||
    normalizeMaterialStockUnitValue(metadataField(source, "base_uom"));
  if (explicit) return explicit;
  if (hasSolidMetadataSignal(text)) return "kg";
  return normalizeMaterialStockUnitValue(fallback) || "kg";
}

export function inferMaterialDefaultRateBasis(
  source: unknown,
  fallback: MaterialRateBasis = "per_ha"
): MaterialRateBasis {
  const explicit = String(metadataField(source, "default_rate_type") || metadataField(source, "default_dosing_type") || "").trim();
  if (explicit) return normalizeMaterialRateBasis(explicit, fallback);

  const rateUnit = String(metadataField(source, "default_rate_unit") || metadataField(source, "application_unit") || "").toLowerCase();
  if (rateUnit.includes("1000") && (rateUnit.includes("l") || rateUnit.includes("л"))) return "per_1000_l_solution";
  if (rateUnit.includes("/l") || rateUnit.includes("/ l") || rateUnit.includes("/л")) return "per_l_water";
  if (rateUnit.includes("100kg") || rateUnit.includes("100 kg") || rateUnit.includes("100 кг")) return "per_100kg_seed";
  if (rateUnit.includes("1000 seeds") || rateUnit.includes("1000 сем")) return "per_1000_seeds";
  if (rateUnit.includes("/t") || rateUnit.includes("/т")) return "per_t_seed";
  if (rateUnit.includes("/ha") || rateUnit.includes("/га")) return "per_ha";

  const text = materialMetadataText(source);
  if (text.includes("celest top") || text.includes("селест топ") || text.includes("протрав")) return "per_t_seed";

  return fallback;
}
