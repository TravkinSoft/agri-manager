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
  WarehouseInventoryDocument,
  WarehouseStockDetails,
  WarehouseTransferInput,
  WarehouseTransferResult,
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
  language: Language = "ru",
  scope?: "agrochemical"
): Promise<Product[]> {
  const params = new URLSearchParams();
  params.set("companyId", companyId);
  params.set("includeArchived", includeArchived ? "true" : "false");
  if (scope) params.set("scope", scope);
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

export async function getWarehouseReceipts(
  companyId: string,
  options?: { warehouseId?: string }
): Promise<import("@/lib/types/warehouse").WarehouseReceipt[]> {
  const params = new URLSearchParams({ companyId });
  if (options?.warehouseId) params.set("warehouseId", options.warehouseId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses/receipts?${params.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return Array.isArray(payload?.receipts) ? payload.receipts : [];
}

export async function createWarehouseReceipt(
  companyId: string,
  receipt: import("@/lib/types/warehouse").WarehouseReceiptInput,
  idempotencyKey = crypto.randomUUID()
): Promise<{ receipt_id: string; receipt_no: string; status: string; idempotent_replay: boolean }> {
  const headers = await buildAuthHeaders("json");
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch("/api/warehouses/receipts", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...receipt, companyId, idempotency_key: idempotencyKey }),
  });
  const payload = await parseJsonOrThrow(response);
  return payload.receipt;
}

export async function getSeedMaterialReferences(
  companyId: string
): Promise<import("@/lib/types/warehouse").SeedMaterialReferences> {
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/crop-structure/bootstrap?companyId=${encodeURIComponent(companyId)}`,
    { method: "GET", headers, cache: "no-store" }
  );
  const payload = await parseJsonOrThrow(response);
  const active = (row: any) => !row?.archived && row?.is_active !== false;
  return {
    crops: (Array.isArray(payload?.crops) ? payload.crops : []).filter(active),
    varieties: (Array.isArray(payload?.varieties) ? payload.varieties : []).filter(active),
    reproductions: (Array.isArray(payload?.reproductions) ? payload.reproductions : [])
      .filter(active)
      .sort((left: any, right: any) => Number(left.level_order || 999) - Number(right.level_order || 999)),
  };
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
  language: Language = "ru",
  options?: { warehouseId?: string; limit?: number }
): Promise<InventoryTransactionWithDetails[]> {
  const params = new URLSearchParams({ companyId, language });
  if (options?.warehouseId) params.set("warehouseId", options.warehouseId);
  if (options?.limit != null) params.set("limit", String(options.limit));
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses/transactions?${params.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return ((payload?.transactions || []) as InventoryTransactionWithDetails[]).filter(
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

export async function getInventoryBalances(
  companyId: string,
  language: Language = "ru",
  options?: { warehouseId?: string }
): Promise<InventoryBalance[]> {
  const params = new URLSearchParams({ companyId, language });
  if (options?.warehouseId) params.set("warehouseId", options.warehouseId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses/balances?${params.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return Array.isArray(payload?.balances) ? (payload.balances as InventoryBalance[]) : [];
}

export async function getWarehouseStockDetails(params: {
  companyId: string;
  warehouseId: string;
  productId: string;
  unit: string;
  excludeRequestId?: string | null;
}): Promise<WarehouseStockDetails> {
  const query = new URLSearchParams({
    companyId: params.companyId,
    productId: params.productId,
    unit: params.unit,
  });
  if (params.excludeRequestId) {
    query.set("excludeRequestId", params.excludeRequestId);
  }
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/warehouses/${encodeURIComponent(params.warehouseId)}/stock-details?${query.toString()}`,
    { method: "GET", headers, cache: "no-store" }
  );
  const payload = await parseJsonOrThrow(response);
  return payload.details as WarehouseStockDetails;
}

export async function createWarehouseTransfer(
  companyId: string,
  sourceWarehouseId: string,
  input: WarehouseTransferInput,
  idempotencyKey = crypto.randomUUID()
): Promise<WarehouseTransferResult> {
  const headers = await buildAuthHeaders("json");
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(
    `/api/warehouses/${encodeURIComponent(sourceWarehouseId)}/transfers`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, companyId, idempotency_key: idempotencyKey }),
    }
  );
  const payload = await parseJsonOrThrow(response);
  return payload.transfer as WarehouseTransferResult;
}

export async function getWarehouseInventories(
  companyId: string,
  inventoryId?: string
): Promise<WarehouseInventoryDocument[]> {
  const query = new URLSearchParams({ companyId });
  if (inventoryId) query.set("inventoryId", inventoryId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses/inventories?${query.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return Array.isArray(payload?.inventories) ? payload.inventories : [];
}

export async function getWarehouseInventoryAssignees(companyId: string): Promise<Array<{ id: string; name: string; role: string }>> {
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/warehouses/inventories/assignees?companyId=${encodeURIComponent(companyId)}`, {
    method: "GET", headers, cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return Array.isArray(payload?.assignees) ? payload.assignees : [];
}

export async function startWarehouseInventory(params: {
  companyId: string;
  warehouseId: string;
  assignedTo: string;
  notes?: string | null;
  inventoryId?: string;
}) {
  const inventoryId = params.inventoryId || crypto.randomUUID();
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/warehouses/inventories", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...params, inventoryId }),
  });
  const payload = await parseJsonOrThrow(response);
  return payload.inventory as Record<string, unknown>;
}

export async function updateWarehouseInventory(params: {
  companyId: string;
  inventoryId: string;
  action: "save" | "submit" | "approve" | "reject" | "cancel";
  items?: Array<{ item_id?: string; product_id?: string; actual_quantity: number }>;
  comment?: string;
}) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(
    `/api/warehouses/inventories/${encodeURIComponent(params.inventoryId)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        companyId: params.companyId,
        action: params.action,
        items: params.items || [],
        comment: params.comment || null,
      }),
    }
  );
  const payload = await parseJsonOrThrow(response);
  return payload.inventory as Record<string, unknown>;
}
