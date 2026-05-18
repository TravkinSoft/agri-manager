import { supabase } from "@/lib/supabase/client";
import type { Language } from "@/lib/i18n/translations";
import { localizedName } from "@/lib/i18n/helpers";
import {
  Warehouse,
  Product,
  InventoryTransaction,
  InventoryTransactionWithDetails,
  InventoryBalance,
  WarehouseFormData,
  ProductFormData,
  InventoryTransactionFormData,
  MovementType,
  TransactionDirection,
} from "@/lib/types/warehouse";

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
  let query = supabase
    .from("warehouses")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as Warehouse[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));
}

export async function createWarehouse(
  companyId: string,
  warehouseData: WarehouseFormData
): Promise<Warehouse> {
  const { data, error } = await supabase
    .from("warehouses")
    .insert([{ ...warehouseData, company_id: companyId }])
    .select()
    .single();
  if (error) throw new Error(`Failed to create warehouse: ${error.message}`);
  return data as Warehouse;
}

export async function updateWarehouse(
  warehouseId: string,
  warehouseData: Partial<WarehouseFormData>
): Promise<Warehouse> {
  const { data, error } = await supabase
    .from("warehouses")
    .update(warehouseData)
    .eq("id", warehouseId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Warehouse;
}

export async function archiveWarehouse(warehouseId: string): Promise<void> {
  const { error } = await supabase
    .from("warehouses")
    .update({ archived: true })
    .eq("id", warehouseId);
  if (error) throw new Error(error.message);
}

export async function getProducts(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<Product[]> {
  let query = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (!includeArchived) {
    query = query.eq("archived", false);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as Product[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));
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
    base_uom: productData.base_uom || "kg",
    pack_uom: productData.pack_uom || null,
    unit_weight_kg: productData.unit_weight_kg ?? null,
    units_per_pack: productData.units_per_pack ?? null,
    unit: productData.unit || "kg",
    description: productData.description || null,
    company_id: companyId,
  };
  const { data, error } = await supabase.from("products").insert([payload]).select().single();
  if (error) throw new Error(`Failed to create item: ${error.message}`);
  return data as Product;
}

export async function updateProduct(
  productId: string,
  productData: Partial<ProductFormData>
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
      productData.base_uom === undefined ? undefined : productData.base_uom || "kg",
    pack_uom:
      productData.pack_uom === undefined ? undefined : productData.pack_uom || null,
    unit_weight_kg:
      productData.unit_weight_kg === undefined ? undefined : productData.unit_weight_kg ?? null,
    units_per_pack:
      productData.units_per_pack === undefined ? undefined : productData.units_per_pack ?? null,
    description:
      productData.description === undefined ? undefined : productData.description || null,
  };
  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", productId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Product;
}

export async function archiveProduct(productId: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ archived: true })
    .eq("id", productId);
  if (error) throw new Error(error.message);
}

