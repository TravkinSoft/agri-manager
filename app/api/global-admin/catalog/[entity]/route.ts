import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
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
      "id,name,crop_id,origin_country,variety_type,is_common_in_kz,is_active,archived,updated_at,created_at",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: ["name", "origin_country", "variety_type"],
    filters: ["crop_id", "origin_country", "is_common_in_kz", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      crop_name: row.crop_name || "-",
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
  pesticides: {
    table: "products",
    select: "*",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null).eq("type", "pesticide"),
    searchColumns: ["name", "trade_name", "active_ingredient", "manufacturer", "formulation"],
    filters: ["pesticide_category", "pesticide_subcategory", "manufacturer", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      display_name: row.trade_name || row.name,
      pesticide_subcategory: Array.isArray(row.pesticide_subcategories) ? row.pesticide_subcategories[0] || "-" : "-",
      status: "master",
    }),
    beforeCreate: (payload) => ({
      ...payload,
      type: "pesticide",
      company_id: null,
      unit: payload.default_unit || "l",
      pesticide_subcategories: payload.pesticide_subcategory ? [payload.pesticide_subcategory] : [],
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      pesticide_subcategories: payload.pesticide_subcategory ? [payload.pesticide_subcategory] : [],
    }),
  },
  fertilizers: {
    table: "products",
    select: "*",
    defaultOrder: "name",
    scopeWhere: (query) => query.is("company_id", null).eq("type", "fertilizer"),
    searchColumns: ["name", "trade_name", "active_ingredient", "manufacturer", "formulation"],
    filters: ["fertilizer_type", "manufacturer", "is_active"],
    normalizeRow: (row) => ({
      ...row,
      display_name: row.trade_name || row.name,
      pesticide_subcategory: Array.isArray(row.pesticide_subcategories) ? row.pesticide_subcategories[0] || "-" : "-",
    }),
    beforeCreate: (payload) => ({
      ...payload,
      type: "fertilizer",
      company_id: null,
      unit: payload.default_unit || "kg",
    }),
  },
  machinery: {
    table: "reference_machines",
    select:
      "id,name,full_name,brand,series,model,machine_category,machine_type,key_parameter,is_active,archived,updated_at,created_at",
    defaultOrder: "full_name",
    scopeWhere: (query) => query.is("company_id", null),
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
    scopeWhere: (query) => query.is("company_id", null),
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
    table: "reference_vehicles",
    select:
      "id,name,full_name,brand,series,model,fleet_type,capacity_kg,is_active,archived,updated_at,created_at",
    defaultOrder: "full_name",
    scopeWhere: (query) => query.is("company_id", null),
    searchColumns: ["name", "full_name", "brand", "series", "model", "fleet_type"],
    filters: ["fleet_type", "brand", "is_active"],
    beforeCreate: (payload) => ({
      ...payload,
      name: payload.name || payload.full_name,
      vehicle_type: payload.fleet_type || payload.vehicle_type || "truck",
      plate_number: payload.plate_number || `GLOBAL-${Date.now()}`,
      capacity_kg: Number(payload.capacity_kg || 0),
      status: payload.status || "free",
      company_id: null,
    }),
    beforeUpdate: (payload) => ({
      ...payload,
      name: payload.name || payload.full_name,
      vehicle_type: payload.fleet_type || payload.vehicle_type || "truck",
      capacity_kg: payload.capacity_kg == null ? undefined : Number(payload.capacity_kg),
    }),
  },
};

function parseBool(value: string | null): boolean | null {
  if (value == null || value === "" || value === "all") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
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
  if (!cropIds.length) return rows.map((row) => ({ ...row, crop_name: "-" }));

  const { data: crops, error } = await supabase
    .from("crops")
    .select("id,name,name_ru")
    .in("id", cropIds);

  if (error || !crops) {
    return rows.map((row) => ({ ...row, crop_name: "-" }));
  }

  const cropMap = new Map<string, string>();
  for (const crop of crops) {
    cropMap.set(crop.id, crop.name_ru || crop.name || "-");
  }

  return rows.map((row) => ({
    ...row,
    crop_name: cropMap.get(row.crop_id) || "-",
  }));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { entity: rawEntity } = await params;
    const entity = getEntityFromParams(rawEntity);
    const userId = String(request.nextUrl.searchParams.get("userId") || "").trim();
    if (!userId) return NextResponse.json({ error: "userId обязателен" }, { status: 400 });

    const config = ENTITY_CONFIG[entity];
    const supabase = await assertGlobalAdmin(userId);

    let query = supabase.from(config.table).select(config.select);
    query = config.scopeWhere(query);
    query = query.eq("archived", false);

    const search = String(request.nextUrl.searchParams.get("search") || "").trim();
    if (search) {
      const orParts = config.searchColumns.map((column) => `${column}.ilike.%${search}%`);
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

      query = query.eq(filterKey, value);
    }

    query = query.order(config.defaultOrder, { ascending: true, nullsFirst: false });

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rawRows = data || [];
    const hydratedRows =
      entity === "varieties"
        ? await attachCropNamesToVarieties(supabase, rawRows)
        : rawRows;

    const rows = hydratedRows.map((row: any) => (config.normalizeRow ? config.normalizeRow(row) : row));
    return NextResponse.json({ rows });
  } catch (error) {
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
    const userId = String(body?.userId || "").trim();
    if (!userId) return NextResponse.json({ error: "userId обязателен" }, { status: 400 });

    const config = ENTITY_CONFIG[entity];
    const supabase = await assertGlobalAdmin(userId);
    const payload = sanitizePayload(body?.payload || {});
    const normalized = config.beforeCreate ? config.beforeCreate(payload) : payload;
    normalized.user_id = userId;
    normalized.archived = false;
    if (normalized.is_active == null) normalized.is_active = true;

    const { data, error } = await supabase.from(config.table).insert(normalized).select(config.select).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const hydratedRows =
      entity === "varieties"
        ? await attachCropNamesToVarieties(supabase, [data])
        : [data];
    const row = hydratedRows[0];

    return NextResponse.json({ row: config.normalizeRow ? config.normalizeRow(row) : row });
  } catch (error) {
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
    const userId = String(body?.userId || "").trim();
    const id = String(body?.id || "").trim();
    if (!userId || !id) return NextResponse.json({ error: "userId и id обязательны" }, { status: 400 });

    const config = ENTITY_CONFIG[entity];
    const supabase = await assertGlobalAdmin(userId);
    const payload = sanitizePayload(body?.payload || {});
    const normalized = config.beforeUpdate ? config.beforeUpdate(payload) : payload;

    const { data, error } = await supabase
      .from(config.table)
      .update(normalized)
      .eq("id", id)
      .select(config.select)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const hydratedRows =
      entity === "varieties"
        ? await attachCropNamesToVarieties(supabase, [data])
        : [data];
    const row = hydratedRows[0];

    return NextResponse.json({ row: config.normalizeRow ? config.normalizeRow(row) : row });
  } catch (error) {
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
    const userId = String(body?.userId || "").trim();
    const id = String(body?.id || "").trim();
    if (!userId || !id) return NextResponse.json({ error: "userId и id обязательны" }, { status: 400 });

    const config = ENTITY_CONFIG[entity];
    const supabase = await assertGlobalAdmin(userId);
    const { error } = await supabase
      .from(config.table)
      .update({ archived: true, is_active: false })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}
