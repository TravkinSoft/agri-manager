import type { SupabaseClient } from "@supabase/supabase-js";
import { brandName, localizedName } from "@/lib/i18n/helpers";

type ProductType = "pesticide" | "fertilizer" | "growth_regulator" | "adjuvant";

export type ProductLookupFilters = {
  companyId?: string;
  includeGlobal?: boolean;
  productType?: ProductType;
  categorySlug?: string;
  activeIngredientSlug?: string;
  manufacturer?: string;
  formulation?: string;
  modeOfActionSlug?: string;
  cropQuery?: string;
  isActive?: boolean;
  inStockOnly?: boolean;
  limit?: number;
};

export type AssistantProductRow = {
  id: string;
  company_id: string | null;
  product_type: string | null;
  type: string | null;
  trade_name: string | null;
  name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  manufacturer: string | null;
  formulation: string | null;
  mode_of_action_type: string | null;
  target_crops: string | null;
  is_active: boolean;
  stock_quantity?: number;
  stock_unit?: string;
  active_ingredients: string[];
};

export type WarehouseStockRow = {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  productType: string;
  unit: string;
  quantity: number;
};

export type FieldOperationRow = {
  operationId: string;
  date: string;
  operationType: string;
  fieldId: string;
  fieldName: string;
  notes: string | null;
};

export type ActiveTicketRow = {
  id: string;
  ticketNo: string;
  status: string;
  opType: string;
  vehicleLabel: string;
  createdAt: string;
};

export type GroundedAnswer = {
  response: string;
  source: "grounded_db";
};

function normalize(text: string): string {
  return String(text || "").toLowerCase().trim();
}

function normalizeLookup(text: string): string {
  return normalize(text).replace(/\s+/g, " ");
}

function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const value = key(row);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(row);
  }
  return out;
}

function formatModeOfAction(value: string | null): string {
  const mode = normalize(value || "");
  if (!mode) return "-";
  if (mode === "systemic") return "Системный";
  if (mode === "contact") return "Контактный";
  if (mode === "translaminar") return "Трансламинарный";
  if (mode === "systemic_local") return "Локально-системный";
  return value || "-";
}

function parseFieldIdFromText(text: string): string | null {
  const matched = text.match(/пол[ея]\s*([0-9]+)/i);
  return matched?.[1] || null;
}

function parseWarehouseNumberFromText(text: string): string | null {
  const matched = text.match(/(?:склад|хранилищ[еа])\s*№?\s*([0-9]+)/i);
  return matched?.[1] || null;
}

function parseQuotedName(text: string): string | null {
  const m = text.match(/[«"](.*?)[»"]/);
  return m?.[1]?.trim() || null;
}

async function getProductIdsWithStock(
  supabase: SupabaseClient,
  companyId: string
): Promise<Set<string>> {
  const rows = await getInventoryBalancesRaw(supabase, companyId);
  const set = new Set<string>();
  rows.forEach((row) => {
    if (row.quantity > 0.000001) set.add(row.productId);
  });
  return set;
}

