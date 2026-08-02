import { getMaterialProductTypeFromProduct } from "@/lib/materials/classification";

export const CANONICAL_STOCK_UOMS = ["kg", "l", "pcs"] as const;
export const CANONICAL_BATCH_CLASSES = [
  "commodity",
  "seed",
  "material",
  "feed",
  "waste",
  "processing",
  "rejected",
] as const;

export type CanonicalStockUom = (typeof CANONICAL_STOCK_UOMS)[number];
export type CanonicalBatchClass = (typeof CANONICAL_BATCH_CLASSES)[number];

export type StockBusinessEvent =
  | "manual_receipt"
  | "manual_issue"
  | "manual_transfer"
  | "manual_writeoff"
  | "manual_adjustment"
  | "material_issue"
  | "material_return"
  | "supplier_receipt"
  | "harvest_incoming"
  | "field_issue"
  | "shipment"
  | "disposal"
  | "processing";

export type ProductStockMetadata = {
  id: string;
  company_id?: string | null;
  base_uom?: unknown;
  unit?: unknown;
  product_type?: unknown;
  type?: unknown;
  category?: unknown;
  subcategory?: unknown;
  pesticide_category?: unknown;
  pesticide_subcategories?: unknown;
  is_seed_material?: unknown;
  density_kg_per_l?: unknown;
  density_unit?: unknown;
  density_source?: unknown;
  density_verification_status?: unknown;
  density_verified_at?: unknown;
};

export type StockUnitContract = {
  baseQuantity: number;
  baseUom: CanonicalStockUom;
  massKg: number | null;
  batchClass: CanonicalBatchClass;
  unitSource: string;
  densityKgPerL: number | null;
  densityUnit: "kg/l" | null;
  densitySource: string | null;
  densityVerificationStatus: "verified" | null;
  densityVerifiedAt: string | null;
  unitContractVersion: 2;
};

type NormalizedUnit = {
  baseUom: CanonicalStockUom;
  factor: number;
};

