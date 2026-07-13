import { supabase } from "@/lib/supabase/client";
import type { Language } from "@/lib/i18n/translations";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import {
  Warehouse,
  Product,
  InventoryTransaction,
  InventoryTransactionWithDetails,
  InventoryBalance,
  WarehouseFormData,
  WarehouseDeleteCheck,
  WarehouseHistorySnapshot,
  ProductFormData,
  InventoryTransactionFormData,
  MovementType,
  TransactionDirection,
} from "@/lib/types/warehouse";

async function buildAuthHeaders(contentType: "json" | "none" = "none") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Session expired");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") headers["Content-Type"] = "application/json";
  return headers;
}

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatus(status: unknown): "draft" | "confirmed" | "cancelled" {
  if (status === "draft" || status === "cancelled") return status;
  return "confirmed";
}

function normalizeMovementType(movementType: unknown, direction: unknown): MovementType {
  if (
    movementType === "receipt" ||
    movementType === "issue" ||
    movementType === "transfer" ||
    movementType === "writeoff" ||
    movementType === "adjustment"
  ) {
    return movementType;
  }
  return direction === "in" ? "receipt" : "issue";
}

function normalizeLedgerMovementType(reasonType: unknown, direction: unknown): MovementType {
  const reason = String(reasonType || "").trim().toLowerCase();
  if (reason.includes("adjust")) return "adjustment";
  if (reason.includes("writeoff") || reason.includes("disposal") || reason.includes("waste")) return "writeoff";
  if (reason.includes("transfer")) return direction === "in" ? "receipt" : "issue";
  if (reason.includes("receipt") || reason.includes("incoming") || reason.includes("harvest")) return "receipt";
  if (reason.includes("issue") || reason.includes("outbound") || reason.includes("shipment")) return "issue";
  return direction === "in" ? "receipt" : "issue";
}

function deriveLegacyWarehouseAndDirection(data: InventoryTransactionFormData): {
  warehouseId: string;
  direction: TransactionDirection;
} {
  if (data.movement_type === "receipt") {
    return { warehouseId: String(data.destination_warehouse_id), direction: "in" };
  }
  if (data.movement_type === "issue" || data.movement_type === "writeoff") {
    return { warehouseId: String(data.source_warehouse_id), direction: "out" };
  }
  if (data.movement_type === "transfer") {
    return { warehouseId: String(data.source_warehouse_id), direction: "out" };
  }
  // adjustment
  if (data.transaction_type === "in") {
    return { warehouseId: String(data.destination_warehouse_id), direction: "in" };
  }
  return { warehouseId: String(data.source_warehouse_id), direction: "out" };
}

type BalanceMap = Map<string, number>;

function applyMovementToBalances(
  map: BalanceMap,
  movement: {
    status: string;
    movementType: MovementType;
    direction: TransactionDirection;
    sourceWarehouseId?: string | null;
    destinationWarehouseId?: string | null;
    warehouseId?: string | null;
    productId: string;
    quantity: number;
  }
) {
  const status = normalizeStatus(movement.status);
  if (status !== "confirmed") return;

  const productId = movement.productId;
  const qty = movement.quantity;
  const add = (warehouseId: string, value: number) => {
    const key = `${warehouseId}|${productId}`;
    map.set(key, (map.get(key) || 0) + value);
  };

  if (movement.movementType === "transfer") {
    if (movement.sourceWarehouseId) add(movement.sourceWarehouseId, -qty);
    if (movement.destinationWarehouseId) add(movement.destinationWarehouseId, qty);
    return;
  }

  if (movement.movementType === "receipt") {
    if (movement.destinationWarehouseId) add(movement.destinationWarehouseId, qty);
    else if (movement.warehouseId) add(movement.warehouseId, qty);
    return;
  }

  if (movement.movementType === "issue" || movement.movementType === "writeoff") {
    if (movement.sourceWarehouseId) add(movement.sourceWarehouseId, -qty);
    else if (movement.warehouseId) add(movement.warehouseId, -qty);
    return;
  }

  // adjustment and legacy fallback
  if (movement.direction === "in") {
    const warehouseId = movement.destinationWarehouseId || movement.warehouseId || movement.sourceWarehouseId;
    if (warehouseId) add(warehouseId, qty);
  } else {
    const warehouseId = movement.sourceWarehouseId || movement.warehouseId || movement.destinationWarehouseId;
    if (warehouseId) add(warehouseId, -qty);
  }
}

