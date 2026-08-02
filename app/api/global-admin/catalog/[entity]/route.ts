import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { localizedName } from "@/lib/i18n/helpers";
import { normalizeMaterialRateBasis } from "@/lib/materials/metadata";
import { buildProductPassport } from "@/lib/products/product-passport";
import type { GlobalCatalogEntity } from "@/lib/platform/global-catalog-config";
import {
  buildGlbdComponentSearchEntries,
  dedupeByCanonicalComponent,
  findExactGlbdAliasConflict,
  glbdComponentDisplayName,
  glbdComponentMatchesSearch,
  glbdComponentTypeLabel,
  isVisibleGlbdComponent,
  matchedGlbdAlias,
  normalizeGlbdSearchText,
  toGlbdComponentSourceDisplay,
  type GlbdComponentSearchEntry,
} from "@/lib/glbd/component-discovery";

type EntityConfig = {
  table: string;
  select: string;
  defaultOrder: string;
  scopeWhere: (query: any) => any;
  searchColumns: string[];
  filters: string[];
  normalizeRow?: (row: any) => any;
  beforeCreate?: (payload: Record<string, any>) => Record<string, any>;
  beforeUpdate?: (payload: Record<string, any>) => Record<string, any>;
};

const PLATFORM_GLOBAL_COMPANY_ID = "10000000-0000-0000-0000-000000000001";

const PRODUCT_SEARCH_ALIASES = [
  ["phomazin", "swissgrow phomazin", "\u0444\u043e\u043c\u0430\u0437\u0438\u043d"],
  ["curamin foliar", "curamin", "\u043a\u0443\u0440\u0430\u043c\u0438\u043d \u0444\u043e\u043b\u0438\u0430\u0440", "\u043a\u0443\u0440\u0430\u043c\u0438\u043d"],
  ["revus top", "revus top sc", "ревус топ"],
  ["celest top", "celest top fs", "селест топ"],
  ["black jack", "blackjack", "блек джек"],
] as const;

function applyGlobalScope(query: any) {
  return query.or(`company_id.is.null,company_id.eq.${PLATFORM_GLOBAL_COMPANY_ID}`);
}

function applyStandaloneAgriculturalMachineScope(query: any) {
  return query.in("asset_group", ["self_propelled_machine", "truck"]);
}

function translateModeOfAction(value: any): string {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "-";
  if (key === "systemic") return "Системный";
  if (key === "contact") return "Контактный";
  if (key === "translaminar") return "Трансламинарный";
  if (key === "systemic_local") return "Локально-системный";
  return String(value);
}

function translateAgriculturalMachineCategory(value: any): string {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "-";
  if (key === "combine_harvester") return "Комбайн";
  if (key === "forage_harvester") return "Кормоуборочный комбайн";
  if (key === "self_propelled_sprayer") return "Самоходный опрыскиватель";
  if (key === "self_propelled_seeder") return "Самоходная сеялка";
  if (key === "self_propelled_spreader") return "Самоходный разбрасыватель";
  if (key === "self_propelled_windrower") return "Самоходная жатка";
  if (key === "self_propelled_mower") return "Самоходная косилка";
  if (key === "trailed_sprayer") return "Прицепной опрыскиватель";
  if (key === "mounted_sprayer") return "Навесной опрыскиватель";
  if (key === "potato_planter") return "Картофелесажалка";
  if (key === "potato_harvester") return "Картофелеуборочная техника";
  if (key === "planter") return "Сажалка";
  if (key === "seeder") return "Сеялка";
  if (key === "cultivator") return "Культиватор";
  if (key === "plow") return "Плуг";
  if (key === "disc_harrow") return "Дисковая борона";
  if (key === "fertilizer_spreader") return "Разбрасыватель удобрений";
  if (key === "loader") return "Погрузчик";
  if (key === "telehandler") return "Телескопический погрузчик";
  if (key === "trailer") return "Прицеп";
  if (key === "tractor") return "Трактор";
  if (key === "other") return "Прочее";
  return String(value);
}

function translateMachineryAssetGroup(value: any): string {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "-";
  if (key === "self_propelled_machine") return "Самоходная техника";
  if (key === "implement") return "Агрегат";
  if (key === "trailer") return "Прицеп";
  if (key === "truck") return "Транспорт";
  return String(value);
}

function translateAgriculturalMachineSourceType(value: any): string {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "-";
  if (key === "manufacturer") return "Производитель";
  if (key === "official_dealer") return "Официальный дилер";
  if (key === "registry") return "Реестр";
  if (key === "import_feed") return "Импорт данных";
  if (key === "manual") return "Ручной ввод";
  return String(value);
}

function normalizeCatalogName(value: unknown): string | null {
  const normalized = String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function nullifyEmptyFields(payload: Record<string, any>, keys: string[]) {
  const next = { ...payload };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(next, key) && String(next[key] ?? "").trim() === "") {
      next[key] = null;
    }
  }
  return next;
}

function nullableCatalogText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text || text === "unknown") return null;
  return text;
}

function catalogBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "да";
}

function normalizeProductMetadataPayload(payload: Record<string, any>, fallbackStockUnit: string) {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);
  const stockUnit =
    nullableCatalogText(payload.stock_unit) ||
    nullableCatalogText(payload.default_unit) ||
    nullableCatalogText(payload.unit) ||
    nullableCatalogText(payload.base_uom) ||
    fallbackStockUnit;
  const defaultRateType = normalizeMaterialRateBasis(payload.default_rate_type || payload.default_dosing_type || "per_ha");

  const next: Record<string, any> = {
    ...payload,
    stock_unit: stockUnit,
    default_unit: payload.default_unit || stockUnit,
    unit: payload.unit || stockUnit,
    base_uom: payload.base_uom || stockUnit,
    default_rate_type: defaultRateType,
    default_rate_unit: nullableCatalogText(payload.default_rate_unit) || nullableCatalogText(payload.application_unit),
  };
  if (has("metadata_source_url")) next.metadata_source_url = nullableCatalogText(payload.metadata_source_url);
  if (has("metadata_confidence")) next.metadata_confidence = nullableCatalogText(payload.metadata_confidence);
  if (has("metadata_review_required")) next.metadata_review_required = catalogBool(payload.metadata_review_required);
  return next;
}

function normalizeProductCatalogRow(row: any) {
  const passport = buildProductPassport({ ...(row || {}), id: String(row?.id || "") });
  return {
    ...row,
    trade_name: passport.tradeName || row.trade_name || row.name || "-",
    display_name: passport.displayName || row.trade_name || row.name || "-",
    manufacturer: passport.manufacturer.name || row.manufacturer_name || row.manufacturer || "-",
    stock_unit: passport.units.stockUnit !== "unknown" ? passport.units.stockUnit : row.stock_unit || row.default_unit || row.unit || row.base_uom || "-",
    default_rate_type: passport.units.defaultRateType || "-",
    default_rate_unit: passport.units.defaultRateUnit || row.application_unit || "-",
    physical_state: passport.classification.physicalState,
    metadata_review_required: passport.review.metadataReviewRequired,
  };
}

function isMachineryCatalogEntity(entity: GlobalCatalogEntity): boolean {
  return entity === "agricultural_machine_models" || entity === "machinery" || entity === "implements" || entity === "fleet";
}

function normalizeMachineryBrand(value: any): any {
  const text = String(value ?? "").trim();
  if (!text) return value;
  if (text.toLowerCase() === "grimme") return "GRIMME";
  return text;
}

function normalizeMachineryBrandText(value: any): any {
  if (value == null) return value;
  return String(value).replace(/^grimme\b/i, "GRIMME");
}