async function fetchProductsBase(
  supabase: SupabaseClient,
  companyId: string | undefined,
  includeGlobal: boolean
): Promise<AssistantProductRow[]> {
  const queryBase = (q: any) =>
    q
      .select(
        "id,company_id,product_type,type,trade_name,name,category_id,manufacturer,formulation,mode_of_action_type,target_crops,is_active,archived"
      )
      .eq("archived", false);

  const settled = await Promise.allSettled([
    companyId
      ? queryBase(supabase.from("products")).eq("company_id", companyId)
      : Promise.resolve({ data: [], error: null } as any),
    includeGlobal
      ? queryBase(supabase.from("products")).is("company_id", null)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const rows: any[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    if (result.value?.error) continue;
    rows.push(...(result.value?.data || []));
  }

  return dedupeBy(
    rows.map((row) => ({
      id: String(row.id),
      company_id: row.company_id || null,
      product_type: row.product_type || null,
      type: row.type || null,
      trade_name: row.trade_name || null,
      name: row.name || null,
      category_id: row.category_id || null,
      category_name: null,
      category_slug: null,
      manufacturer: row.manufacturer || null,
      formulation: row.formulation || null,
      mode_of_action_type: row.mode_of_action_type || null,
      target_crops: row.target_crops || null,
      is_active: Boolean(row.is_active ?? true),
      active_ingredients: [],
    })),
    (row) => row.id
  );
}

async function hydrateProductsRelations(
  supabase: SupabaseClient,
  products: AssistantProductRow[]
): Promise<AssistantProductRow[]> {
  if (!products.length) return products;

  const categoryIds = Array.from(new Set(products.map((p) => p.category_id).filter(Boolean))) as string[];
  const productIds = products.map((p) => p.id);

  const [categoriesRes, linksRes] = await Promise.all([
    categoryIds.length
      ? supabase
          .from("pesticide_categories")
          .select("id,name_ru,slug")
          .in("id", categoryIds)
          .eq("archived", false)
      : Promise.resolve({ data: [], error: null } as any),
    supabase
      .from("product_active_ingredients")
      .select("product_id,active_ingredient_id,sort_order")
      .in("product_id", productIds),
  ]);

  const categoriesMap = new Map<string, { name: string; slug: string }>();
  (categoriesRes.data || []).forEach((c: any) => {
    categoriesMap.set(String(c.id), {
      name: c.name_ru || c.slug || "-",
      slug: c.slug || "",
    });
  });

  const linkRows = linksRes.data || [];
  const aiIds = Array.from(new Set(linkRows.map((l: any) => l.active_ingredient_id).filter(Boolean)));
  const ingredientsRes = aiIds.length
    ? await supabase
        .from("active_ingredients")
        .select("id,name_ru,name_en,slug")
        .in("id", aiIds)
        .eq("archived", false)
    : ({ data: [], error: null } as any);

  const aiMap = new Map<string, string>();
  (ingredientsRes.data || []).forEach((ai: any) => {
    aiMap.set(String(ai.id), ai.name_ru || ai.name_en || ai.slug || "-");
  });

  const byProduct = new Map<string, string[]>();
  linkRows
    .sort((a: any, b: any) => (a.sort_order ?? 999999) - (b.sort_order ?? 999999))
    .forEach((link: any) => {
      const pid = String(link.product_id || "");
      if (!pid) return;
      const arr = byProduct.get(pid) || [];
      const name = aiMap.get(String(link.active_ingredient_id || ""));
      if (!name) return;
      if (!arr.includes(name)) arr.push(name);
      byProduct.set(pid, arr);
    });

  return products.map((p) => {
    const category = p.category_id ? categoriesMap.get(p.category_id) : null;
    const ai = byProduct.get(p.id) || [];
    return {
      ...p,
      category_name: category?.name || p.category_name,
      category_slug: category?.slug || p.category_slug,
      active_ingredients: ai,
    };
  });
}

function rowTradeName(row: AssistantProductRow): string {
  return brandName(row);
}

export async function getProducts(
  supabase: SupabaseClient,
  filters: ProductLookupFilters
): Promise<AssistantProductRow[]> {
  const includeGlobal = filters.includeGlobal !== false;
  let rows = await fetchProductsBase(supabase, filters.companyId, includeGlobal);
  rows = await hydrateProductsRelations(supabase, rows);

  if (filters.isActive != null) {
    rows = rows.filter((row) => row.is_active === filters.isActive);
  }

  if (filters.productType) {
    rows = rows.filter((row) => normalize(String(row.product_type || row.type || "")) === filters.productType);
  }

  if (filters.categorySlug) {
    const category = normalize(filters.categorySlug);
    rows = rows.filter((row) => normalize(String(row.category_slug || "")) === category);
  }

  if (filters.activeIngredientSlug) {
    const slug = normalize(filters.activeIngredientSlug);
    rows = rows.filter((row) =>
      row.active_ingredients.some((ai) => normalize(ai).includes(slug))
    );
  }

  if (filters.manufacturer) {
    const manufacturer = normalize(filters.manufacturer);
    rows = rows.filter((row) => normalize(String(row.manufacturer || "")).includes(manufacturer));
  }

  if (filters.formulation) {
    const formulation = normalize(filters.formulation);
    rows = rows.filter((row) => normalize(String(row.formulation || "")).includes(formulation));
  }

  if (filters.modeOfActionSlug) {
    const mode = normalize(filters.modeOfActionSlug);
    rows = rows.filter((row) => normalize(String(row.mode_of_action_type || "")).includes(mode));
  }

  if (filters.cropQuery) {
    const crop = normalize(filters.cropQuery);
    rows = rows.filter((row) => normalize(String(row.target_crops || "")).includes(crop));
  }

  if (filters.inStockOnly && filters.companyId) {
    const productIds = await getProductIdsWithStock(supabase, filters.companyId);
    rows = rows.filter((row) => productIds.has(row.id));
  }

  rows = rows.sort((a, b) => rowTradeName(a).localeCompare(rowTradeName(b), "ru"));
  return rows.slice(0, filters.limit || 50);
}

export async function getProductsByActiveIngredient(
  supabase: SupabaseClient,
  activeIngredientSlug: string,
  companyId?: string
) {
  return getProducts(supabase, {
    companyId,
    includeGlobal: true,
    activeIngredientSlug,
    isActive: true,
    limit: 80,
  });
}

export async function getProductsByCrop(
  supabase: SupabaseClient,
  cropSlugOrQuery: string,
  companyId?: string
) {
  return getProducts(supabase, {
    companyId,
    includeGlobal: true,
    cropQuery: cropSlugOrQuery,
    isActive: true,
    limit: 80,
  });
}

export async function getProductsByCategory(
  supabase: SupabaseClient,
  categorySlug: string,
  companyId?: string
) {
  return getProducts(supabase, {
    companyId,
    includeGlobal: true,
    categorySlug,
    isActive: true,
    limit: 80,
  });
}

export async function getProductsByManufacturer(
  supabase: SupabaseClient,
  manufacturer: string,
  companyId?: string
) {
  return getProducts(supabase, {
    companyId,
    includeGlobal: true,
    manufacturer,
    isActive: true,
    limit: 80,
  });
}

function movementTypeOf(row: any): string {
  if (row.movement_type) return String(row.movement_type);
  return row.transaction_type === "in" ? "receipt" : "issue";
}

function statusOf(row: any): string {
  if (row.status === "cancelled" || row.status === "draft") return String(row.status);
  return "confirmed";
}

async function getInventoryBalancesRaw(
  supabase: SupabaseClient,
  companyId: string
): Promise<WarehouseStockRow[]> {
  const { data, error } = await supabase
    .from("v_stock_balance_canonical")
    .select("company_id, warehouse_id, product_id, quantity, uom")
    .eq("company_id", companyId);

  if (error) return [];

  const warehouseIds = Array.from(new Set((data || []).map((row: any) => String(row.warehouse_id || "")).filter(Boolean)));
  const productIds = Array.from(new Set((data || []).map((row: any) => String(row.product_id || "")).filter(Boolean)));

  const [warehousesRes, productsRes] = await Promise.all([
    warehouseIds.length
      ? supabase.from("warehouses").select("id,name").in("id", warehouseIds)
      : Promise.resolve({ data: [], error: null } as any),
    productIds.length
      ? supabase.from("products").select("id,name,trade_name,type,product_type,unit,base_uom").in("id", productIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const warehouseNameById = new Map<string, string>();
  (warehousesRes.data || []).forEach((row: any) => {
    warehouseNameById.set(String(row.id), String(row.name || "РЎРєР»Р°Рґ"));
  });

  const productById = new Map<string, any>();
  (productsRes.data || []).forEach((row: any) => {
    productById.set(String(row.id), row);
  });

  return (data || [])
    .map((row: any) => {
      const product = productById.get(String(row.product_id));
      const qty = Number(row.quantity || 0);
      return {
        warehouseId: String(row.warehouse_id),
        warehouseName: warehouseNameById.get(String(row.warehouse_id)) || "РЎРєР»Р°Рґ",
        productId: String(row.product_id),
        productName: brandName(product) || "-",
        productType: String(product?.product_type || product?.type || "-"),
        unit: String(row.uom || product?.base_uom || product?.unit || "kg"),
        quantity: qty,
      } as WarehouseStockRow;
    })
    .filter((row) => Number.isFinite(row.quantity) && row.quantity > 0.000001);

  const map = new Map<string, WarehouseStockRow>();
  const add = (
    warehouseId: string,
    warehouseName: string,
    productId: string,
    productName: string,
    productType: string,
    unit: string,
    delta: number
  ) => {
    const key = `${warehouseId}|${productId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        warehouseId,
        warehouseName: warehouseName || "Склад",
        productId,
        productName: productName || "-",
        productType: productType || "-",
        unit: unit || "kg",
        quantity: delta,
      });
      return;
    }
    existing.quantity += delta;
  };

  (data || []).forEach((row: any) => {
    if (statusOf(row) !== "confirmed") return;

    const qty = Number(row.quantity || 0);
    if (!Number.isFinite(qty) || qty === 0) return;
    const productId = String(row.product_id || "");
    if (!productId) return;
    const productName = brandName(row.products) || "-";
    const productType = row.products?.product_type || row.products?.type || "-";
    const unit = row.products?.unit || "kg";
    const movementType = movementTypeOf(row);

    if (movementType === "transfer") {
      if (row.source_warehouse_id) {
        add(
          String(row.source_warehouse_id),
          row.source_warehouse?.name || row.warehouses?.name || "Склад",
          productId,
          productName,
          productType,
          unit,
          -qty
        );
      }
      if (row.destination_warehouse_id) {
        add(
          String(row.destination_warehouse_id),
          row.destination_warehouse?.name || row.warehouses?.name || "Склад",
          productId,
          productName,
          productType,
          unit,
          qty
        );
      }
      return;
    }

    if (movementType === "receipt") {
      const wid = row.destination_warehouse_id || row.warehouse_id;
      if (wid) {
        add(
          String(wid),
          row.destination_warehouse?.name || row.warehouses?.name || "Склад",
          productId,
          productName,
          productType,
          unit,
          qty
        );
      }
      return;
    }

    if (movementType === "issue" || movementType === "writeoff") {
      const wid = row.source_warehouse_id || row.warehouse_id;
      if (wid) {
        add(
          String(wid),
          row.source_warehouse?.name || row.warehouses?.name || "Склад",
          productId,
          productName,
          productType,
          unit,
          -qty
        );
      }
      return;
    }

    const wid = row.transaction_type === "in"
      ? row.destination_warehouse_id || row.warehouse_id
      : row.source_warehouse_id || row.warehouse_id;
    if (wid) {
      add(
        String(wid),
        row.warehouses?.name || "Склад",
        productId,
        productName,
        productType,
        unit,
        row.transaction_type === "in" ? qty : -qty
      );
    }
  });

  return Array.from(map.values()).filter((row) => row.quantity > 0.000001);
}

export async function getWarehouseStock(
  supabase: SupabaseClient,
  companyId: string,
  warehouseIdOrName?: string,
  productQuery?: string
): Promise<WarehouseStockRow[]> {
  const rows = await getInventoryBalancesRaw(supabase, companyId);
  const warehouseFilter = normalizeLookup(warehouseIdOrName || "");
  const productFilter = normalizeLookup(productQuery || "");

  return rows.filter((row) => {
    const wMatch = !warehouseFilter
      ? true
      : normalizeLookup(row.warehouseId) === warehouseFilter ||
        normalizeLookup(row.warehouseName).includes(warehouseFilter);
    const pMatch = !productFilter
      ? true
      : normalizeLookup(row.productName).includes(productFilter);
    return wMatch && pMatch;
  });
}

export async function searchInventory(
  supabase: SupabaseClient,
  companyId: string,
  query: string
): Promise<WarehouseStockRow[]> {
  return getWarehouseStock(supabase, companyId, undefined, query);
}

export async function getFieldOperations(
  supabase: SupabaseClient,
  companyId: string,
  fieldIdOrName: string
): Promise<FieldOperationRow[]> {
  const search = normalizeLookup(fieldIdOrName);
  if (!search) return [];

  const { data: operations, error } = await supabase
    .from("operations")
    .select("id,date,operation_type,field_id,notes,archived,fields:field_id(name)")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("date", { ascending: false })
    .limit(80);

  if (error) return [];

  return (operations || [])
    .map((row: any) => ({
      operationId: String(row.id),
      date: String(row.date || ""),
      operationType: String(row.operation_type || "-"),
      fieldId: String(row.field_id || ""),
      fieldName: String(row.fields?.name || "-"),
      notes: row.notes || null,
    }))
    .filter((row) => {
      return (
        normalizeLookup(row.fieldId) === search ||
        normalizeLookup(row.fieldName).includes(search)
      );
    });
}

export async function getActiveTickets(
  supabase: SupabaseClient,
  companyId: string
): Promise<ActiveTicketRow[]> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id,ticket_no,status,op_type,created_at,vehicle_id,reference_vehicles:vehicle_id(full_name,name)")
    .eq("company_id", companyId)
    .in("status", ["draft", "active", "ready_to_close"])
    .eq("is_voided", false)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return [];

  return (data || []).map((row: any) => ({
    id: String(row.id),
    ticketNo: String(row.ticket_no || row.id),
    status: String(row.status || "-"),
    opType: String(row.op_type || "-"),
    vehicleLabel: String(row.reference_vehicles?.full_name || row.reference_vehicles?.name || row.vehicle_id || "-"),
    createdAt: String(row.created_at || ""),
  }));
}

export async function getCompanyCatalog(
  supabase: SupabaseClient,
  companyId: string,
  filters: ProductLookupFilters = {}
) {
  return getProducts(supabase, {
    ...filters,
    companyId,
    includeGlobal: false,
  });
}

export async function getCompanyCrops(
  supabase: SupabaseClient,
  companyId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase
    .from("crop_structure")
    .select("crop_id,crops:crop_id(id,name,name_ru,name_kz,name_en,slug)")
    .eq("company_id", companyId)
    .eq("archived", false);

  if (error) return [];

  const map = new Map<string, string>();
  (data || []).forEach((row: any) => {
    const cropId = String(row.crop_id || row.crops?.id || "");
    if (!cropId) return;
    const cropName = localizedName(row.crops, "ru") || "-";
    if (!map.has(cropId)) map.set(cropId, cropName);
  });

  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function getCompanyVarieties(
  supabase: SupabaseClient,
  companyId: string,
  cropId?: string
): Promise<Array<{ id: string; name: string; cropId: string }>> {
  const { data: usedVarieties, error: usedVarietiesError } = await supabase
    .from("crop_structure")
    .select("variety_id,crop_id,varieties:variety_id(id,name,crop_id)")
    .eq("company_id", companyId)
    .eq("archived", false)
    .not("variety_id", "is", null);

  if (!usedVarietiesError && (usedVarieties || []).length > 0) {
    const map = new Map<string, { id: string; name: string; cropId: string }>();
    (usedVarieties || []).forEach((row: any) => {
      const varId = String(row.variety_id || row.varieties?.id || "");
      const varName = String(row.varieties?.name || "");
      const varCropId = String(row.varieties?.crop_id || row.crop_id || "");
      if (!varId || !varName || !varCropId) return;
      if (cropId && varCropId !== cropId) return;
      const key = `${varCropId}|${normalizeLookup(varName)}`;
      if (!map.has(key)) {
        map.set(key, { id: varId, name: varName, cropId: varCropId });
      }
    });
    if (map.size > 0) {
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }
  }

  const { data: used, error: usedError } = await supabase
    .from("crop_structure")
    .select("crop_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  if (usedError) return [];

  const cropIds = Array.from(new Set((used || []).map((row: any) => String(row.crop_id || "")).filter(Boolean)));
  if (!cropIds.length) return [];

  let query = supabase
    .from("varieties")
    .select("id,name,crop_id,company_id")
    .in("crop_id", cropIds)
    .eq("archived", false)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("name");

  if (cropId) query = query.eq("crop_id", cropId);
  const { data, error } = await query;
  if (error) return [];

  const map = new Map<string, { id: string; name: string; cropId: string; companyId: string | null }>();
  (data || []).forEach((row: any) => {
    const name = String(row.name || "-");
    const cropRef = String(row.crop_id || "");
    const key = `${cropRef}|${normalizeLookup(name)}`;
    const item = { id: String(row.id), name, cropId: cropRef, companyId: row.company_id ? String(row.company_id) : null };
    const existing = map.get(key);
    if (!existing || (existing.companyId == null && item.companyId != null)) {
      map.set(key, item);
    }
  });

  return Array.from(map.values())
    .map((row) => ({ id: row.id, name: row.name, cropId: row.cropId }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function getCompanySeedReproductions(
  supabase: SupabaseClient,
  companyId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data: usedRows, error: usedRowsError } = await supabase
    .from("crop_structure")
    .select("reproduction_id,seed_reproductions:reproduction_id(id,name,name_ru,name_kz,name_en,code)")
    .eq("company_id", companyId)
    .eq("archived", false)
    .not("reproduction_id", "is", null);

  if (!usedRowsError && (usedRows || []).length > 0) {
    const usedMap = new Map<string, string>();
    (usedRows || []).forEach((row: any) => {
      const id = String(row.reproduction_id || row.seed_reproductions?.id || "");
      const name = localizedName(row.seed_reproductions, "ru", ["name", "code"]);
      if (!id || !name) return;
      if (!usedMap.has(id)) usedMap.set(id, name);
    });
    if (usedMap.size > 0) {
      return Array.from(usedMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }
  }

  const { data, error } = await supabase
    .from("seed_reproductions")
    .select("id,name,name_ru,name_kz,name_en,code,company_id")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .eq("archived", false)
    .order("level_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return [];

  const map = new Map<string, { id: string; name: string; companyId: string | null }>();
  (data || []).forEach((row: any) => {
    const name = localizedName(row, "ru", ["name", "code"]) || "-";
    const key = normalizeLookup(name);
    const item = { id: String(row.id), name, companyId: row.company_id ? String(row.company_id) : null };
    const existing = map.get(key);
    if (!existing || (existing.companyId == null && item.companyId != null)) {
      map.set(key, item);
    }
  });

  return Array.from(map.values())
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function getProductCandidatesByDiseaseOrGoal(
  supabase: SupabaseClient,
  query: string,
  companyId: string,
  cropContext?: string
): Promise<AssistantProductRow[]> {
  const normalized = normalizeLookup(query);
  const cropFilter = normalizeLookup(cropContext || "");

  const companyRows = await getProducts(supabase, {
    companyId,
    includeGlobal: false,
    isActive: true,
    limit: 200,
  });

  const globalRows = await getProducts(supabase, {
    companyId,
    includeGlobal: true,
    isActive: true,
    limit: 300,
  });

  const matchRows = (rows: AssistantProductRow[]) =>
    rows.filter((row) => {
      const hay = normalizeLookup(
        [
          brandName(row),
          row.category_name || "",
          row.target_crops || "",
          row.active_ingredients.join(" "),
        ].join(" ")
      );
      const cropMatch = !cropFilter || normalizeLookup(row.target_crops || "").includes(cropFilter);
      return cropMatch && hay.includes(normalized);
    });

  const companyMatched = matchRows(companyRows);
  if (companyMatched.length) return companyMatched;
  return dedupeBy(matchRows(globalRows), (row) => row.id);
}

function formatProductLine(product: AssistantProductRow): string {
  const tradeName = brandName(product) || "-";
  const ai = product.active_ingredients.length ? product.active_ingredients.join(", ") : "-";
  const category = product.category_name || "-";
  const manufacturer = product.manufacturer || "-";
  const formulation = product.formulation || "-";
  const moa = formatModeOfAction(product.mode_of_action_type);
  return `- ${tradeName} | Категория: ${category} | ДВ: ${ai} | Производитель: ${manufacturer} | Формуляция: ${formulation} | Тип действия: ${moa}`;
}

function buildProductsResponse(title: string, rows: AssistantProductRow[]): string {
  if (!rows.length) return `${title}\n\nПо базе ничего не найдено.`;
  const lines = rows.slice(0, 15).map(formatProductLine);
  const suffix = rows.length > 15 ? `\n\nПоказано 15 из ${rows.length}.` : "";
  return `${title}\n\n${lines.join("\n")}${suffix}\n\nПроверьте финальную схему применения с агрономом перед использованием.`;
}

function formatStockAmount(quantity: number, unitRaw: string | undefined): string {
  const unit = String(unitRaw || "kg").toLowerCase();
  const q = Number(quantity || 0);
  if (!Number.isFinite(q)) return `0 ${unit || "kg"}`;
  if (unit === "kg" && Math.abs(q) >= 1000) {
    const t = q / 1000;
    return `${t.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} т`;
  }
  return `${q.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${unit}`;
}

function buildStockResponse(title: string, rows: WarehouseStockRow[]): string {
  if (!rows.length) return `${title}\n\nПо складам ничего не найдено.`;
  const lines = rows
    .slice(0, 20)
    .map((row) => `- ${row.warehouseName}: ${row.productName} — ${formatStockAmount(row.quantity, row.unit)}`);
  const suffix = rows.length > 20 ? `\n\nПоказано 20 из ${rows.length}.` : "";
  return `${title}\n\n${lines.join("\n")}${suffix}`;
}

function buildFieldOpsResponse(fieldLabel: string, rows: FieldOperationRow[]): string {
  if (!rows.length) return `По полю ${fieldLabel} операции не найдены.`;
  const lines = rows
    .slice(0, 12)
    .map((row) => `- ${row.date}: ${row.operationType}${row.notes ? ` (${row.notes.slice(0, 90)})` : ""}`);
  return `Что применяли на поле ${fieldLabel}:\n\n${lines.join("\n")}`;
}

function buildTicketsResponse(rows: ActiveTicketRow[]): string {
  if (!rows.length) return "Сейчас нет активных талонов.";
  return `Активные талоны:\n\n${rows
    .slice(0, 12)
    .map((row) => `- ${row.ticketNo} | ${row.opType} | ${row.status} | Машина: ${row.vehicleLabel}`)
    .join("\n")}`;
}

export async function answerGroundedAssistantQuery(params: {
  supabase: SupabaseClient;
  companyId: string;
  message: string;
}): Promise<GroundedAnswer | null> {
  const { supabase, companyId } = params;
  const message = normalizeLookup(params.message);
  if (!message) return null;

  if (/действующ.*glyphosate|glyphosate|глифосат/.test(message)) {
    const rows = await getProductsByActiveIngredient(supabase, "glyphosate", companyId);
    return { source: "grounded_db", response: buildProductsResponse("Препараты с ДВ glyphosate:", rows) };
  }

  if (/фитофтор|phytophthora/.test(message)) {
    const inStockRows = await getProducts(supabase, {
      companyId,
      includeGlobal: false,
      productType: "pesticide",
      categorySlug: "fungicide",
      cropQuery: "potato",
      isActive: true,
      inStockOnly: true,
      limit: 80,
    });

    if (inStockRows.length > 0) {
      return {
        source: "grounded_db",
        response: buildProductsResponse("По складам компании найдены фунгициды против фитофторы:", inStockRows),
      };
    }

    const fallbackRows = await getProductCandidatesByDiseaseOrGoal(supabase, "фитофтора", companyId, "potato");
    return {
      source: "grounded_db",
      response: buildProductsResponse("В глобальном каталоге найдены варианты против фитофторы:", fallbackRows),
    };
  }

  if (/системн.*фунгицид.*картоф|fungicid.*potato/.test(message)) {
    const rows = await getProducts(supabase, {
      companyId,
      includeGlobal: true,
      productType: "pesticide",
      categorySlug: "fungicide",
      cropQuery: "potato",
      modeOfActionSlug: "systemic",
      isActive: true,
      inStockOnly: false,
      limit: 80,
    });
    return { source: "grounded_db", response: buildProductsResponse("Системные фунгициды для картофеля:", rows) };
  }

  if (/какие.*удобрени.*морков|fertilizer.*carrot/.test(message)) {
    const rows = await getProducts(supabase, {
      companyId,
      includeGlobal: true,
      productType: "fertilizer",
      cropQuery: "carrot",
      isActive: true,
      limit: 80,
    });
    return { source: "grounded_db", response: buildProductsResponse("Удобрения для моркови из базы:", rows) };
  }

  if (/какие.*системн.*(препарат|позиц|есть)/.test(message)) {
    const rows = await getProducts(supabase, {
      companyId,
      includeGlobal: true,
      modeOfActionSlug: "systemic",
      isActive: true,
      limit: 80,
    });
    return { source: "grounded_db", response: buildProductsResponse("Препараты системного действия:", rows) };
  }

  if (/syngenta|сингента/.test(message) && /какие|покажи|есть/.test(message)) {
    const rows = await getProductsByManufacturer(supabase, "syngenta", companyId);
    return { source: "grounded_db", response: buildProductsResponse("Позиции производителя Syngenta:", rows) };
  }

  if (/сколько.*картоф.*(хранилищ|склад)|картоф.*в\s*[0-9]+\s*хранилищ/.test(message)) {
    const warehouseNum = parseWarehouseNumberFromText(message);
    const rows = await getWarehouseStock(supabase, companyId, warehouseNum || undefined, "картофель");
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    const detail = buildStockResponse("Остатки картофеля:", rows);
    return {
      source: "grounded_db",
      response: `${detail}\n\nИтого: ${formatStockAmount(total, rows[0]?.unit || "kg")}.`,
    };
  }

  if (/какие.*препарат.*на склад|что есть на склад.*препарат/.test(message)) {
    const rows = await searchInventory(supabase, companyId, "");
    const onlyAgro = rows.filter((row) =>
      ["pesticide", "fertilizer", "growth_regulator", "adjuvant"].includes(normalize(row.productType))
    );
    return { source: "grounded_db", response: buildStockResponse("Препараты на складе:", onlyAgro) };
  }

  if (/есть ли.*кальциев.*селитр|calcium nitrate/.test(message)) {
    const rows = await searchInventory(supabase, companyId, "calcium nitrate");
    const ruRows = await searchInventory(supabase, companyId, "кальциевая селитра");
    const merged = dedupeBy([...rows, ...ruRows], (row) => `${row.warehouseId}|${row.productId}`);
    if (!merged.length) {
      return {
        source: "grounded_db",
        response: "По текущим остаткам кальциевая селитра не найдена.",
      };
    }
    return {
      source: "grounded_db",
      response: buildStockResponse("Кальциевая селитра есть на остатке:", merged),
    };
  }

  if (/что применял|что применяли|операц.*пол[ея]/.test(message)) {
    const fieldNo = parseFieldIdFromText(message);
    const fieldLabel = fieldNo || parseQuotedName(message) || "запрошенному полю";
    const rows = await getFieldOperations(supabase, companyId, fieldLabel);
    return {
      source: "grounded_db",
      response: buildFieldOpsResponse(fieldLabel, rows),
    };
  }

  if (/активн.*талон|открыт.*талон/.test(message)) {
    const rows = await getActiveTickets(supabase, companyId);
    return {
      source: "grounded_db",
      response: buildTicketsResponse(rows),
    };
  }

  if (/какие культуры.*компан|культуры сейчас/.test(message)) {
    const rows = await getCompanyCrops(supabase, companyId);
    if (!rows.length) {
      return {
        source: "grounded_db",
        response: "По структуре посевов компании культуры пока не найдены.",
      };
    }
    return {
      source: "grounded_db",
      response: `Культуры компании:\n\n${rows.slice(0, 30).map((row) => `- ${row.name}`).join("\n")}`,
    };
  }

  if (/какие сорта.*картоф|сорта картофел/.test(message)) {
    const crops = await getCompanyCrops(supabase, companyId);
    const potato = crops.find((row) => /картоф|potato/i.test(row.name));
    if (!potato) {
      return {
        source: "grounded_db",
        response: "Культура «картофель» в текущем контексте компании не найдена.",
      };
    }
    const rows = await getCompanyVarieties(supabase, companyId, potato.id);
    if (!rows.length) {
      return {
        source: "grounded_db",
        response: "Доступные сорта картофеля для компании не найдены.",
      };
    }
    return {
      source: "grounded_db",
      response: `Сорта картофеля:\n\n${rows.slice(0, 40).map((row) => `- ${row.name}`).join("\n")}`,
    };
  }

  if (/репродукц|seed reproduction/.test(message)) {
    const rows = await getCompanySeedReproductions(supabase, companyId);
    if (!rows.length) {
      return {
        source: "grounded_db",
        response: "Репродукции семян в текущем контексте компании не найдены.",
      };
    }
    return {
      source: "grounded_db",
      response: `Репродукции семян:\n\n${rows.slice(0, 30).map((row) => `- ${row.name}`).join("\n")}`,
    };
  }

  return null;
}