async function loadConfirmedBalanceMap(companyId: string): Promise<BalanceMap> {
  const { data, error } = await supabase
    .from("v_stock_balance_canonical")
    .select("warehouse_id, product_id, quantity")
    .eq("company_id", companyId);

  if (error) throw new Error(error.message);

  const map: BalanceMap = new Map();
  (data || []).forEach((row: any) => {
    const warehouseId = String(row.warehouse_id || "");
    const productId = String(row.product_id || "");
    if (!warehouseId || !productId) return;
    const key = `${warehouseId}|${productId}`;
    map.set(key, toNumber(row.quantity));
  });
  return map;
}

function getBalance(map: BalanceMap, warehouseId: string, productId: string): number {
  return map.get(`${warehouseId}|${productId}`) || 0;
}

function ensureSufficientStockForMovement(
  balanceMap: BalanceMap,
  payload: InventoryTransactionFormData
): void {
  const productId = String(payload.product_id);
  const qty = toNumber(payload.quantity);
  if (!productId || qty <= 0) return;

  const needsSourceCheck =
    payload.movement_type === "issue" ||
    payload.movement_type === "writeoff" ||
    payload.movement_type === "transfer" ||
    (payload.movement_type === "adjustment" && payload.transaction_type === "out");

  if (!needsSourceCheck) return;

  const sourceId = String(payload.source_warehouse_id || "");
  if (!sourceId) return;

  const available = getBalance(balanceMap, sourceId, productId);
  if (available < qty) {
    throw new Error(
      `Insufficient stock. Available: ${available.toFixed(2)}, requested: ${qty.toFixed(2)}`
    );
  }
}

export async function getWarehouses(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<Warehouse[]> {
  const query = new URLSearchParams();
  query.set("companyId", companyId);
  query.set("includeArchived", includeArchived ? "true" : "false");
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses?${query.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return ((payload?.warehouses || []) as Warehouse[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  })).filter((row) => !hasQaDataMarker(`${row.name} ${row.warehouse_type || ""} ${row.description || ""}`));
}

export async function createWarehouse(
  companyId: string,
  warehouseData: WarehouseFormData
): Promise<Warehouse> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/warehouses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...warehouseData,
      companyId,
    }),
  });
  const payload = await parseJsonOrThrow(response);
  return payload.warehouse as Warehouse;
}

export async function updateWarehouse(
  warehouseId: string,
  warehouseData: Partial<WarehouseFormData>,
  companyId?: string
): Promise<Warehouse> {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  const headers = await buildAuthHeaders("json");
  const response = await fetch(
    `/api/warehouses/${encodeURIComponent(warehouseId)}?${query.toString()}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(warehouseData),
    }
  );
  const payload = await parseJsonOrThrow(response);
  return payload.warehouse as Warehouse;
}

export async function archiveWarehouse(warehouseId: string, companyId?: string): Promise<Warehouse> {
  const query = new URLSearchParams();
  query.set("mode", "archive");
  if (companyId) query.set("companyId", companyId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/warehouses/${encodeURIComponent(warehouseId)}?${query.toString()}`,
    {
      method: "DELETE",
      headers,
    }
  );
  const payload = await parseJsonOrThrow(response);
  return payload.warehouse as Warehouse;
}

export async function deleteWarehouseHard(warehouseId: string, companyId?: string): Promise<void> {
  const query = new URLSearchParams();
  query.set("mode", "hard");
  if (companyId) query.set("companyId", companyId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/warehouses/${encodeURIComponent(warehouseId)}?${query.toString()}`,
    {
      method: "DELETE",
      headers,
    }
  );
  await parseJsonOrThrow(response);
}

export async function getWarehouseDeleteCheck(warehouseId: string, companyId?: string): Promise<WarehouseDeleteCheck> {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/warehouses/${encodeURIComponent(warehouseId)}?${query.toString()}`,
    {
      method: "GET",
      headers,
      cache: "no-store",
    }
  );
  const payload = await parseJsonOrThrow(response);
  return payload.delete_check as WarehouseDeleteCheck;
}