function normalizeMachineryBrandRow(row: any) {
  return {
    ...row,
    brand: normalizeMachineryBrand(row?.brand),
    name: normalizeMachineryBrandText(row?.name),
    full_name: normalizeMachineryBrandText(row?.full_name),
  };
}

function normalizeMachineryBrandPayload(payload: Record<string, any>) {
  if (!Object.prototype.hasOwnProperty.call(payload, "brand")) return payload;
  return {
    ...payload,
    brand: normalizeMachineryBrand(payload.brand),
  };
}

const ENTITY_CONFIG: Record<GlobalCatalogEntity, EntityConfig> = {
  crops: {
    table: "crops",
    select: "*, crop_categories:category_id(id,name_ru,slug)",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: ["name", "name_ru", "name_en", "slug", "subcategory", "crop_subcategory", "category", "crop_category"],
    filters: ["category_id", "is_common_in_kz", "is_active"],
    normalizeRow: (row) => {
      const categoryName =
        row.crop_categories?.name_ru ||
        row.category ||
        row.crop_category ||
        "-";
      const subcategoryValue =
        row.subcategory ||
        row.crop_subcategory ||
        "-";

      return {
        ...row,
        category: categoryName,
        crop_category: categoryName,
        subcategory: subcategoryValue,
        crop_subcategory: subcategoryValue,
      };
    },
  },
  varieties: {
    table: "varieties",
    select:
      "id,name,crop_id,originator_id,origin_country,variety_type,maturity_group,purpose,skin_color,flesh_color,storage_quality,source_url,notes,is_common_in_kz,is_active,archived,updated_at,created_at",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: ["name", "origin_country", "variety_type", "maturity_group", "purpose", "skin_color", "flesh_color", "notes"],
    filters: ["crop_id", "originator_id", "origin_country", "is_common_in_kz", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      crop_name: row.crop_name || "-",
      originator_name: row.originator_name || row.breeder_or_originator || "-",
    }),
    beforeCreate: (payload) => nullifyEmptyFields(payload, ["originator_id"]),
    beforeUpdate: (payload) => nullifyEmptyFields(payload, ["originator_id"]),
  },
  seed_originators: {
    table: "seed_originators",
    select: "id,name,normalized_name,country,website,notes,is_active,archived,updated_at,created_at",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: ["name", "normalized_name", "country", "website", "notes"],
    filters: ["country", "is_active"],
    beforeCreate: (payload) => ({
      ...payload,
      company_id: null,
      normalized_name: payload.normalized_name || normalizeCatalogName(payload.name),
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      normalized_name: payload.normalized_name || normalizeCatalogName(payload.name),
    }),
  },
  seed_reproductions: {
    table: "seed_reproductions",
    select: "id,name,level_order,description,is_active,archived,updated_at,created_at",
    defaultOrder: "level_order",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: ["name", "description"],
    filters: ["is_active"],
  },
  seeds: {
    table: "products",
    select:
      "id,name,trade_name,crop_id,variety_id,seed_reproduction_id,unit,base_uom,manufacturer,notes,type,category,is_seed_material,is_active,archived,updated_at,created_at",
    defaultOrder: "name",
    scopeWhere: (query) =>
      query
        .is("company_id", null)
        .or("type.eq.seed,category.eq.seed,is_seed_material.eq.true"),
    searchColumns: ["name", "trade_name", "manufacturer", "notes"],
    filters: ["crop_id", "variety_id", "seed_reproduction_id", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      crop_name: row.crop_name || "-",
      variety_name: row.variety_name || "-",
      originator_name: row.originator_name || "-",
      reproduction_name: row.reproduction_name || "-",
      unit: row.unit || row.base_uom || "-",
    }),
    beforeCreate: (payload) => {
      const normalized = nullifyEmptyFields(payload, ["variety_id", "seed_reproduction_id"]);
      return {
        ...normalized,
        trade_name: normalized.trade_name || normalized.name,
        type: "seed",
        category: "seed",
        is_seed_material: true,
        company_id: null,
        unit: normalized.unit || normalized.base_uom || "kg",
        base_uom: normalized.base_uom || normalized.unit || "kg",
      };
    },
    beforeUpdate: (payload) => {
      const normalized = nullifyEmptyFields(payload, ["variety_id", "seed_reproduction_id"]);
      return {
        ...normalized,
        trade_name: normalized.trade_name || normalized.name,
        type: "seed",
        category: "seed",
        is_seed_material: true,
        unit: normalized.unit || normalized.base_uom || "kg",
        base_uom: normalized.base_uom || normalized.unit || "kg",
      };
    },
  },
  diseases: {
    table: "diseases",
    select:
      "id,name_ru,name_en,latin_name,normalized_name,disease_type,pathogen_type,symptoms,development_conditions,risk_stage,source_url,confidence,notes,image_url,is_active,archived,updated_at,created_at",
    defaultOrder: "name_ru",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: [
      "name_ru",
      "name_en",
      "latin_name",
      "normalized_name",
      "symptoms",
      "development_conditions",
      "risk_stage",
      "notes",
    ],
    filters: ["disease_type", "pathogen_type", "confidence", "is_active"],
    beforeCreate: (payload) => ({
      ...payload,
      company_id: null,
      normalized_name:
        payload.normalized_name ||
        normalizeCatalogName(payload.name_ru || payload.name_en || payload.latin_name),
      disease_type: payload.disease_type || "unknown",
      pathogen_type: payload.pathogen_type || "unknown",
      confidence: payload.confidence || "medium",
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      normalized_name:
        payload.normalized_name ||
        normalizeCatalogName(payload.name_ru || payload.name_en || payload.latin_name),
      disease_type: payload.disease_type || "unknown",
      pathogen_type: payload.pathogen_type || "unknown",
      confidence: payload.confidence || "medium",
    }),
  },
  pests: {
    table: "pests",
    select:
      "id,name_ru,name_en,latin_name,normalized_name,pest_type,life_cycle,damage_symptoms,development_conditions,risk_stage,source_url,confidence,notes,image_url,is_sensitive,is_active,archived,updated_at,created_at",
    defaultOrder: "name_ru",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: [
      "name_ru",
      "name_en",
      "latin_name",
      "normalized_name",
      "life_cycle",
      "damage_symptoms",
      "development_conditions",
      "risk_stage",
      "notes",
    ],
    filters: ["pest_type", "confidence", "is_sensitive", "is_active"],
    beforeCreate: (payload) => ({
      ...payload,
      company_id: null,
      normalized_name:
        payload.normalized_name ||
        normalizeCatalogName(payload.name_ru || payload.name_en || payload.latin_name),
      pest_type: payload.pest_type || "unknown",
      confidence: payload.confidence || "medium",
      is_sensitive: payload.is_sensitive === true || payload.is_sensitive === "true",
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      normalized_name:
        payload.normalized_name ||
        normalizeCatalogName(payload.name_ru || payload.name_en || payload.latin_name),
      pest_type: payload.pest_type || "unknown",
      confidence: payload.confidence || "medium",
      is_sensitive: payload.is_sensitive === true || payload.is_sensitive === "true",
    }),
  },
  weeds: {
    table: "weeds",
    select:
      "id,name_ru,name_en,latin_name,normalized_name,weed_type,life_cycle,morphology,harmfulness,development_conditions,source_url,confidence,notes,image_url,is_active,archived,updated_at,created_at",
    defaultOrder: "name_ru",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: [
      "name_ru",
      "name_en",
      "latin_name",
      "normalized_name",
      "life_cycle",
      "morphology",
      "harmfulness",
      "development_conditions",
      "notes",
    ],
    filters: ["weed_type", "confidence", "is_active"],
    beforeCreate: (payload) => ({
      ...payload,
      company_id: null,
      normalized_name:
        payload.normalized_name ||
        normalizeCatalogName(payload.name_ru || payload.name_en || payload.latin_name),
      weed_type: payload.weed_type || "unknown",
      confidence: payload.confidence || "medium",
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      normalized_name:
        payload.normalized_name ||
        normalizeCatalogName(payload.name_ru || payload.name_en || payload.latin_name),
      weed_type: payload.weed_type || "unknown",
      confidence: payload.confidence || "medium",
    }),
  },
  pesticides: {
    table: "products",
    select: "*",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null).in("product_type", ["pesticide", "additive", "adjuvant", "growth_regulator"]),
    searchColumns: ["name", "trade_name", "subcategory", "category", "manufacturer", "formulation"],
    filters: ["product_type", "category_id", "manufacturer_id", "formulation_id", "mode_of_action_type_id", "active_ingredient_ids", "is_active"],
    normalizeRow: (row) => ({
      ...normalizeProductCatalogRow(row),
      active_ingredients: row.active_ingredients || row.active_ingredient || "-",
      pesticide_category: row.catalog_category_label || row.pesticide_category || "-",
      mode_of_action_type: row.mode_of_action_type_name || translateModeOfAction(row.mode_of_action_type),
      formulation: row.formulation_name || row.formulation || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...normalizeProductMetadataPayload(payload, "l"),
      type: "pesticide",
      product_type: "pesticide",
      company_id: null,
    }),
    beforeUpdate: (payload) => normalizeProductMetadataPayload(payload, "l"),
  },
  fertilizers: {
    table: "products",
    select: "*, fertilizer_categories:fertilizer_category_id(id,name_ru,slug)",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null).eq("product_type", "fertilizer"),
    searchColumns: ["name", "trade_name", "manufacturer", "formulation", "composition", "catalog_category_label", "application_scope"],
    filters: ["fertilizer_category_id", "manufacturer_id", "application_scope", "is_active"],
    normalizeRow: (row) => ({
      ...normalizeProductCatalogRow(row),
      fertilizer_category: row.fertilizer_categories?.name_ru || row.catalog_category_label || row.fertilizer_type || "-",
      formulation: row.formulation_name || row.formulation || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...normalizeProductMetadataPayload(payload, "kg"),
      trade_name: payload.trade_name || payload.name,
      name_ru: payload.name_ru || payload.trade_name || payload.name,
      type: "fertilizer",
      product_type: "fertilizer",
      company_id: null,
    }),
    beforeUpdate: (payload) => normalizeProductMetadataPayload(payload, "kg"),
  },
  fertilizer_categories: {
    table: "fertilizer_categories",
    select: "id,slug,name_ru,definition,examples,sort_order,is_active,archived,created_at,updated_at",
    defaultOrder: "sort_order",
    scopeWhere: (query) => query,
    searchColumns: ["slug", "name_ru", "definition", "examples"],
    filters: ["is_active"],
    beforeCreate: (payload) => ({ ...payload, archived: false }),
  },
  additives: {
    table: "products",
    select: "*",
    defaultOrder: "name",
    scopeWhere: (query) =>
      query
        .is("company_id", null)
        .or(
          "product_type.eq.additive,product_type.eq.adjuvant,category.eq.additive,category.eq.adjuvant,pesticide_category.in.(adjuvant,surfactant,water_conditioner,pH_regulator,drift_reduction_agent,anti_foam)"
        ),
    searchColumns: ["name", "trade_name", "subcategory", "category", "manufacturer", "formulation"],
    filters: ["subcategory", "manufacturer_id", "formulation_id", "is_active"],
    normalizeRow: (row) => ({
      ...normalizeProductCatalogRow(row),
      subcategory: row.subcategory || row.pesticide_category || row.category || "-",
      formulation: row.formulation_name || row.formulation || "-",
      default_unit: row.default_unit || row.stock_unit || row.unit || row.base_uom || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...normalizeProductMetadataPayload(payload, "l"),
      type: "pesticide",
      product_type: "additive",
      category: "additive",
      pesticide_category: null,
      fertilizer_type: null,
      company_id: null,
    }),
    beforeUpdate: (payload) => ({
      ...normalizeProductMetadataPayload(payload, "l"),
      product_type: "additive",
      category: "additive",
      pesticide_category: null,
      fertilizer_type: null,
    }),
  },
  growth_regulators: {
    table: "products",
    select: "*",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null).eq("product_type", "growth_regulator"),
    searchColumns: ["name", "trade_name"],
    filters: ["product_type", "category_id", "manufacturer_id", "formulation_id", "mode_of_action_type_id", "active_ingredient_ids", "is_active"],
    normalizeRow: (row) => ({
      ...normalizeProductCatalogRow(row),
      active_ingredients: row.active_ingredients || row.active_ingredient || "-",
      pesticide_category: row.pesticide_category || "-",
      mode_of_action_type: row.mode_of_action_type_name || translateModeOfAction(row.mode_of_action_type),
      formulation: row.formulation_name || row.formulation || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...normalizeProductMetadataPayload(payload, "l"),
      type: "pesticide",
      product_type: "growth_regulator",
      company_id: null,
    }),
    beforeUpdate: (payload) => normalizeProductMetadataPayload(payload, "l"),
  },
  pesticide_categories: {
    table: "pesticide_categories",
    select: "id,name_ru,name_en,slug,description,is_active,archived,updated_at,created_at",
    defaultOrder: "name_ru",
    scopeWhere: (query) => query,
    searchColumns: ["name_ru", "name_en", "slug", "description"],
    filters: ["is_active"],
    beforeCreate: (payload) => ({
      ...payload,
      slug: String(payload.slug || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_/-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""),
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      ...(payload.slug
        ? {
            slug: String(payload.slug)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_/-]+/g, "-")
              .replace(/-+/g, "-")
              .replace(/^-|-$/g, ""),
          }
        : {}),
    }),
  },
  active_ingredients: {
    table: "active_ingredients",
    select: "id,name_ru,name_en,slug,ingredient_type,description,is_active,archived,updated_at,created_at",
    defaultOrder: "name_ru",
    scopeWhere: (query) => query,
    searchColumns: ["name_ru", "name_en", "slug", "description"],
    filters: ["ingredient_type", "is_active"],
    beforeCreate: (payload) => ({
      ...payload,
      slug: String(payload.slug || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_/-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""),
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      ...(payload.slug
        ? {
            slug: String(payload.slug)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_/-]+/g, "-")
              .replace(/-+/g, "-")
              .replace(/^-|-$/g, ""),
          }
        : {}),
    }),
  },
  agrochem_manufacturers: {
    table: "agrochem_manufacturers",
    select: "id,name,is_active,archived,updated_at,created_at",
    defaultOrder: "name",
    scopeWhere: (query) => query,
    searchColumns: ["name"],
    filters: ["is_active"],
  },
  agrochem_formulations: {
    table: "agrochem_formulations",
    select: "id,code,name_ru,is_active,archived,updated_at,created_at",
    defaultOrder: "code",
    scopeWhere: (query) => query,
    searchColumns: ["code", "name_ru"],
    filters: ["is_active"],
  },
  agrochem_mode_of_actions: {
    table: "agrochem_mode_of_actions",
    select: "id,slug,name_ru,is_active,archived,updated_at,created_at",
    defaultOrder: "name_ru",
    scopeWhere: (query) => query,
    searchColumns: ["slug", "name_ru"],
    filters: ["is_active"],
  },
  agricultural_machine_models: {
    table: "agricultural_machine_models",
    select:
      "id,asset_group,category,brand,series,model,full_name,power_hp,engine,transmission,weight_kg,fuel_tank_l,tank_volume_l,tank_capacity_l,grain_tank_l,working_width_m,rows_count,capacity,required_power_hp,power_class,dealer_name,presence_in_kz,source_url,source_type,is_active,notes,archived,updated_at,created_at",
    defaultOrder: "full_name",
    scopeWhere: (query) => applyStandaloneAgriculturalMachineScope(query),
    searchColumns: ["full_name", "brand", "series", "model", "dealer_name", "engine", "transmission", "power_class", "capacity", "notes"],
    filters: ["asset_group", "category", "brand", "series", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      brand: normalizeMachineryBrand(row.brand),
      full_name: normalizeMachineryBrandText(row.full_name),
      asset_group: translateMachineryAssetGroup(row.asset_group),
      category: translateAgriculturalMachineCategory(row.category),
      source_type: translateAgriculturalMachineSourceType(row.source_type),
    }),
    beforeCreate: (payload) => ({
      ...payload,
      brand: normalizeMachineryBrand(payload.brand),
      asset_group: payload.asset_group || "self_propelled_machine",
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      ...(Object.prototype.hasOwnProperty.call(payload, "brand")
        ? { brand: normalizeMachineryBrand(payload.brand) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "asset_group")
        ? { asset_group: payload.asset_group || "self_propelled_machine" }
        : {}),
    }),
  },
  machinery: {
    table: "reference_machines",
    select:
      "id,name,full_name,brand,series,model,machine_category,machine_type,key_parameter,is_active,archived,updated_at,created_at",
    defaultOrder: "full_name",
    scopeWhere: (query) => applyGlobalScope(query),
    searchColumns: ["name", "full_name", "brand", "series", "model", "machine_type"],
    filters: ["machine_category", "brand", "machine_type", "is_active"],
    normalizeRow: (row) => normalizeMachineryBrandRow(row),
    beforeCreate: (payload) => ({
      ...normalizeMachineryBrandPayload(payload),
      name: payload.name || payload.full_name,
      type: payload.type || "other",
      status: payload.status || "free",
      company_id: null,
    }),
    beforeUpdate: (payload) => ({
      ...normalizeMachineryBrandPayload(payload),
      name: payload.name || payload.full_name,
    }),
  },
  implements: {
    table: "reference_equipment",
    select:
      "id,name,full_name,brand,series,model,equipment_category,purpose,key_parameter,is_active,archived,updated_at,created_at",
    defaultOrder: "full_name",
    scopeWhere: (query) => applyGlobalScope(query),
    searchColumns: ["name", "full_name", "brand", "series", "model", "purpose"],
    filters: ["equipment_category", "brand", "is_active"],
    normalizeRow: (row) => normalizeMachineryBrandRow(row),
    beforeCreate: (payload) => ({
      ...normalizeMachineryBrandPayload(payload),
      name: payload.name || payload.full_name,
      category: payload.equipment_category || payload.category || null,
      company_id: null,
    }),
    beforeUpdate: (payload) => ({
      ...normalizeMachineryBrandPayload(payload),
      name: payload.name || payload.full_name,
      category: payload.equipment_category || payload.category || null,
    }),
  },
  fleet: {
    table: "transport_models",
    select:
      "id,category,brand,series,model,full_name,engine,dealer_name,presence_in_kz,is_active,notes,archived,updated_at,created_at",
    defaultOrder: "full_name",
    scopeWhere: (query) => query,
    searchColumns: ["full_name", "brand", "series", "model", "engine", "dealer_name"],
    filters: ["category", "brand", "is_active"],
    normalizeRow: (row) => normalizeMachineryBrandRow(row),
    beforeCreate: (payload) => ({
      ...normalizeMachineryBrandPayload(payload),
      category: payload.category || "truck",
    }),
    beforeUpdate: (payload) => ({
      ...normalizeMachineryBrandPayload(payload),
      category: payload.category || "truck",
    }),
  },
};

