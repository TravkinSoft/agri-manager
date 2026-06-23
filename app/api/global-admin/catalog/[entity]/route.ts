import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { localizedName } from "@/lib/i18n/helpers";
import type { GlobalCatalogEntity } from "@/lib/platform/global-catalog-config";

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
  ["revus top", "revus top sc", "ревус топ"],
  ["celest top", "celest top fs", "селест топ"],
  ["black jack", "blackjack", "блек джек"],
] as const;

function applyGlobalScope(query: any) {
  return query.or(`company_id.is.null,company_id.eq.${PLATFORM_GLOBAL_COMPANY_ID}`);
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

const ENTITY_CONFIG: Record<GlobalCatalogEntity, EntityConfig> = {
  crops: {
    table: "crops",
    select: "*, crop_categories:category_id(id,name_ru,slug)",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: ["name", "name_ru", "name_en", "slug", "subcategory", "crop_subcategory", "category", "crop_category"],
    filters: ["crop_category", "crop_subcategory", "is_common_in_kz", "is_active"],
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
  pesticides: {
    table: "products",
    select: "*",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null).eq("product_type", "pesticide"),
    searchColumns: ["name", "trade_name"],
    filters: ["product_type", "category_id", "manufacturer_id", "formulation_id", "mode_of_action_type_id", "active_ingredient_ids", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      trade_name: row.trade_name || row.name || "-",
      active_ingredients: row.active_ingredients || row.active_ingredient || "-",
      pesticide_category: row.pesticide_category || "-",
      mode_of_action_type: row.mode_of_action_type_name || translateModeOfAction(row.mode_of_action_type),
      formulation: row.formulation_name || row.formulation || "-",
      manufacturer: row.manufacturer_name || row.manufacturer || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...payload,
      type: "pesticide",
      product_type: "pesticide",
      company_id: null,
      unit: payload.default_unit || "l",
    }),
  },
  fertilizers: {
    table: "products",
    select: "*",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null).eq("product_type", "fertilizer"),
    searchColumns: ["name", "trade_name"],
    filters: ["product_type", "category_id", "manufacturer_id", "formulation_id", "mode_of_action_type_id", "active_ingredient_ids", "fertilizer_type", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      trade_name: row.trade_name || row.name || "-",
      active_ingredients: row.active_ingredients || row.active_ingredient || "-",
      pesticide_category: row.pesticide_category || "-",
      mode_of_action_type: row.mode_of_action_type_name || translateModeOfAction(row.mode_of_action_type),
      formulation: row.formulation_name || row.formulation || "-",
      manufacturer: row.manufacturer_name || row.manufacturer || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...payload,
      type: "fertilizer",
      product_type: "fertilizer",
      company_id: null,
      unit: payload.default_unit || "kg",
    }),
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
      ...row,
      trade_name: row.trade_name || row.name || "-",
      subcategory: row.subcategory || row.pesticide_category || row.category || "-",
      formulation: row.formulation_name || row.formulation || "-",
      manufacturer: row.manufacturer_name || row.manufacturer || "-",
      default_unit: row.default_unit || row.unit || row.base_uom || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...payload,
      type: "pesticide",
      product_type: "additive",
      category: "additive",
      pesticide_category: null,
      fertilizer_type: null,
      company_id: null,
      unit: payload.default_unit || "l",
      base_uom: payload.default_unit || "l",
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      product_type: "additive",
      category: "additive",
      pesticide_category: null,
      fertilizer_type: null,
      unit: payload.default_unit || payload.unit || "l",
      base_uom: payload.default_unit || payload.base_uom || "l",
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
      ...row,
      trade_name: row.trade_name || row.name || "-",
      active_ingredients: row.active_ingredients || row.active_ingredient || "-",
      pesticide_category: row.pesticide_category || "-",
      mode_of_action_type: row.mode_of_action_type_name || translateModeOfAction(row.mode_of_action_type),
      formulation: row.formulation_name || row.formulation || "-",
      manufacturer: row.manufacturer_name || row.manufacturer || "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...payload,
      type: "pesticide",
      product_type: "growth_regulator",
      company_id: null,
      unit: payload.default_unit || "l",
    }),
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
    scopeWhere: (query) => query,
    searchColumns: ["full_name", "brand", "series", "model", "dealer_name", "engine", "transmission", "power_class", "capacity", "notes"],
    filters: ["asset_group", "category", "brand", "series", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      asset_group: translateMachineryAssetGroup(row.asset_group),
      category: translateAgriculturalMachineCategory(row.category),
      source_type: translateAgriculturalMachineSourceType(row.source_type),
    }),
    beforeCreate: (payload) => ({
      ...payload,
      asset_group: payload.asset_group || "self_propelled_machine",
    }),
    beforeUpdate: (payload) => ({
      ...payload,
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
    beforeCreate: (payload) => ({
      ...payload,
      name: payload.name || payload.full_name,
      type: payload.type || "other",
      status: payload.status || "free",
      company_id: null,
    }),
    beforeUpdate: (payload) => ({
      ...payload,
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
    beforeCreate: (payload) => ({
      ...payload,
      name: payload.name || payload.full_name,
      category: payload.equipment_category || payload.category || null,
      company_id: null,
    }),
    beforeUpdate: (payload) => ({
      ...payload,
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
    beforeCreate: (payload) => ({
      ...payload,
      category: payload.category || "truck",
    }),
    beforeUpdate: (payload) => ({
      ...payload,
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
  const hay = [
    row.trade_name,
    row.name,
    row.normalized_name,
    row.active_ingredients,
    row.active_ingredient,
    row.manufacturer_name,
    row.manufacturer,
  ].map(normalizeSearchText);
  return searchTerms.some((term) => term && hay.some((value) => value.includes(term)));
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

async function assertGlobalAdmin(userId: string) {
  const supabase = getServiceClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, status")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile?.id) throw new Error("Профиль пользователя не найден");
  if (String(profile.role || "").toLowerCase() !== "global_admin") {
    throw new Error("Доступ только для глобального администратора");
  }
  if (String(profile.status || "active") !== "active") {
    throw new Error("Профиль глобального администратора неактивен");
  }

  return supabase;
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

async function attachActiveIngredientsToProducts(supabase: any, rows: any[]) {
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

  const ingredientNameById = new Map<string, string>();
  for (const ingredient of ingredients) {
    ingredientNameById.set(
      ingredient.id,
      ingredient.name_ru || ingredient.name_en || ingredient.slug || "-"
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

    for (const link of productLinks) {
      const name = ingredientNameById.get(link.active_ingredient_id);
      if (!name || name === "-") continue;
      const key = name.trim().toLowerCase();
      if (!key || dedup.has(key)) continue;
      dedup.add(key);
      names.push(name);
    }

    const text = names.length ? names.join(", ") : "-";

    return {
      ...row,
      active_ingredient: text,
      active_ingredients: text,
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

    let query = supabase.from(config.table).select(config.select);
    query = config.scopeWhere(query);
    query = query.eq("archived", false);

    const search = String(request.nextUrl.searchParams.get("search") || "").trim();
    if (search) {
      const searchTerms =
        entity === "pesticides" || entity === "fertilizers" || entity === "additives" || entity === "growth_regulators"
          ? expandProductSearchTerms(search)
          : [search];
      const orParts = searchTerms.flatMap((term) => config.searchColumns.map((column) => `${column}.ilike.%${term}%`));
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

      query = query.eq(filterKey, value);
    }

    query = query.order(config.defaultOrder, { ascending: true, nullsFirst: false });

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rawRows = data || [];
    let hydratedRows = rawRows;
    if (entity === "varieties") {
      hydratedRows = await attachCropNamesToVarieties(supabase, rawRows);
    } else if (entity === "seeds") {
      hydratedRows = await attachSeedProductNames(supabase, rawRows);
    } else if (entity === "pesticides" || entity === "fertilizers") {
      hydratedRows = await attachActiveIngredientsToProducts(supabase, rawRows);
    } else if (entity === "growth_regulators") {
      hydratedRows = await attachActiveIngredientsToProducts(supabase, rawRows);
    }

    if (search && (entity === "pesticides" || entity === "fertilizers" || entity === "additives" || entity === "growth_regulators")) {
      hydratedRows = hydratedRows.filter((row: any) => productSearchMatches(row, search));
    }

    const rows = hydratedRows.map((row: any) => (config.normalizeRow ? config.normalizeRow(row) : row));
    return NextResponse.json({ rows });
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
    if ((entity === "pesticides" || entity === "fertilizers") && !normalized.category_id) {
      normalized.category_id = await resolvePesticideCategoryIdBySlug(
        supabase,
        normalized.pesticide_category || normalized.category_slug || normalized.source_category_slug
      );
    }

    if (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") {
      const tradeName = String(normalized.trade_name || normalized.name || "").trim();
      if (!tradeName) {
        return NextResponse.json({ error: "Торговое название обязательно" }, { status: 400 });
      }
      if (!normalized.category_id) {
        return NextResponse.json({ error: "Категория обязательна" }, { status: 400 });
      }
      if (!selectedActiveIngredientIds?.length) {
        return NextResponse.json({ error: "Выберите минимум одно действующее вещество" }, { status: 400 });
      }

      const { data: existedProduct } = await supabase
        .from("products")
        .select("id")
        .is("company_id", null)
        .eq("archived", false)
        .ilike("trade_name", tradeName)
        .maybeSingle();
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
      (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") &&
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
    } else if (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") {
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
    if (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") {
      const nextCategoryId = await resolvePesticideCategoryIdBySlug(
        supabase,
        normalized.category_id || normalized.pesticide_category || normalized.category_slug || normalized.source_category_slug
      );
      if (nextCategoryId) {
        normalized.category_id = nextCategoryId;
      }

      const nextTradeName = String(normalized.trade_name || normalized.name || "").trim();
      if (nextTradeName) {
        const { data: existedProduct } = await supabase
          .from("products")
          .select("id")
          .is("company_id", null)
          .eq("archived", false)
          .ilike("trade_name", nextTradeName)
          .neq("id", id)
          .maybeSingle();
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
      (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") &&
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
    } else if (entity === "pesticides" || entity === "fertilizers" || entity === "growth_regulators") {
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