export async function getWarehouseHistory(
  warehouseId: string,
  params?: { companyId?: string; limit?: number }
): Promise<WarehouseHistorySnapshot> {
  const query = new URLSearchParams();
  if (params?.companyId) query.set("companyId", params.companyId);
  if (params?.limit != null) query.set("limit", String(params.limit));
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/warehouses/${encodeURIComponent(warehouseId)}/history?${query.toString()}`,
    {
      method: "GET",
      headers,
      cache: "no-store",
    }
  );
  const payload = await parseJsonOrThrow(response);
  return payload.history as WarehouseHistorySnapshot;
}

export async function getProducts(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<Product[]> {
  const params = new URLSearchParams();
  params.set("companyId", companyId);
  params.set("includeArchived", includeArchived ? "true" : "false");
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses/products?${params.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return ((payload?.products || []) as Product[]).map((row: any) => ({
    ...row,
    name: brandName(row) || row.name,
  })).filter((row) => !hasQaDataMarker(`${row.name} ${row.product_type || ""} ${row.type || ""} ${row.description || ""}`));
}

export async function createProduct(
  companyId: string,
  productData: ProductFormData
): Promise<Product> {
  const payload = {
    ...productData,
    crop_id: productData.crop_id || null,
    product_form: productData.product_form || null,
    accounting_mode: productData.accounting_mode || "bulk_mass",
    base_uom: productData.base_uom,
    pack_uom: productData.pack_uom || null,
    unit_weight_kg: productData.unit_weight_kg ?? null,
    units_per_pack: productData.units_per_pack ?? null,
    unit: productData.unit || productData.base_uom,
    description: productData.description || null,
    companyId,
  };
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/warehouses/products", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const result = await parseJsonOrThrow(response);
  return result.product as Product;
}

export async function updateProduct(
  productId: string,
  productData: Partial<ProductFormData>,
  companyId?: string
): Promise<Product> {
  const payload = {
    ...productData,
    crop_id:
      productData.crop_id === undefined ? undefined : productData.crop_id || null,
    product_form:
      productData.product_form === undefined ? undefined : productData.product_form || null,
    accounting_mode:
      productData.accounting_mode === undefined ? undefined : productData.accounting_mode,
    base_uom:
      productData.base_uom === undefined ? undefined : productData.base_uom,
    pack_uom:
      productData.pack_uom === undefined ? undefined : productData.pack_uom || null,
    unit_weight_kg:
      productData.unit_weight_kg === undefined ? undefined : productData.unit_weight_kg ?? null,
    units_per_pack:
      productData.units_per_pack === undefined ? undefined : productData.units_per_pack ?? null,
    description:
      productData.description === undefined ? undefined : productData.description || null,
  };
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  const headers = await buildAuthHeaders("json");
  const response = await fetch(
    `/api/warehouses/products/${encodeURIComponent(productId)}?${query.toString()}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    }
  );
  const result = await parseJsonOrThrow(response);
  return result.product as Product;
}