export async function getInventoryTransactions(
  companyId: string,
  language: Language = "ru"
): Promise<InventoryTransactionWithDetails[]> {
  const { data, error } = await supabase
    .from("inventory_transactions")
    .select(
      `
      *,
      warehouses:warehouse_id (name, name_ru, name_kz, name_en),
      source_warehouse:source_warehouse_id (name, name_ru, name_kz, name_en),
      destination_warehouse:destination_warehouse_id (name, name_ru, name_kz, name_en),
      products:product_id (name, name_ru, name_kz, name_en, type, unit),
      profiles:responsible_user_id (email)
    `
    )
    .eq("company_id", companyId)
    .order("operation_datetime", { ascending: false, nullsFirst: false })
    .order("date", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((tx: any) => ({
    ...tx,
    source_warehouse_name: localizedName(tx.source_warehouse, language) || localizedName(tx.warehouses, language) || "N/A",
    destination_warehouse_name: localizedName(tx.destination_warehouse, language) || localizedName(tx.warehouses, language) || "N/A",
    warehouse_name: localizedName(tx.warehouses, language) || "N/A",
    product_name: localizedName(tx.products, language) || "N/A",
    product_type: tx.products?.type || "N/A",
    product_unit: tx.products?.unit || "kg",
    created_by_email: tx.profiles?.email || "N/A",
    movement_type: normalizeMovementType(tx.movement_type, tx.transaction_type),
    status: normalizeStatus(tx.status),
  })) as InventoryTransactionWithDetails[];
}

export async function createInventoryTransaction(
  companyId: string,
  transactionData: InventoryTransactionFormData,
  actorUserId?: string
): Promise<InventoryTransaction> {
  const status = normalizeStatus(transactionData.status);
  const { warehouseId, direction } = deriveLegacyWarehouseAndDirection(transactionData);

  if (!warehouseId) {
    throw new Error("Warehouse is required for this operation");
  }

  if (status === "confirmed") {
    const balances = await loadConfirmedBalanceMap(companyId);
    ensureSufficientStockForMovement(balances, transactionData);
  }

  const operationDate = String(transactionData.operation_datetime).slice(0, 10);
  const nowIso = new Date().toISOString();
  const payload = {
    warehouse_id: warehouseId,
    source_warehouse_id: transactionData.source_warehouse_id || null,
    destination_warehouse_id: transactionData.destination_warehouse_id || null,
    product_id: transactionData.product_id,
    quantity: transactionData.quantity,
    transaction_type: direction,
    movement_type: transactionData.movement_type,
    status,
    operation_datetime: transactionData.operation_datetime,
    date: operationDate,
    notes: transactionData.notes || null,
    responsible_user_id: transactionData.responsible_user_id || actorUserId || null,
    confirmed_at: status === "confirmed" ? nowIso : null,
    cancelled_at: status === "cancelled" ? nowIso : null,
    company_id: companyId,
  };

  const { data, error } = await supabase
    .from("inventory_transactions")
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error(`Failed to create movement: ${error.message}`);
  return data as InventoryTransaction;
}

export async function updateInventoryTransaction(
  transactionId: string,
  companyId: string,
  transactionData: Partial<InventoryTransactionFormData>
): Promise<InventoryTransaction> {
  const { data: existing, error: existingError } = await supabase
    .from("inventory_transactions")
    .select("*")
    .eq("id", transactionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Movement not found");

  const existingStatus = normalizeStatus(existing.status);
  if (existingStatus === "confirmed" || existingStatus === "cancelled") {
    throw new Error("Confirmed/cancelled movements are read-only. Create a correction movement.");
  }

  const nextStatus = transactionData.status ? normalizeStatus(transactionData.status) : existingStatus;
  const merged = {
    product_id: transactionData.product_id ?? existing.product_id,
    movement_type:
      (transactionData.movement_type as MovementType | undefined) ??
      normalizeMovementType(existing.movement_type, existing.transaction_type),
    status: nextStatus,
    source_warehouse_id: transactionData.source_warehouse_id ?? existing.source_warehouse_id,
    destination_warehouse_id:
      transactionData.destination_warehouse_id ?? existing.destination_warehouse_id,
    operation_datetime: transactionData.operation_datetime ?? existing.operation_datetime ?? existing.date,
    quantity: toNumber(transactionData.quantity ?? existing.quantity),
    transaction_type:
      (transactionData.transaction_type as TransactionDirection | undefined) ??
      (existing.transaction_type === "in" ? "in" : "out"),
    notes: transactionData.notes ?? existing.notes ?? "",
    responsible_user_id: transactionData.responsible_user_id ?? existing.responsible_user_id,
  } as InventoryTransactionFormData;

  if (nextStatus === "confirmed") {
    const balances = await loadConfirmedBalanceMap(companyId);
    ensureSufficientStockForMovement(balances, merged);
  }

  const { warehouseId, direction } = deriveLegacyWarehouseAndDirection(merged);
  const operationDate = String(merged.operation_datetime).slice(0, 10);
  const nowIso = new Date().toISOString();

  const updatePayload = {
    warehouse_id: warehouseId,
    source_warehouse_id: merged.source_warehouse_id || null,
    destination_warehouse_id: merged.destination_warehouse_id || null,
    product_id: merged.product_id,
    movement_type: merged.movement_type,
    status: nextStatus,
    operation_datetime: merged.operation_datetime,
    quantity: merged.quantity,
    transaction_type: direction,
    date: operationDate,
    notes: merged.notes || null,
    responsible_user_id: merged.responsible_user_id || null,
    confirmed_at: nextStatus === "confirmed" ? nowIso : null,
    cancelled_at: nextStatus === "cancelled" ? nowIso : null,
  };

  const { data, error } = await supabase
    .from("inventory_transactions")
    .update(updatePayload)
    .eq("id", transactionId)
    .eq("company_id", companyId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as InventoryTransaction;
}

export async function cancelInventoryTransaction(
  transactionId: string,
  companyId: string
): Promise<InventoryTransaction> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("inventory_transactions")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
    })
    .eq("id", transactionId)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as InventoryTransaction;
}

