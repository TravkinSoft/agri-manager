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
  const params = new URLSearchParams({ companyId, language });
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses/balances?${params.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return Array.isArray(payload?.balances) ? (payload.balances as InventoryBalance[]) : [];
}