export async function archiveProduct(productId: string, companyId?: string): Promise<void> {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/warehouses/products/${encodeURIComponent(productId)}?${query.toString()}`,
    {
      method: "DELETE",
      headers,
    }
  );
  await parseJsonOrThrow(response);
}

export async function getInventoryTransactions(
  companyId: string,
  language: Language = "ru"
): Promise<InventoryTransactionWithDetails[]> {
  const { data, error } = await supabase
    .from("stock_ledger_entries")
    .select(
      `
      *,
      warehouses:warehouse_id (name, name_ru, name_kz, name_en),
      products:product_id (name, trade_name, normalized_name, type, product_type, unit, base_uom),
      profiles:created_by (email),
      tickets:ticket_id (ticket_no)
    `
    )
    .eq("company_id", companyId)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data || []).map((row: any) => {
    const direction = row.direction === "in" ? "in" : "out";
    const quantityDelta = Number.isFinite(Number(row.delta_qty_signed))
      ? Number(row.delta_qty_signed)
      : direction === "in"
        ? Math.abs(toNumber(row.quantity))
        : -Math.abs(toNumber(row.quantity));
    const warehouseName = localizedName(row.warehouses, language) || "N/A";
    const product = row.products || {};
    const movementType = normalizeLedgerMovementType(row.reason_type, direction);
    const dateIso = row.occurred_at || row.created_at || new Date().toISOString();

    return {
      id: String(row.id),
      warehouse_id: String(row.warehouse_id || ""),
      source_warehouse_id: direction === "out" ? String(row.warehouse_id || "") : null,
      destination_warehouse_id: direction === "in" ? String(row.warehouse_id || "") : null,
      product_id: String(row.product_id || ""),
      quantity: Math.abs(toNumber(row.quantity || quantityDelta)),
      quantity_delta: quantityDelta,
      transaction_type: direction,
      movement_type: movementType,
      status: "confirmed",
      operation_datetime: dateIso,
      date: String(dateIso).slice(0, 10),
      notes: row.notes || row.reason_type || null,
      responsible_user_id: row.created_by || null,
      confirmed_at: dateIso,
      cancelled_at: null,
      created_at: row.created_at || dateIso,
      updated_at: row.created_at || dateIso,
      user_id: row.created_by || "",
      company_id: row.company_id || companyId,
      warehouse_name: warehouseName,
      source_warehouse_name: direction === "out" ? warehouseName : "-",
      destination_warehouse_name: direction === "in" ? warehouseName : "-",
      product_name: brandName(product) || "N/A",
      product_type: product.product_type || product.type || "N/A",
      product_unit: row.uom || product.base_uom || product.unit || "kg",
      created_by_email: row.profiles?.email || "N/A",
      source_system: "stock_ledger_entries",
      source_id: row.id || null,
      ledger_entry_id: row.id || null,
      movement_source: row.reason_type || null,
      reason_type: row.reason_type || null,
      reason_ref_id: row.reason_ref_id || null,
      ticket_id: row.ticket_id || null,
      processing_id: row.processing_id || null,
      document_ref: row.tickets?.ticket_no || row.reason_ref_id || row.ticket_id || row.processing_id || null,
      is_storno: row.is_storno === true,
    };
  }) as InventoryTransactionWithDetails[]).filter(
    (row) =>
      !hasQaDataMarker(
        `${row.warehouse_name} ${row.source_warehouse_name} ${row.destination_warehouse_name} ${row.product_name} ${row.product_type} ${row.notes || ""} ${row.document_ref || ""}`
      )
  );
}

export async function createInventoryTransaction(
  companyId: string,
  transactionData: InventoryTransactionFormData,
  actorUserId?: string
): Promise<InventoryTransaction> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/warehouses/transactions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...transactionData,
      companyId,
      responsible_user_id: transactionData.responsible_user_id || actorUserId || null,
    }),
  });
  const result = await parseJsonOrThrow(response);
  return result.transaction as InventoryTransaction;
}

export async function updateInventoryTransaction(
  transactionId: string,
  companyId: string,
  transactionData: Partial<InventoryTransactionFormData>
): Promise<InventoryTransaction> {
  const headers = await buildAuthHeaders("json");
  const query = new URLSearchParams();
  query.set("companyId", companyId);
  const response = await fetch(
    `/api/warehouses/transactions/${encodeURIComponent(transactionId)}?${query.toString()}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(transactionData),
    }
  );
  const result = await parseJsonOrThrow(response);
  return result.transaction as InventoryTransaction;
}

export async function cancelInventoryTransaction(
  transactionId: string,
  companyId: string
): Promise<InventoryTransaction> {
  return updateInventoryTransaction(transactionId, companyId, {
    status: "cancelled",
  });
}

export async function deleteInventoryTransaction(transactionId: string, companyId: string): Promise<void> {
  const headers = await buildAuthHeaders("none");
  const query = new URLSearchParams();
  query.set("companyId", companyId);
  const response = await fetch(
    `/api/warehouses/transactions/${encodeURIComponent(transactionId)}?${query.toString()}`,
    {
      method: "DELETE",
      headers,
    }
  );
  await parseJsonOrThrow(response);
}