export async function deleteInventoryTransaction(transactionId: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_transactions")
    .delete()
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
}

export async function getInventoryBalances(companyId: string, language: Language = "ru"): Promise<InventoryBalance[]> {
  const identityRes = await supabase
    .from("v_stock_balance_identity")
    .select(
      "warehouse_id, product_id, variety_id, reproduction_id, batch_id, batch_class, quantity, last_movement_at"
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
      .select("warehouse_id, product_id, quantity, last_movement_at")
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
            .select("id,name,name_ru,name_kz,name_en,type,product_type,unit,base_uom")
            .in("id", productIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    const warehouseById = new Map<string, any>();
    (warehousesRes.data || []).forEach((row: any) => warehouseById.set(String(row.id), row));
    const productById = new Map<string, any>();
    (productsRes.data || []).forEach((row: any) => productById.set(String(row.id), row));

    return canonicalRows
      .map((row: any) => {
        const productName = localizedName(productById.get(String(row.product_id)), language) || "N/A";
        const classLabel =
          String(row.batch_class || "commodity") === "seed"
            ? "Семенной фонд"
            : String(row.batch_class || "commodity") === "feed"
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
          batch_class: String(row.batch_class || "commodity"),
          identity_name: classLabel
            ? `${productName} / - / - / ${classLabel}`
            : `${productName} / - / -`,
          product_type:
            productById.get(String(row.product_id))?.product_type ||
            productById.get(String(row.product_id))?.type ||
            "N/A",
          unit:
            productById.get(String(row.product_id))?.base_uom ||
            productById.get(String(row.product_id))?.unit ||
            "kg",
          quantity: toNumber(row.quantity),
          last_updated: row.last_movement_at || new Date().toISOString(),
        };
      })
      .filter((row) => Math.abs(row.quantity) > 0.000001)
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
      ? supabase.from("products").select("id,name,name_ru,name_kz,name_en,type,product_type,unit,base_uom").in("id", productIds)
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
      const productName = localizedName(productById.get(String(row.product_id)), language) || "N/A";
      const varietyName = row.variety_id
        ? (localizedName(varietyById.get(String(row.variety_id)), language) ||
          varietySnapshotById.get(String(row.variety_id)) ||
          "-")
        : "-";
      const reproductionName = row.reproduction_id
        ? (localizedName(reproductionById.get(String(row.reproduction_id)), language) ||
          reproductionSnapshotById.get(String(row.reproduction_id)) ||
          "-")
        : "-";
      const classLabel =
        String(row.batch_class || "commodity") === "seed"
          ? "Семенной фонд"
          : String(row.batch_class || "commodity") === "feed"
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
        batch_class: String(row.batch_class || "commodity"),
        identity_name: classLabel ? `${identityCore} / ${classLabel}` : identityCore,
        product_type: productById.get(String(row.product_id))?.product_type || productById.get(String(row.product_id))?.type || "N/A",
        unit: productById.get(String(row.product_id))?.base_uom || productById.get(String(row.product_id))?.unit || "kg",
        quantity: toNumber(row.quantity),
        last_updated: row.last_movement_at || new Date().toISOString(),
      };
    })
    .filter((row) => Math.abs(row.quantity) > 0.000001)
    .sort(
      (a, b) =>
        a.warehouse_name.localeCompare(b.warehouse_name) ||
        (a.identity_name || a.product_name).localeCompare(b.identity_name || b.product_name)
    );
}
