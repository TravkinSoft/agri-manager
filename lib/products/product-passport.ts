import {
  buildProductDisplayLabel,
  getVerifiedProductStockUnit,
  stripManufacturerPrefixCandidate,
  type CatalogProductLike,
} from "@/lib/catalog/catalog-identity";
import { getMaterialProductTypeFromProduct, getMaterialSubcategoryFromProduct } from "@/lib/materials/classification";
import { normalizeMaterialRateBasis, type MaterialRateBasis } from "@/lib/materials/metadata";

export type ProductPassportScope = "global" | "company";
export type ProductPassportStockUnit = "l" | "ml" | "kg" | "g" | "pcs" | "unknown";
export type ProductPassportPhysicalState =
  | "liquid"
  | "solid"
  | "granule"
  | "powder"
  | "tablet"
  | "gel"
  | "unknown";
export type ProductPassportConfidence = "low" | "medium" | "high" | null;

export type ProductPassportSource = CatalogProductLike & {
  master_product_id?: string | null;
  manufacturer_id?: string | null;
  formulation_id?: string | null;
  formulation?: string | null;
  physical_state?: string | null;
  metadata_source_url?: string | null;
  metadata_confidence?: string | null;
  metadata_review_required?: boolean | string | null;
  source_url?: string | null;
  active_ingredients?: unknown;
};

export type ProductPassportCompositionItem = {
  activeIngredientId: string | null;
  name: string;
  concentrationText: string | null;
};

export type ProductPassport = {
  id: string;
  scope: ProductPassportScope;
  masterProductId: string | null;
  tradeName: string;
  displayName: string;
  normalizedName: string;
  manufacturer: {
    id: string | null;
    name: string | null;
    brand: string | null;
  };
  aliases: string[];
  classification: {
    productType: string | null;
    subcategory: string | null;
    formulationId: string | null;
    formulation: string | null;
    physicalState: ProductPassportPhysicalState;
  };
  units: {
    stockUnit: ProductPassportStockUnit;
    defaultRateType: MaterialRateBasis;
    defaultRateUnit: string | null;
  };
  review: {
    metadataReviewRequired: boolean;
    sourceUrl: string | null;
    confidence: ProductPassportConfidence;
    reasons: string[];
  };
  composition: ProductPassportCompositionItem[];
};

const STOCK_UNITS = new Set(["l", "ml", "kg", "g", "pcs", "unknown"]);
const PHYSICAL_STATES = new Set(["liquid", "solid", "granule", "powder", "tablet", "gel", "unknown"]);
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const next = text(value);
  return next ? next : null;
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const next = text(value).toLowerCase();
  return next === "true" || next === "1" || next === "yes" || next === "да";
}

export function normalizeProductPassportStockUnit(value: unknown): ProductPassportStockUnit | null {
  const unit = text(value).toLowerCase();
  if (!unit) return null;
  if (["l", "lt", "liter", "litre", "л", "л."].includes(unit)) return "l";
  if (["ml", "мл", "мл."].includes(unit)) return "ml";
  if (["kg", "кг", "кг."].includes(unit)) return "kg";
  if (["g", "gr", "г", "г.", "гр"].includes(unit)) return "g";
  if (["pcs", "pc", "piece", "pieces", "шт", "шт."].includes(unit)) return "pcs";
  if (unit === "unknown") return "unknown";
  return null;
}

export function normalizeProductPassportPhysicalState(value: unknown): ProductPassportPhysicalState | null {
  const state = text(value).toLowerCase();
  if (!state) return null;
  if (PHYSICAL_STATES.has(state)) return state as ProductPassportPhysicalState;
  return null;
}

export function normalizeProductPassportConfidence(value: unknown): ProductPassportConfidence {
  const confidence = text(value).toLowerCase();
  return CONFIDENCE_VALUES.has(confidence) ? (confidence as Exclude<ProductPassportConfidence, null>) : null;
}

function inferPhysicalStateFromStockUnit(stockUnit: ProductPassportStockUnit): ProductPassportPhysicalState {
  if (stockUnit === "l" || stockUnit === "ml") return "liquid";
  if (stockUnit === "kg" || stockUnit === "g") return "solid";
  if (stockUnit === "pcs") return "unknown";
  return "unknown";
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = text(value);
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function buildCompositionSummary(value: unknown): ProductPassportCompositionItem[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return { activeIngredientId: null, name: item, concentrationText: null };
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const name =
            nullableText(record.name) ||
            nullableText(record.name_ru) ||
            nullableText(record.name_en) ||
            nullableText(record.slug);
          if (!name) return null;
          return {
            activeIngredientId: nullableText(record.id) || nullableText(record.active_ingredient_id),
            name,
            concentrationText: nullableText(record.concentration_text),
          };
        }
        return null;
      })
      .filter(Boolean) as ProductPassportCompositionItem[];
  }
  const single = nullableText(value);
  return single ? [{ activeIngredientId: null, name: single, concentrationText: null }] : [];
}