export async function getInventoryBalances(companyId: string, language: Language = "ru"): Promise<InventoryBalance[]> {
  const identityRes = await supabase
    .from("v_stock_balance_identity")
    .select(
      "warehouse_id, product_id, variety_id, reproduction_id, batch_id, batch_class, quantity, last_movement_at, uom"
    )
    .eq("company_id", companyId);
  const identityMissing =
    identityRes.error &&
    String(identityRes.error.message || "").toLowerCase().includes("v_stock_balance_identity");

  if (identityRes.error && !identityMissing) {
    throw new Error(identityRes.error.message);
  }

  if (identityMissing) {
    const canonicalRes = await supabase
      .from("v_stock_balance_canonical")
      .select("warehouse_id, product_id, quantity, last_movement_at, uom, batch_class")
      .eq("company_id", companyId);
    if (canonicalRes.error) throw new Error(canonicalRes.error.message);

    const canonicalRows = canonicalRes.data || [];
    const warehouseIds = Array.from(
      new Set(canonicalRows.map((row: any) => String(row.warehouse_id || "")).filter(Boolean))
    );
    const productIds = Array.from(
      new Set(canonicalRows.map((row: any) => String(row.product_id || "")).filter(Boolean))
    );

    const [warehousesRes, productsRes] = await Promise.all([
      warehouseIds.length
        ? supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").in("id", warehouseIds)
        : Promise.resolve({ data: [], error: null } as any),
      productIds.length
        ? supabase
            .from("products")
            .select("id,name,trade_name,normalized_name,type,product_type,unit,base_uom")
            .in("id", productIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    const warehouseById = new Map<string, any>();
    (warehousesRes.data || []).forEach((row: any) => warehouseById.set(String(row.id), row));
    const productById = new Map<string, any>();
    (productsRes.data || []).forEach((row: any) => productById.set(String(row.id), row));

    return canonicalRows
      .map((row: any) => {
        const productName = brandName(productById.get(String(row.product_id))) || "N/A";
        const classLabel =
          String(row.batch_class || "") === "seed"
            ? "Семенной фонд"
            : String(row.batch_class || "") === "material"
              ? "Материал"
            : String(row.batch_class || "") === "feed"
              ? "Кормовой"
              : String(row.batch_class || "commodity") === "waste"
                ? "Отход"
                : String(row.batch_class || "commodity") === "processing"
                  ? "Переработка"
                  : String(row.batch_class || "commodity") === "rejected"
                    ? "Брак"
                    : null;

        return {
          warehouse_id: String(row.warehouse_id),
          warehouse_name:
            localizedName(warehouseById.get(String(row.warehouse_id)), language) || "N/A",
          product_id: String(row.product_id),
          product_name: productName,
          variety_id: null,
          variety_name: "-",
          reproduction_id: null,
          reproduction_name: "-",
          batch_id: null,
          batch_class: String(row.batch_class || "legacy/unknown"),
          identity_name: classLabel
            ? `${productName} / - / - / ${classLabel}`
            : `${productName} / - / -`,
          product_type:
            productById.get(String(row.product_id))?.product_type ||
            productById.get(String(row.product_id))?.type ||
            "N/A",
          unit: String(row.uom || "legacy/unknown"),
          quantity: toNumber(row.quantity),
          last_updated: row.last_movement_at || new Date().toISOString(),
        };
      })
      .filter((row) => Math.abs(row.quantity) > 0.000001)
      .filter((row) => !hasQaDataMarker(`${row.warehouse_name} ${row.product_name} ${row.identity_name} ${row.product_type}`))
      .sort(
        (a, b) =>
          a.warehouse_name.localeCompare(b.warehouse_name) ||
          (a.identity_name || a.product_name).localeCompare(b.identity_name || b.product_name)
      );
  }

  const data = identityRes.data || [];

  const warehouseIds = Array.from(new Set((data || []).map((row: any) => String(row.warehouse_id || "")).filter(Boolean)));
  const productIds = Array.from(new Set((data || []).map((row: any) => String(row.product_id || "")).filter(Boolean)));
  const varietyIds = Array.from(new Set((data || []).map((row: any) => String(row.variety_id || "")).filter(Boolean)));
  const reproductionIds = Array.from(new Set((data || []).map((row: any) => String(row.reproduction_id || "")).filter(Boolean)));

  const [warehousesRes, productsRes, varietiesRes, reproductionsRes, lineSnapshotsRes] = await Promise.all([
    warehouseIds.length
      ? supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").in("id", warehouseIds)
      : Promise.resolve({ data: [], error: null } as any),
    productIds.length
      ? supabase.from("products").select("id,name,trade_name,normalized_name,type,product_type,unit,base_uom").in("id", productIds)
      : Promise.resolve({ data: [], error: null } as any),
    varietyIds.length
      ? supabase
          .from("varieties")
          .select("id,name,name_ru,name_kz,name_en,company_id")
          .in("id", varietyIds)
          .or(`company_id.eq.${companyId},company_id.is.null`)
      : Promise.resolve({ data: [], error: null } as any),
    reproductionIds.length
      ? supabase
          .from("seed_reproductions")
          .select("id,name,name_ru,name_kz,name_en,company_id")
          .in("id", reproductionIds)
          .or(`company_id.eq.${companyId},company_id.is.null`)
      : Promise.resolve({ data: [], error: null } as any),
    varietyIds.length || reproductionIds.length
      ? supabase
          .from("ticket_lines")
          .select("variety_id,variety_name_snapshot,reproduction_id,reproduction_name_snapshot")
          .eq("company_id", companyId)
          .not("ticket_id", "is", null)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const warehouseById = new Map<string, any>();
  (warehousesRes.data || []).forEach((row: any) => {
    warehouseById.set(String(row.id), row);
  });

  const productById = new Map<string, any>();
  (productsRes.data || []).forEach((row: any) => {
    productById.set(String(row.id), row);
  });
  const varietyById = new Map<string, any>();
  (varietiesRes.data || []).forEach((row: any) => {
    varietyById.set(String(row.id), row);
  });
  const reproductionById = new Map<string, any>();
  (reproductionsRes.data || []).forEach((row: any) => {
    reproductionById.set(String(row.id), row);
  });
  const varietySnapshotById = new Map<string, string>();
  const reproductionSnapshotById = new Map<string, string>();
  (lineSnapshotsRes.data || []).forEach((row: any) => {
    const vId = String(row.variety_id || "");
    const vName = String(row.variety_name_snapshot || "").trim();
    if (vId && vName && !varietySnapshotById.has(vId)) varietySnapshotById.set(vId, vName);
    const rId = String(row.reproduction_id || "");
    const rName = String(row.reproduction_name_snapshot || "").trim();
    if (rId && rName && !reproductionSnapshotById.has(rId)) reproductionSnapshotById.set(rId, rName);
  });

  return (data || [])
    .map((row: any) => {
      const productName = brandName(productById.get(String(row.product_id))) || "N/A";
      const varietyName = row.variety_id
        ? (brandName(varietyById.get(String(row.variety_id))) ||
          varietySnapshotById.get(String(row.variety_id)) ||
          "-")
        : "-";
      const reproductionName = row.reproduction_id
        ? (localizedName(reproductionById.get(String(row.reproduction_id)), language) ||
          reproductionSnapshotById.get(String(row.reproduction_id)) ||
          "-")
        : "-";
      const classLabel =
        String(row.batch_class || "") === "seed"
          ? "Семенной фонд"
          : String(row.batch_class || "") === "material"
            ? "Материал"
          : String(row.batch_class || "") === "feed"
            ? "Кормовой"
            : String(row.batch_class || "commodity") === "waste"
              ? "Отход"
              : String(row.batch_class || "commodity") === "processing"
                ? "Переработка"
                : String(row.batch_class || "commodity") === "rejected"
                  ? "Брак"
                  : null;
      const identityCore = `${productName} / ${varietyName} / ${reproductionName}`;

      return {
        warehouse_id: String(row.warehouse_id),
        warehouse_name: localizedName(warehouseById.get(String(row.warehouse_id)), language) || "N/A",
        product_id: String(row.product_id),
        product_name: productName,
        variety_id: row.variety_id ? String(row.variety_id) : null,
        variety_name: varietyName,
        reproduction_id: row.reproduction_id ? String(row.reproduction_id) : null,
        reproduction_name: reproductionName,
        batch_id: row.batch_id ? String(row.batch_id) : null,
        batch_class: String(row.batch_class || "legacy/unknown"),
        identity_name: classLabel ? `${identityCore} / ${classLabel}` : identityCore,
        product_type: productById.get(String(row.product_id))?.product_type || productById.get(String(row.product_id))?.type || "N/A",
        unit: String(row.uom || "legacy/unknown"),
        quantity: toNumber(row.quantity),
        last_updated: row.last_movement_at || new Date().toISOString(),
      };
    })
    .filter((row) => Math.abs(row.quantity) > 0.000001)
    .filter((row) => !hasQaDataMarker(`${row.warehouse_name} ${row.product_name} ${row.variety_name} ${row.reproduction_name} ${row.identity_name} ${row.product_type}`))
    .sort(
      (a, b) =>
        a.warehouse_name.localeCompare(b.warehouse_name) ||
        (a.identity_name || a.product_name).localeCompare(b.identity_name || b.product_name)
    );
}
