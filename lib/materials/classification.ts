export const MATERIAL_PRODUCT_TYPES = ["pesticide", "fertilizer", "additive"] as const;

export type MaterialProductType = (typeof MATERIAL_PRODUCT_TYPES)[number];

export const PESTICIDE_SUBCATEGORIES = [
  "herbicide",
  "fungicide",
  "insecticide",
  "acaricide",
  "desiccant",
  "seed_treatment",
  "growth_regulator",
  "other",
] as const;

export const FERTILIZER_SUBCATEGORIES = [
  "macro",
  "micro",
  "foliar",
  "water_soluble",
  "organic",
  "organomineral",
  "biostimulant",
  "other",
] as const;

export const ADDITIVE_SUBCATEGORIES = [
  "adjuvant",
  "sticker",
  "pH_corrector",
  "antifoam",
  "water_conditioner",
  "anti_salt",
  "other",
] as const;

export type MaterialSubcategory =
  | (typeof PESTICIDE_SUBCATEGORIES)[number]
  | (typeof FERTILIZER_SUBCATEGORIES)[number]
  | (typeof ADDITIVE_SUBCATEGORIES)[number];

export const MATERIAL_PRODUCT_TYPE_LABELS_RU: Record<MaterialProductType, string> = {
  pesticide: "Пестициды",
  fertilizer: "Удобрения",
  additive: "Добавки",
};

export const MATERIAL_SUBCATEGORY_LABELS_RU: Record<MaterialSubcategory, string> = {
  herbicide: "Гербицид",
  fungicide: "Фунгицид",
  insecticide: "Инсектицид",
  acaricide: "Акарицид",
  desiccant: "Десикант",
  seed_treatment: "Протравитель",
  growth_regulator: "Регулятор роста",
  macro: "Макроудобрение",
  micro: "Микроудобрение",
  foliar: "Листовая подкормка",
  water_soluble: "Водорастворимое",
  organic: "Органическое",
  organomineral: "Органоминеральное",
  biostimulant: "Биостимулятор",
  adjuvant: "Адъювант",
  sticker: "Прилипатель",
  pH_corrector: "Корректор pH",
  antifoam: "Пеногаситель",
  water_conditioner: "Кондиционер воды",
  anti_salt: "Антисоль",
  other: "Другое",
};

const LEGACY_ADDITIVE_PRODUCT_TYPES = new Set(["adjuvant"]);
const LEGACY_ADDITIVE_CATEGORIES = new Set(["adjuvant", "additive"]);
const LEGACY_ADDITIVE_PESTICIDE_CATEGORIES = new Set([
  "adjuvant",
  "surfactant",
  "water_conditioner",
  "ph_regulator",
  "pH_regulator",
  "drift_reduction_agent",
  "anti_foam",
  "antifoam",
]);

function clean(value: unknown): string {
  return String(value || "").trim();
}

function lower(value: unknown): string {
  return clean(value).toLowerCase();
}

export function normalizeMaterialProductType(value: unknown): MaterialProductType | null {
  const normalized = lower(value);
  if (!normalized) return null;
  if (normalized === "pesticide" || normalized === "crop_protection") return "pesticide";
  if (normalized === "fertilizer") return "fertilizer";
  if (normalized === "additive" || normalized === "adjuvant") return "additive";
  if (normalized === "growth_regulator") return "pesticide";
  return null;
}

export function normalizeMaterialSubcategory(
  group: MaterialProductType | null | undefined,
  value: unknown
): MaterialSubcategory | null {
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const aliases: Record<string, MaterialSubcategory> = {
    crop_protection: "other",
    biological: "other",
    desiccation: "desiccant",
    seed_treater: "seed_treatment",
    seed_treatment_product: "seed_treatment",
    micronutrient: "micro",
    micro_fertilizer: "micro",
    npk: "macro",
    nitrogen: "macro",
    phosphorus: "macro",
    potassium: "macro",
    p: "macro",
    k: "macro",
    ph_regulator: "pH_corrector",
    pH_regulator: "pH_corrector",
    ph_corrector: "pH_corrector",
    anti_foam: "antifoam",
    defoamer: "antifoam",
    surfactant: "adjuvant",
    drift_reduction_agent: "adjuvant",
    conditioner: "water_conditioner",
    anti_salt_product: "anti_salt",
    antisalinity: "anti_salt",
  };
  const aliased = aliases[normalized] || aliases[raw];
  const candidate = (aliased || raw) as MaterialSubcategory;

  if (group === "pesticide" && (PESTICIDE_SUBCATEGORIES as readonly string[]).includes(candidate)) return candidate;
  if (group === "fertilizer" && (FERTILIZER_SUBCATEGORIES as readonly string[]).includes(candidate)) return candidate;
  if (group === "additive" && (ADDITIVE_SUBCATEGORIES as readonly string[]).includes(candidate)) return candidate;
  if (!group && MATERIAL_SUBCATEGORY_LABELS_RU[candidate]) return candidate;
  return null;
}

export function isLegacyAdditiveProduct(row: {
  product_type?: unknown;
  category?: unknown;
  subcategory?: unknown;
  pesticide_category?: unknown;
  pesticide_subcategories?: unknown;
}): boolean {
  const productType = lower(row.product_type);
  const category = lower(row.category);
  const pesticideCategory = lower(row.pesticide_category);
  if (LEGACY_ADDITIVE_PRODUCT_TYPES.has(productType)) return true;
  if (LEGACY_ADDITIVE_CATEGORIES.has(category)) return true;
  if (LEGACY_ADDITIVE_PESTICIDE_CATEGORIES.has(pesticideCategory)) return true;

  const subcategories = Array.isArray(row.pesticide_subcategories) ? row.pesticide_subcategories : [];
  return subcategories.some((item) => LEGACY_ADDITIVE_PESTICIDE_CATEGORIES.has(lower(item)));
}

export function getMaterialProductTypeFromProduct(row: {
  product_type?: unknown;
  type?: unknown;
  category?: unknown;
  subcategory?: unknown;
  pesticide_category?: unknown;
  pesticide_subcategories?: unknown;
}): MaterialProductType | null {
  const byProductType = normalizeMaterialProductType(row.product_type);
  if (byProductType) return byProductType;
  if (isLegacyAdditiveProduct(row)) return "additive";

  const byCategory = normalizeMaterialProductType(row.category);
  if (byCategory) return byCategory;

  return normalizeMaterialProductType(row.type);
}

export function getMaterialSubcategoryFromProduct(row: {
  product_type?: unknown;
  type?: unknown;
  category?: unknown;
  subcategory?: unknown;
  pesticide_category?: unknown;
  fertilizer_type?: unknown;
  pesticide_subcategories?: unknown;
}): MaterialSubcategory | null {
  const group = getMaterialProductTypeFromProduct(row);
  return (
    normalizeMaterialSubcategory(group, row.subcategory) ||
    normalizeMaterialSubcategory(group, row.pesticide_category) ||
    normalizeMaterialSubcategory(group, row.fertilizer_type) ||
    null
  );
}