export function buildProductPassport(source: ProductPassportSource): ProductPassport {
  const stripped = stripManufacturerPrefixCandidate(source);
  const rawTradeName = stripped.proposedTradeName || source.trade_name || source.name || source.normalized_name || "";
  const tradeName = text(rawTradeName) || "-";
  const displayName = buildProductDisplayLabel(source) || tradeName;
  const verifiedStockUnit = normalizeProductPassportStockUnit(getVerifiedProductStockUnit(source));
  const explicitStockUnit = normalizeProductPassportStockUnit(source.stock_unit);
  const stockUnit = verifiedStockUnit || explicitStockUnit || "unknown";
  const rawRateType = nullableText(source.default_rate_type);
  const defaultRateType = rawRateType ? normalizeMaterialRateBasis(rawRateType, "manual") : "manual";
  const defaultRateUnit = nullableText(source.default_rate_unit);
  const explicitPhysicalState = normalizeProductPassportPhysicalState(source.physical_state);
  const physicalState = explicitPhysicalState || inferPhysicalStateFromStockUnit(stockUnit);
  const confidence = normalizeProductPassportConfidence(source.metadata_confidence);
  const reasons: string[] = [];

  if (!explicitStockUnit && !verifiedStockUnit) reasons.push("missing_stock_unit");
  if (explicitStockUnit && verifiedStockUnit && explicitStockUnit !== verifiedStockUnit) {
    reasons.push("stock_unit_overridden_by_verified_identity");
  }
  if (!rawRateType) reasons.push("missing_default_rate_type");
  if (rawRateType === "per_t_solution") reasons.push("legacy_per_t_solution_normalized");
  if (!defaultRateUnit && defaultRateType !== "manual") reasons.push("missing_default_rate_unit");
  if (!explicitPhysicalState) reasons.push("missing_physical_state");
  if (!confidence) reasons.push("missing_metadata_confidence");

  const productType = getMaterialProductTypeFromProduct(source) || nullableText(source.product_type || source.type || source.category);
  const subcategory = getMaterialSubcategoryFromProduct(source) || nullableText(source.subcategory || source.pesticide_category || source.fertilizer_type);
  const manufacturerName = nullableText(source.manufacturer) || nullableText(stripped.manufacturer);
  const normalizedName = nullableText(source.normalized_name) || tradeName.toLowerCase();
  const aliases = uniqueNonEmpty([
    source.name,
    source.trade_name,
    source.normalized_name,
    stripped.originalName,
    stripped.proposedTradeName,
    displayName,
  ]).filter((alias) => alias !== tradeName && alias !== displayName);

  return {
    id: text(source.id),
    scope: source.company_id ? "company" : "global",
    masterProductId: nullableText(source.master_product_id),
    tradeName,
    displayName,
    normalizedName,
    manufacturer: {
      id: nullableText(source.manufacturer_id),
      name: manufacturerName,
      brand: null,
    },
    aliases,
    classification: {
      productType,
      subcategory,
      formulationId: nullableText(source.formulation_id),
      formulation: nullableText(source.formulation),
      physicalState,
    },
    units: {
      stockUnit,
      defaultRateType,
      defaultRateUnit,
    },
    review: {
      metadataReviewRequired: truthy(source.metadata_review_required) || reasons.length > 0,
      sourceUrl: nullableText(source.metadata_source_url) || nullableText(source.source_url),
      confidence,
      reasons,
    },
    composition: buildCompositionSummary(source.active_ingredients),
  };
}

export function getProductPassportDisplayName(source: ProductPassportSource): string {
  return buildProductPassport(source).displayName;
}

export function getProductPassportStockUnit(source: ProductPassportSource): ProductPassportStockUnit {
  return buildProductPassport(source).units.stockUnit;
}

export function getProductPassportDefaultRateType(source: ProductPassportSource): MaterialRateBasis {
  return buildProductPassport(source).units.defaultRateType;
}