function parseBool(value: string | null): boolean | null {
  if (value == null || value === "" || value === "all") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function normalizeSearchText(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/\b(кс|вдг|вр|sc|wg|ec|fs)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandProductSearchTerms(search: string): string[] {
  const normalized = normalizeSearchText(search);
  const terms = new Set<string>([search]);
  for (const group of PRODUCT_SEARCH_ALIASES) {
    if (!group.some((item) => normalizeSearchText(item) === normalized)) continue;
    group.forEach((item) => terms.add(item));
  }
  return Array.from(terms).filter(Boolean);
}

function productSearchMatches(row: any, search: string): boolean {
  const searchTerms = expandProductSearchTerms(search).map(normalizeSearchText);
  const componentTerms = Array.isArray(row.active_ingredient_components)
    ? row.active_ingredient_components.flatMap((component: any) => [
        component.displayName,
        component.nameEn,
        ...(Array.isArray(component.aliases) ? component.aliases : []),
      ])
    : [];
  const componentNeedle = normalizeGlbdSearchText(search);
  const componentMatch = componentNeedle
    ? componentTerms.some((value: any) =>
        normalizeGlbdSearchText(value).includes(componentNeedle)
      )
    : false;
  const hay = [
    row.trade_name,
    row.name,
    row.normalized_name,
    row.active_ingredients,
    row.active_ingredient,
    row.manufacturer_name,
    row.manufacturer,
  ].map(normalizeSearchText);
  return componentMatch || searchTerms.some((term) => term && hay.some((value) => value.includes(term)));
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolvePesticideCategoryIdBySlug(supabase: any, slugOrId: string | null | undefined) {
  const value = String(slugOrId || "").trim();
  if (!value) return null;
  if (isUuidLike(value)) return value;

  const { data } = await supabase
    .from("pesticide_categories")
    .select("id")
    .eq("archived", false)
    .ilike("slug", value)
    .maybeSingle();

  return data?.id || null;
}

async function assertGlobalAdminRequest(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (actor.role !== "global_admin") {
    throw new SessionAuthError("Доступ только для глобального администратора", 403);
  }
  return { supabase: getServiceClient(), actor };
}

function getEntityFromParams(entityRaw: string): GlobalCatalogEntity {
  if (!(entityRaw in ENTITY_CONFIG)) {
    throw new Error("Неизвестная сущность каталога");
  }
  return entityRaw as GlobalCatalogEntity;
}

function sanitizePayload(input: Record<string, any>) {
  const payload: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "id") continue;
    if (typeof value === "string") payload[key] = value.trim();
    else payload[key] = value;
  }
  return payload;
}

async function attachCropNamesToVarieties(supabase: any, rows: any[]) {
  if (!rows.length) return rows;

  const cropIds = Array.from(new Set(rows.map((row) => row.crop_id).filter(Boolean)));
  const originatorIds = Array.from(new Set(rows.map((row) => row.originator_id).filter(Boolean)));

  const [cropsResult, originatorsResult] = await Promise.all([
    cropIds.length
      ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug").in("id", cropIds)
      : Promise.resolve({ data: [], error: null }),
    originatorIds.length
      ? supabase.from("seed_originators").select("id,name").in("id", originatorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const cropMap = new Map<string, string>();
  for (const crop of cropsResult.data || []) {
    cropMap.set(crop.id, localizedName(crop, "ru") || "-");
  }

  const originatorMap = new Map<string, string>();
  for (const originator of originatorsResult.data || []) {
    originatorMap.set(originator.id, originator.name || "-");
  }

  return rows.map((row) => ({
    ...row,
    crop_name: cropMap.get(row.crop_id) || "-",
    originator_name: originatorMap.get(row.originator_id) || row.breeder_or_originator || "-",
  }));
}

async function attachSeedProductNames(supabase: any, rows: any[]) {
  if (!rows.length) return rows;

  const cropIds = Array.from(new Set(rows.map((row) => row.crop_id).filter(Boolean)));
  const varietyIds = Array.from(new Set(rows.map((row) => row.variety_id).filter(Boolean)));
  const reproductionIds = Array.from(new Set(rows.map((row) => row.seed_reproduction_id).filter(Boolean)));

  const [cropsResult, varietiesResult, reproductionsResult] = await Promise.all([
    cropIds.length
      ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug").in("id", cropIds)
      : Promise.resolve({ data: [], error: null }),
    varietyIds.length
      ? supabase
          .from("varieties")
          .select("id,name,originator_id,breeder_or_originator")
          .in("id", varietyIds)
      : Promise.resolve({ data: [], error: null }),
    reproductionIds.length
      ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const originatorIds = Array.from(
    new Set((varietiesResult.data || []).map((row: any) => row.originator_id).filter(Boolean))
  );

  const { data: originators } = originatorIds.length
    ? await supabase.from("seed_originators").select("id,name").in("id", originatorIds)
    : { data: [] };

  const cropMap = new Map<string, string>();
  for (const crop of cropsResult.data || []) {
    cropMap.set(crop.id, localizedName(crop, "ru") || "-");
  }

  const originatorMap = new Map<string, string>();
  for (const originator of originators || []) {
    originatorMap.set(originator.id, originator.name || "-");
  }

  const varietyMap = new Map<string, any>();
  for (const variety of varietiesResult.data || []) {
    varietyMap.set(variety.id, variety);
  }

  const reproductionMap = new Map<string, string>();
  for (const reproduction of reproductionsResult.data || []) {
    reproductionMap.set(reproduction.id, localizedName(reproduction, "ru") || reproduction.code || "-");
  }

  return rows.map((row) => {
    const variety = varietyMap.get(row.variety_id);
    return {
      ...row,
      crop_name: cropMap.get(row.crop_id) || "-",
      variety_name: variety?.name || "-",
      originator_name:
        (variety?.originator_id ? originatorMap.get(variety.originator_id) : null) ||
        variety?.breeder_or_originator ||
        "-",
      reproduction_name: reproductionMap.get(row.seed_reproduction_id) || "-",
    };
  });
}

async function loadGlbdComponentSearchIndex(supabase: any): Promise<GlbdComponentSearchEntry[]> {
  const [componentsResult, aliasesResult] = await Promise.all([
    supabase
      .from("glbd_components")
      .select(
        "id,legacy_active_ingredient_id,canonical_name,name_ru,name_en,component_type,is_active,archived_at"
      ),
    supabase
      .from("glbd_component_aliases")
      .select("component_id,alias_text,normalized_text,language"),
  ]);

  if (componentsResult.error) {
    throw new Error(`Не удалось загрузить компоненты GLBD: ${componentsResult.error.message}`);
  }
  if (aliasesResult.error) {
    throw new Error(`Не удалось загрузить дополнительные названия GLBD: ${aliasesResult.error.message}`);
  }

  return buildGlbdComponentSearchEntries(
    componentsResult.data || [],
    aliasesResult.data || []
  );
}

function glbdSearchConflict(index: GlbdComponentSearchEntry[], search: string) {
  const matches = findExactGlbdAliasConflict(index, search);
  const uniqueIds = new Set(matches.map((component) => component.id));
  if (uniqueIds.size < 2) return null;
  return {
    message: "Этот вариант названия относится к нескольким компонентам. Уточните официальное название.",
    components: matches.map(glbdComponentDisplayName),
  };
}

function attachGlbdComponentsToLegacyIngredients(
  rows: any[],
  index: GlbdComponentSearchEntry[],
  search: string
) {
  const byLegacyId = new Map<string, GlbdComponentSearchEntry>();
  const byComponentId = new Map<string, GlbdComponentSearchEntry>();
  for (const component of index) {
    byComponentId.set(component.id, component);
    if (!isVisibleGlbdComponent(component) || !component.legacy_active_ingredient_id) continue;
    byLegacyId.set(component.legacy_active_ingredient_id, component);
  }

  const enriched = rows.map((row) => {
    const component = byLegacyId.get(row.id);
    if (!component) return row;
    return {
      ...row,
      name_ru: component.name_ru || row.name_ru,
      name_en: component.name_en || row.name_en,
      canonical_name: component.canonical_name || row.name_en || row.name_ru,
      glbd_component_id: component.id,
      glbd_component_type: component.component_type,
      glbd_component_type_label: glbdComponentTypeLabel(component.component_type),
      glbd_aliases: component.aliases.map((alias) => alias.alias_text).filter(Boolean),
      matched_alias: search ? matchedGlbdAlias(component, search) : null,
    };
  });

  const filtered = search
    ? enriched.filter((row) => {
        const component = row.glbd_component_id
          ? byComponentId.get(row.glbd_component_id)
          : null;
        return component
          ? glbdComponentMatchesSearch(component, search)
          : [row.name_ru, row.name_en, row.slug, row.description]
              .map(normalizeSearchText)
              .some((value) => value.includes(normalizeSearchText(search)));
      })
    : enriched;

  return dedupeByCanonicalComponent(filtered);
}

async function loadGlbdComponentCard(supabase: any, componentId: string) {
  const [componentResult, aliasesResult, sourcesResult] = await Promise.all([
    supabase
      .from("glbd_components")
      .select("id,canonical_name,name_ru,name_en,component_type,is_active,archived_at")
      .eq("id", componentId)
      .eq("is_active", true)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("glbd_component_aliases")
      .select("alias_text,normalized_text")
      .eq("component_id", componentId),
    supabase
      .from("glbd_component_sources")
      .select("id,component_id,source_type,source_url,source_title,claim_scope,checked_at")
      .eq("component_id", componentId)
      .neq("source_type", "needs_source")
      .order("checked_at", { ascending: false, nullsFirst: false }),
  ]);

  if (componentResult.error) throw new Error(componentResult.error.message);
  if (!componentResult.data) return null;
  if (aliasesResult.error) throw new Error(aliasesResult.error.message);
  if (sourcesResult.error) throw new Error(sourcesResult.error.message);

  const component = componentResult.data;
  const primaryNames = new Set(
    [component.name_ru, component.name_en, component.canonical_name]
      .map(normalizeGlbdSearchText)
      .filter(Boolean)
  );
  const aliasNames = Array.from(
    new Set(
      (aliasesResult.data || [])
        .map((alias: any) => String(alias.alias_text || alias.normalized_text || "").trim())
        .filter((alias: string) => alias && !primaryNames.has(normalizeGlbdSearchText(alias)))
    )
  );
  const sources = (sourcesResult.data || [])
    .map(toGlbdComponentSourceDisplay)
    .filter(Boolean);

  return {
    id: component.id,
    displayName: glbdComponentDisplayName(component),
    nameEn:
      component.name_en && component.name_en !== component.name_ru
        ? component.name_en
        : null,
    typeLabel: glbdComponentTypeLabel(component.component_type),
    aliases: aliasNames,
    sources,
  };
}

async function attachActiveIngredientsToProducts(
  supabase: any,
  rows: any[],
  glbdIndex?: GlbdComponentSearchEntry[]
) {
  if (!rows.length) return rows;

  const productIds = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  if (!productIds.length) {
    return rows.map((row) => ({ ...row, active_ingredient: "-", active_ingredients: "-" }));
  }

  const { data: links, error: linksError } = await supabase
    .from("product_active_ingredients")
    .select("product_id, active_ingredient_id, sort_order")
    .in("product_id", productIds);

  if (linksError || !links?.length) {
    return rows.map((row) => ({ ...row, active_ingredient: "-", active_ingredients: "-" }));
  }

  const ingredientIds = Array.from(
    new Set(links.map((link: any) => link.active_ingredient_id).filter(Boolean))
  );

  if (!ingredientIds.length) {
    return rows.map((row) => ({ ...row, active_ingredient: "-", active_ingredients: "-" }));
  }

  const { data: ingredients, error: ingredientsError } = await supabase
    .from("active_ingredients")
    .select("id, name_ru, name_en, slug")
    .in("id", ingredientIds)
    .eq("archived", false);

  if (ingredientsError || !ingredients?.length) {
    return rows.map((row) => ({ ...row, active_ingredient: "-", active_ingredients: "-" }));
  }

  const resolvedGlbdIndex = glbdIndex || (await loadGlbdComponentSearchIndex(supabase));
  const componentByLegacyIngredientId = new Map<string, GlbdComponentSearchEntry>();
  for (const component of resolvedGlbdIndex) {
    if (!isVisibleGlbdComponent(component) || !component.legacy_active_ingredient_id) continue;
    componentByLegacyIngredientId.set(component.legacy_active_ingredient_id, component);
  }

  const ingredientNameById = new Map<string, string>();
  for (const ingredient of ingredients) {
    const component = componentByLegacyIngredientId.get(ingredient.id);
    ingredientNameById.set(
      ingredient.id,
      (component ? glbdComponentDisplayName(component) : null) ||
        ingredient.name_ru ||
        ingredient.name_en ||
        ingredient.slug ||
        "-"
    );
  }

  const linksByProductId = new Map<string, any[]>();
  for (const link of links) {
    const list = linksByProductId.get(link.product_id) || [];
    list.push(link);
    linksByProductId.set(link.product_id, list);
  }

  const categoryIds = Array.from(new Set(rows.map((row) => row.category_id).filter(Boolean)));
  const manufacturerIds = Array.from(new Set(rows.map((row) => row.manufacturer_id).filter(Boolean)));
  const formulationIds = Array.from(new Set(rows.map((row) => row.formulation_id).filter(Boolean)));
  const modeIds = Array.from(new Set(rows.map((row) => row.mode_of_action_type_id).filter(Boolean)));

  const [categoryRes, manufacturerRes, formulationRes, modeRes] = await Promise.all([
    categoryIds.length
      ? supabase.from("pesticide_categories").select("id,name_ru,slug").in("id", categoryIds)
      : Promise.resolve({ data: [], error: null }),
    manufacturerIds.length
      ? supabase.from("agrochem_manufacturers").select("id,name").in("id", manufacturerIds)
      : Promise.resolve({ data: [], error: null }),
    formulationIds.length
      ? supabase.from("agrochem_formulations").select("id,code,name_ru").in("id", formulationIds)
      : Promise.resolve({ data: [], error: null }),
    modeIds.length
      ? supabase.from("agrochem_mode_of_actions").select("id,slug,name_ru").in("id", modeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const categoryMap = new Map<string, string>((categoryRes.data || []).map((c: any) => [c.id, c.name_ru || c.slug || "-"]));
  const manufacturerMap = new Map<string, string>((manufacturerRes.data || []).map((m: any) => [m.id, m.name || "-"]));
  const formulationMap = new Map<string, string>((formulationRes.data || []).map((f: any) => [f.id, f.name_ru || f.code || "-"]));
  const modeMap = new Map<string, string>((modeRes.data || []).map((m: any) => [m.id, m.name_ru || translateModeOfAction(m.slug)]));

  return rows.map((row) => {
    const productLinks = (linksByProductId.get(row.id) || []).sort((a, b) => {
      const sa = a.sort_order ?? 999999;
      const sb = b.sort_order ?? 999999;
      return sa - sb;
    });

    const dedup = new Set<string>();
    const names: string[] = [];
    const components: Array<{
      id: string;
      legacyIngredientId: string;
      displayName: string;
      nameEn: string | null;
      typeLabel: string;
      aliases: string[];
    }> = [];

    for (const link of productLinks) {
      const name = ingredientNameById.get(link.active_ingredient_id);
      if (!name || name === "-") continue;
      const component = componentByLegacyIngredientId.get(link.active_ingredient_id);
      const key = component?.id || name.trim().toLowerCase();
      if (!key || dedup.has(key)) continue;
      dedup.add(key);
      names.push(name);
      if (component) {
        components.push({
          id: component.id,
          legacyIngredientId: link.active_ingredient_id,
          displayName: glbdComponentDisplayName(component),
          nameEn:
            component.name_en && component.name_en !== component.name_ru
              ? component.name_en
              : null,
          typeLabel: glbdComponentTypeLabel(component.component_type),
          aliases: component.aliases
            .map((alias) => String(alias.alias_text || "").trim())
            .filter(Boolean),
        });
      }
    }

    const text = names.length ? names.join(", ") : "-";

    return {
      ...row,
      active_ingredient: text,
      active_ingredients: text,
      active_ingredient_components: components,
      pesticide_category:
        categoryMap.get(row.category_id) ||
        row.pesticide_category ||
        row.category_slug ||
        row.source_category_slug ||
        "-",
      manufacturer_name: manufacturerMap.get(row.manufacturer_id) || row.manufacturer || "-",
      formulation_name: formulationMap.get(row.formulation_id) || row.formulation || "-",
      mode_of_action_type_name:
        modeMap.get(row.mode_of_action_type_id) || translateModeOfAction(row.mode_of_action_type),
    };
  });
}

async function syncProductActiveIngredients(
  supabase: any,
  productId: string,
  activeIngredientIds: string[] | undefined
) {
  if (!Array.isArray(activeIngredientIds)) return;

  const validIds = Array.from(
    new Set(activeIngredientIds.map((id) => String(id || "").trim()).filter((id) => isUuidLike(id)))
  );

  await supabase.from("product_active_ingredients").delete().eq("product_id", productId);

  if (!validIds.length) return;

  const payload = validIds.map((activeIngredientId, index) => ({
    product_id: productId,
    active_ingredient_id: activeIngredientId,
    sort_order: index + 1,
  }));

  await supabase
    .from("product_active_ingredients")
    .insert(payload)
    .select("product_id");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { entity: rawEntity } = await params;
    const entity = getEntityFromParams(rawEntity);
    const config = ENTITY_CONFIG[entity];
    const { supabase } = await assertGlobalAdminRequest(request);

    const componentId = String(request.nextUrl.searchParams.get("componentId") || "").trim();
    if (entity === "active_ingredients" && componentId) {
      if (!isUuidLike(componentId)) {
        return NextResponse.json({ error: "Некорректный идентификатор компонента" }, { status: 400 });
      }
      const component = await loadGlbdComponentCard(supabase, componentId);
      if (!component) {
        return NextResponse.json({ error: "Компонент не найден или архивирован" }, { status: 404 });
      }
      return NextResponse.json({ component });
    }

    const search = String(request.nextUrl.searchParams.get("search") || "").trim();
    const rowId = String(request.nextUrl.searchParams.get("id") || "").trim();
    if (rowId && !isUuidLike(rowId)) {
      return NextResponse.json({ error: "Некорректный идентификатор записи" }, { status: 400 });
    }
    const productEntity =
      entity === "pesticides" ||
      entity === "fertilizers" ||
      entity === "additives" ||
      entity === "growth_regulators";
    const componentProductEntity = entity === "pesticides" || entity === "growth_regulators";
    let glbdIndex: GlbdComponentSearchEntry[] | undefined;
    const matchingProductIdSet = new Set<string>();

    if (entity === "active_ingredients" || componentProductEntity) {
      glbdIndex = await loadGlbdComponentSearchIndex(supabase);
    }

    if (search && productEntity) {
      const aliasMatches = await Promise.all(
        expandProductSearchTerms(search).map((term) =>
          supabase
            .from("global_product_aliases")
            .select("product_id")
            .ilike("alias", `%${term}%`)
            .limit(1000)
        )
      );
      for (const result of aliasMatches) {
        if (result.error) throw new Error(result.error.message);
        for (const row of result.data || []) {
          if (row.product_id) matchingProductIdSet.add(String(row.product_id));
        }
      }
    }

    if (search && componentProductEntity && glbdIndex) {
      const legacyIngredientIds = glbdIndex
        .filter(
          (component) =>
            isVisibleGlbdComponent(component) &&
            Boolean(component.legacy_active_ingredient_id) &&
            glbdComponentMatchesSearch(component, search)
        )
        .map((component) => component.legacy_active_ingredient_id as string);

      if (legacyIngredientIds.length) {
        const { data: matchedLinks, error: matchedLinksError } = await supabase
          .from("product_active_ingredients")
          .select("product_id")
          .in("active_ingredient_id", legacyIngredientIds);
        if (matchedLinksError) throw new Error(matchedLinksError.message);
        for (const link of matchedLinks || []) {
          if (link.product_id) matchingProductIdSet.add(String(link.product_id));
        }
      }
    }

    const matchingProductIds = Array.from(matchingProductIdSet);
    let query = supabase.from(config.table).select(config.select);
    query = config.scopeWhere(query);
    query = query.eq("archived", false);
    if (rowId) query = query.eq("id", rowId);

    if (search && entity !== "active_ingredients") {
      const searchTerms =
        productEntity ? expandProductSearchTerms(search) : [search];
      const orParts = searchTerms.flatMap((term) => config.searchColumns.map((column) => `${column}.ilike.%${term}%`));
      if (productEntity && matchingProductIds.length) {
        orParts.push(`id.in.(${matchingProductIds.join(",")})`);
      }
      query = query.or(orParts.join(","));
    }

    for (const filterKey of config.filters) {
      const value = request.nextUrl.searchParams.get(filterKey);
      if (!value || value === "all") continue;

      if (filterKey === "is_active") {
        const bool = parseBool(value);
        if (bool !== null) query = query.eq("is_active", bool);
        continue;
      }

      if (filterKey === "is_common_in_kz") {
        const bool = parseBool(value);
        if (bool !== null) query = query.eq("is_common_in_kz", bool);
        continue;
      }

      if (filterKey === "pesticide_subcategory") {
        query = query.contains("pesticide_subcategories", [value]);
        continue;
      }

      if (filterKey === "category_id" && entity === "crops") {
        if (isUuidLike(value)) {
          query = query.eq("category_id", value);
        } else {
          query = query.eq("category_id", "00000000-0000-0000-0000-000000000000");
        }
        continue;
      }

      if (filterKey === "category_id") {
        const resolvedCategoryId = await resolvePesticideCategoryIdBySlug(supabase, value);
        if (resolvedCategoryId) {
          query = query.eq("category_id", resolvedCategoryId);
        } else {
          query = query.eq("category_id", "00000000-0000-0000-0000-000000000000");
        }
        continue;
      }

      if (filterKey === "active_ingredient_ids") {
        const ingredientIds = String(value)
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item && isUuidLike(item));
        if (!ingredientIds.length) continue;

        const { data: matchedLinks } = await supabase
          .from("product_active_ingredients")
          .select("product_id,active_ingredient_id")
          .in("active_ingredient_id", ingredientIds);

        const productIdSet = new Set<string>();
        for (const link of matchedLinks || []) {
          if (link.product_id) productIdSet.add(link.product_id);
        }

        const productIds = Array.from(productIdSet);
        if (!productIds.length) {
          query = query.eq("id", "00000000-0000-0000-0000-000000000000");
        } else {
          query = query.in("id", productIds);
        }
        continue;
      }

      if (filterKey === "brand" && isMachineryCatalogEntity(entity)) {
        query = query.ilike("brand", value);
        continue;
      }

      query = query.eq(filterKey, value);
    }

    query = query.order(config.defaultOrder, { ascending: true, nullsFirst: false });

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rawRows = data || [];
    let hydratedRows = rawRows;
    if (entity === "active_ingredients" && glbdIndex) {
      hydratedRows = attachGlbdComponentsToLegacyIngredients(rawRows, glbdIndex, search);
    } else if (entity === "varieties") {
      hydratedRows = await attachCropNamesToVarieties(supabase, rawRows);
    } else if (entity === "seeds") {
      hydratedRows = await attachSeedProductNames(supabase, rawRows);
    } else if (entity === "pesticides") {
      hydratedRows = await attachActiveIngredientsToProducts(supabase, rawRows, glbdIndex);
    } else if (entity === "growth_regulators") {
      hydratedRows = await attachActiveIngredientsToProducts(supabase, rawRows, glbdIndex);
    }

    if (search && (entity === "pesticides" || entity === "fertilizers" || entity === "additives" || entity === "growth_regulators")) {
      hydratedRows = hydratedRows.filter(
        (row: any) => matchingProductIdSet.has(String(row?.id || "")) || productSearchMatches(row, search)
      );
    }

    const rows = hydratedRows.map((row: any) => (config.normalizeRow ? config.normalizeRow(row) : row));
    const searchConflict = search && glbdIndex ? glbdSearchConflict(glbdIndex, search) : null;
    return NextResponse.json({ rows, searchConflict });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { entity: rawEntity } = await params;
    const entity = getEntityFromParams(rawEntity);
    const body = await request.json();

    const config = ENTITY_CONFIG[entity];
    const { supabase, actor } = await assertGlobalAdminRequest(request);
    const payload = sanitizePayload(body?.payload || {});
    const normalized = config.beforeCreate ? config.beforeCreate(payload) : payload;
    const selectedActiveIngredientIds = Array.isArray(normalized.active_ingredient_ids)
      ? normalized.active_ingredient_ids
      : undefined;
    delete normalized.active_ingredient_ids;
    if (entity === "pesticides" && !normalized.category_id) {
      normalized.category_id = await resolvePesticideCategoryIdBySlug(
        supabase,
        normalized.pesticide_category || normalized.category_slug || normalized.source_category_slug
      );
    }

    if (entity === "fertilizers") {
      const categoryId = String(normalized.fertilizer_category_id || "").trim();
      const composition = String(normalized.composition || "").trim();
      const formulationId = String(normalized.formulation_id || "").trim();
      if (!categoryId || !composition || !formulationId || !normalized.application_scope) {
        return NextResponse.json({ error: "Для удобрения обязательны категория, состав, форма и применение" }, { status: 400 });
      }
      const [{ data: category }, { data: manufacturer }, { data: formulation }] = await Promise.all([
        supabase.from("fertilizer_categories").select("id,slug,name_ru").eq("id", categoryId).eq("is_active", true).eq("archived", false).maybeSingle(),
        normalized.manufacturer_id
          ? supabase.from("agrochem_manufacturers").select("id,name").eq("id", normalized.manufacturer_id).eq("is_active", true).eq("archived", false).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("agrochem_formulations").select("id,name_ru").eq("id", formulationId).eq("is_active", true).eq("archived", false).maybeSingle(),
      ]);
      if (!category || !formulation) {
        return NextResponse.json({ error: "Категория или форма удобрения не найдена" }, { status: 400 });
      }
      normalized.fertilizer_type = category.slug;
      normalized.catalog_category_slug = category.slug;
      normalized.catalog_category_label = category.name_ru;
      normalized.category = "fertilizer";
      normalized.category_id = null;
      normalized.manufacturer = manufacturer?.name || null;
      normalized.formulation = formulation.name_ru;
      normalized.product_form = formulation.name_ru;
      normalized.active_ingredient = null;
    }

    if (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") {
      const tradeName = String(normalized.trade_name || normalized.name || "").trim();
      if (!tradeName) {
        return NextResponse.json({ error: "Торговое название обязательно" }, { status: 400 });
      }
      if (entity !== "fertilizers" && !normalized.category_id) {
        return NextResponse.json({ error: "Категория обязательна" }, { status: 400 });
      }
      if (entity !== "fertilizers" && !selectedActiveIngredientIds?.length) {
        return NextResponse.json({ error: "Выберите минимум одно действующее вещество" }, { status: 400 });
      }

      const { data: existedProducts } = await supabase
        .from("products")
        .select("id,manufacturer,manufacturer_id")
        .is("company_id", null)
        .eq("archived", false)
        .ilike("trade_name", tradeName);
      const manufacturerIdentity = normalizeCatalogName(normalized.manufacturer || "");
      const existedProduct = (existedProducts || []).find((row: any) =>
        entity !== "fertilizers" || normalizeCatalogName(row.manufacturer || "") === manufacturerIdentity
      );
      if (existedProduct?.id) {
        return NextResponse.json({ error: "Продукт с таким торговым названием уже существует" }, { status: 400 });
      }
    }

    normalized.user_id = actor.id;
    normalized.archived = false;
    if (normalized.is_active == null) normalized.is_active = true;

    const { data, error } = await supabase.from(config.table).insert(normalized).select(config.select).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (
      (entity === "pesticides" || entity === "growth_regulators") &&
      data &&
      typeof data === "object" &&
      "id" in data
    ) {
      await syncProductActiveIngredients(supabase, String((data as any).id), selectedActiveIngredientIds);
    }

    let hydratedRows = [data];
    if (entity === "varieties") {
      hydratedRows = await attachCropNamesToVarieties(supabase, [data]);
    } else if (entity === "seeds") {
      hydratedRows = await attachSeedProductNames(supabase, [data]);
    } else if (entity === "pesticides" || entity === "growth_regulators") {
      hydratedRows = await attachActiveIngredientsToProducts(supabase, [data]);
    }
    const row = hydratedRows[0];

    return NextResponse.json({ row: config.normalizeRow ? config.normalizeRow(row) : row });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { entity: rawEntity } = await params;
    const entity = getEntityFromParams(rawEntity);
    const body = await request.json();
    const id = String(body?.id || "").trim();
    if (!id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });
    const config = ENTITY_CONFIG[entity];
    const { supabase } = await assertGlobalAdminRequest(request);
    const payload = sanitizePayload(body?.payload || {});
    const normalized = config.beforeUpdate ? config.beforeUpdate(payload) : payload;
    const selectedActiveIngredientIds = Array.isArray(normalized.active_ingredient_ids)
      ? normalized.active_ingredient_ids
      : undefined;
    delete normalized.active_ingredient_ids;
    if (entity === "fertilizers") {
      const categoryId = String(normalized.fertilizer_category_id || "").trim();
      if (!categoryId) {
        return NextResponse.json({ error: "Категория удобрения обязательна" }, { status: 400 });
      }
      const [{ data: category }, { data: manufacturer }, { data: formulation }] = await Promise.all([
        supabase.from("fertilizer_categories").select("id,slug,name_ru").eq("id", categoryId).eq("is_active", true).eq("archived", false).maybeSingle(),
        normalized.manufacturer_id
          ? supabase.from("agrochem_manufacturers").select("id,name").eq("id", normalized.manufacturer_id).eq("is_active", true).eq("archived", false).maybeSingle()
          : Promise.resolve({ data: null }),
        normalized.formulation_id
          ? supabase.from("agrochem_formulations").select("id,name_ru").eq("id", normalized.formulation_id).eq("is_active", true).eq("archived", false).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!category || !formulation) {
        return NextResponse.json({ error: "Категория или форма удобрения не найдена" }, { status: 400 });
      }
      normalized.fertilizer_type = category.slug;
      normalized.catalog_category_slug = category.slug;
      normalized.catalog_category_label = category.name_ru;
      normalized.category = "fertilizer";
      normalized.category_id = null;
      normalized.manufacturer = manufacturer?.name || null;
      normalized.formulation = formulation.name_ru;
      normalized.product_form = formulation.name_ru;
      normalized.active_ingredient = null;
    }

    if (entity === "pesticides" || entity === "growth_regulators") {
      const nextCategoryId = await resolvePesticideCategoryIdBySlug(
        supabase,
        normalized.category_id || normalized.pesticide_category || normalized.category_slug || normalized.source_category_slug
      );
      if (nextCategoryId) {
        normalized.category_id = nextCategoryId;
      }
    }

    if (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") {
      const nextTradeName = String(normalized.trade_name || normalized.name || "").trim();
      if (nextTradeName) {
        const { data: existedProducts } = await supabase
          .from("products")
          .select("id,manufacturer")
          .is("company_id", null)
          .eq("archived", false)
          .ilike("trade_name", nextTradeName)
          .neq("id", id);
        const manufacturerIdentity = normalizeCatalogName(normalized.manufacturer || "");
        const existedProduct = (existedProducts || []).find((row: any) =>
          entity !== "fertilizers" || normalizeCatalogName(row.manufacturer || "") === manufacturerIdentity
        );
        if (existedProduct?.id) {
          return NextResponse.json({ error: "Продукт с таким торговым названием уже существует" }, { status: 400 });
        }
      }
    }

    const { data, error } = await supabase
      .from(config.table)
      .update(normalized)
      .eq("id", id)
      .select(config.select)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (
      (entity === "pesticides" || entity === "growth_regulators") &&
      data &&
      typeof data === "object" &&
      "id" in data
    ) {
      await syncProductActiveIngredients(supabase, String((data as any).id), selectedActiveIngredientIds);
    }
    let hydratedRows = [data];
    if (entity === "varieties") {
      hydratedRows = await attachCropNamesToVarieties(supabase, [data]);
    } else if (entity === "seeds") {
      hydratedRows = await attachSeedProductNames(supabase, [data]);
    } else if (entity === "pesticides" || entity === "growth_regulators") {
      hydratedRows = await attachActiveIngredientsToProducts(supabase, [data]);
    }
    const row = hydratedRows[0];

    return NextResponse.json({ row: config.normalizeRow ? config.normalizeRow(row) : row });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { entity: rawEntity } = await params;
    const entity = getEntityFromParams(rawEntity);
    const body = await request.json();
    const id = String(body?.id || "").trim();
    if (!id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });
    const config = ENTITY_CONFIG[entity];
    const { supabase } = await assertGlobalAdminRequest(request);
    const { error } = await supabase
      .from(config.table)
      .update({ archived: true, is_active: false })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}