const UNIT_ALIASES: Record<string, NormalizedUnit> = {
  kg: { baseUom: "kg", factor: 1 },
  "кг": { baseUom: "kg", factor: 1 },
  kilogram: { baseUom: "kg", factor: 1 },
  kilograms: { baseUom: "kg", factor: 1 },
  g: { baseUom: "kg", factor: 0.001 },
  gr: { baseUom: "kg", factor: 0.001 },
  gram: { baseUom: "kg", factor: 0.001 },
  grams: { baseUom: "kg", factor: 0.001 },
  "г": { baseUom: "kg", factor: 0.001 },
  l: { baseUom: "l", factor: 1 },
  lt: { baseUom: "l", factor: 1 },
  liter: { baseUom: "l", factor: 1 },
  liters: { baseUom: "l", factor: 1 },
  litre: { baseUom: "l", factor: 1 },
  litres: { baseUom: "l", factor: 1 },
  "л": { baseUom: "l", factor: 1 },
  ml: { baseUom: "l", factor: 0.001 },
  milliliter: { baseUom: "l", factor: 0.001 },
  milliliters: { baseUom: "l", factor: 0.001 },
  "мл": { baseUom: "l", factor: 0.001 },
  pcs: { baseUom: "pcs", factor: 1 },
  pc: { baseUom: "pcs", factor: 1 },
  piece: { baseUom: "pcs", factor: 1 },
  pieces: { baseUom: "pcs", factor: 1 },
  "шт": { baseUom: "pcs", factor: 1 },
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedKey(value: unknown): string {
  return clean(value).toLowerCase().replace(/\.$/, "");
}

function roundQuantity(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeStockUom(value: unknown): NormalizedUnit {
  const raw = normalizedKey(value);
  const normalized = UNIT_ALIASES[raw];
  if (!normalized) {
    throw new Error(
      raw
        ? `Неизвестная складская единица "${clean(value)}". Разрешены кг, л и шт.`
        : "У товара не указана складская единица. Заполните карточку товара."
    );
  }
  return normalized;
}

export function normalizeBatchClass(value: unknown): CanonicalBatchClass | null {
  const normalized = normalizedKey(value);
  return (CANONICAL_BATCH_CLASSES as readonly string[]).includes(normalized)
    ? (normalized as CanonicalBatchClass)
    : null;
}

function classifyProduct(product: ProductStockMetadata): CanonicalBatchClass | null {
  const type = normalizedKey(product.product_type || product.type);
  const category = normalizedKey(product.category);
  if (product.is_seed_material === true || ["seed", "seeds", "planting_material"].includes(type)) {
    return "seed";
  }
  if (getMaterialProductTypeFromProduct(product) || ["material", "fuel", "organic"].includes(type) || category === "material") {
    return "material";
  }
  if (["crop", "produce", "commodity", "grain", "harvest"].includes(type)) {
    return "commodity";
  }
  if (type === "feed") return "feed";
  return null;
}

function resolveBatchClass(params: {
  event: StockBusinessEvent;
  product: ProductStockMetadata;
  requestedBatchClass?: unknown;
  fieldMaterialCategory?: unknown;
}): CanonicalBatchClass {
  const requested = normalizeBatchClass(params.requestedBatchClass);
  if (params.requestedBatchClass != null && clean(params.requestedBatchClass) && !requested) {
    throw new Error("Неизвестный тип партии. Выберите допустимый тип партии.");
  }

  let resolved: CanonicalBatchClass | null = null;
  if (params.event === "harvest_incoming") resolved = "commodity";
  if (params.event === "processing") resolved = "processing";
  if (params.event === "field_issue") {
    resolved = normalizedKey(params.fieldMaterialCategory) === "seed_planting_material" ? "seed" : "material";
  }

  const productClass = classifyProduct(params.product);
  resolved = resolved || requested || productClass;
  if (!resolved) {
    throw new Error("Не удалось определить тип партии. Уточните, это семена, товар или материал.");
  }

  if (productClass === "seed" && resolved !== "seed") {
    throw new Error("Семенной материал нельзя записать как обычный товар или материал.");
  }
  if (productClass === "material" && resolved === "commodity") {
    throw new Error("Материал нельзя записать как товарную партию.");
  }
  if (requested && requested !== resolved) {
    throw new Error("Тип партии движения не совпадает с типом складской партии.");
  }
  return resolved;
}

function resolveDensity(product: ProductStockMetadata): {
  densityKgPerL: number | null;
  densityUnit: "kg/l" | null;
  densitySource: string | null;
  densityVerificationStatus: "verified" | null;
  densityVerifiedAt: string | null;
} {
  const value = Number(product.density_kg_per_l);
  const unit = normalizedKey(product.density_unit);
  const source = clean(product.density_source) || null;
  const status = normalizedKey(product.density_verification_status);
  const verifiedAt = clean(product.density_verified_at) || null;
  const complete = Number.isFinite(value) && value > 0 && unit === "kg/l" && source && status === "verified" && verifiedAt;

  if (!complete) {
    return {
      densityKgPerL: null,
      densityUnit: null,
      densitySource: null,
      densityVerificationStatus: null,
      densityVerifiedAt: null,
    };
  }
  return {
    densityKgPerL: value,
    densityUnit: "kg/l",
    densitySource: source,
    densityVerificationStatus: "verified",
    densityVerifiedAt: verifiedAt,
  };
}

export function resolveStockUnitContract(params: {
  product: ProductStockMetadata;
  quantity: unknown;
  inputUom?: unknown;
  requestedBatchClass?: unknown;
  event: StockBusinessEvent;
  fieldMaterialCategory?: unknown;
  unitSourceOverride?: string | null;
}): StockUnitContract {
  const quantity = Number(params.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Количество складского движения должно быть больше нуля.");
  }

  const productUnitValue = clean(params.product.base_uom) || clean(params.product.unit);
  const productUnit = normalizeStockUom(productUnitValue);
  const inputUnitValue = clean(params.inputUom) || productUnitValue;
  const inputUnit = normalizeStockUom(inputUnitValue);
  if (inputUnit.baseUom !== productUnit.baseUom) {
    throw new Error("Единица движения не совпадает со складской единицей товара.");
  }

  const baseQuantity = roundQuantity(quantity * inputUnit.factor);
  if (baseQuantity <= 0) {
    throw new Error("Количество после нормализации должно быть больше нуля.");
  }

  const density = resolveDensity(params.product);
  const massKg =
    productUnit.baseUom === "kg"
      ? baseQuantity
      : productUnit.baseUom === "l" && density.densityKgPerL != null
        ? roundQuantity(baseQuantity * density.densityKgPerL)
        : null;

  return Object.freeze({
    baseQuantity,
    baseUom: productUnit.baseUom,
    massKg,
    batchClass: resolveBatchClass(params),
    unitSource:
      clean(params.unitSourceOverride) ||
      (clean(params.inputUom) ? "request.input_uom+product.base_uom" : clean(params.product.base_uom) ? "product.base_uom" : "product.unit"),
    ...density,
    unitContractVersion: 2 as const,
  });
}

export function toStockContractColumns(contract: StockUnitContract) {
  return {
    base_quantity: contract.baseQuantity,
    base_uom: contract.baseUom,
    mass_kg: contract.massKg,
    density_kg_per_l: contract.densityKgPerL,
    density_unit: contract.densityUnit,
    density_source: contract.densitySource,
    density_verification_status: contract.densityVerificationStatus,
    density_verified_at: contract.densityVerifiedAt,
    batch_class: contract.batchClass,
    unit_source: contract.unitSource,
    unit_contract_version: contract.unitContractVersion,
  };
}
