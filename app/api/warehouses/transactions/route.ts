import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, getUserScopedClientFromRequest, resolveCompanyForActor } from "@/lib/auth/server-session";
import { postInventoryTransactionToLedger } from "./_ledger";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import { toStockContractColumns, type StockBusinessEvent } from "@/lib/warehouse/stock-unit-contract";
import {
  AGROCHEMICAL_WAREHOUSE_TYPES,
  isAgrochemicalProductType,
  isAgrochemicalWarehouseType,
} from "@/lib/warehouse/warehouse-scope";

type MovementType = "receipt" | "issue" | "transfer" | "writeoff" | "adjustment";
type TransactionDirection = "in" | "out";
type InventoryStatus = "draft" | "confirmed" | "cancelled";

class WarehouseScopeError extends Error {}

const READ_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "agronomist",
  "director",
] as const;

const WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
] as const;

function toNumberSafe(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeStatus(status: unknown): InventoryStatus {
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

function stockEventForMovement(movementType: MovementType): StockBusinessEvent {
  if (movementType === "receipt") return "manual_receipt";
  if (movementType === "transfer") return "manual_transfer";
  if (movementType === "writeoff") return "manual_writeoff";
  if (movementType === "adjustment") return "manual_adjustment";
  return "manual_issue";
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

function deriveWarehouseAndDirection(body: Record<string, unknown>): {
  warehouseId: string;
  direction: TransactionDirection;
} {
  const movementType = normalizeMovementType(body.movement_type, body.transaction_type);

  if (movementType === "receipt") {
    return { warehouseId: String(body.destination_warehouse_id || ""), direction: "in" };
  }
  if (movementType === "issue" || movementType === "writeoff") {
    return { warehouseId: String(body.source_warehouse_id || ""), direction: "out" };
  }
  if (movementType === "transfer") {
    return { warehouseId: String(body.source_warehouse_id || ""), direction: "out" };
  }
  if (body.transaction_type === "in") {
    return { warehouseId: String(body.destination_warehouse_id || ""), direction: "in" };
  }
  return { warehouseId: String(body.source_warehouse_id || ""), direction: "out" };
}

function applyMovementToBalances(
  map: Map<string, number>,
  movement: {
    status: string;
    movementType: MovementType;
    direction: TransactionDirection;
    sourceWarehouseId?: string | null;
    destinationWarehouseId?: string | null;
    warehouseId?: string | null;
    productId: string;
    quantity: number;
    uom: string;
    batchClass: string;
  }
) {
  if (normalizeStatus(movement.status) !== "confirmed") return;
  const productId = movement.productId;
  const qty = movement.quantity;
  const add = (warehouseId: string, value: number) => {
    const key = `${warehouseId}|${productId}|${movement.uom}|${movement.batchClass}`;
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

  if (movement.direction === "in") {
    const warehouseId = movement.destinationWarehouseId || movement.warehouseId || movement.sourceWarehouseId;
    if (warehouseId) add(warehouseId, qty);
  } else {
    const warehouseId = movement.sourceWarehouseId || movement.warehouseId || movement.destinationWarehouseId;
    if (warehouseId) add(warehouseId, -qty);
  }
}

async function loadConfirmedBalanceMap(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from("v_stock_balance_canonical")
    .select("warehouse_id, product_id, quantity, uom, batch_class")
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  const map = new Map<string, number>();
  (data || []).forEach((row: any) => {
    const warehouseId = String(row.warehouse_id || "");
    const productId = String(row.product_id || "");
    if (!warehouseId || !productId) return;
    const uom = String(row.uom || "");
    const batchClass = String(row.batch_class || "");
    if (!uom || !batchClass) return;
    map.set(`${warehouseId}|${productId}|${uom}|${batchClass}`, toNumberSafe(row.quantity));
  });
  return map;
}

async function assertWarehousekeeperMovementScope(
  supabase: any,
  actorRole: string,
  companyId: string,
  payload: Record<string, any>,
  movementType: MovementType
) {
  if (actorRole !== "warehouse" && actorRole !== "warehouse_operator") return;
  if (movementType === "receipt") {
    throw new WarehouseScopeError("Use the atomic warehouse receipt form for incoming stock");
  }
  if (movementType === "issue" || movementType === "writeoff") {
    throw new WarehouseScopeError("Warehouse issue is allowed only through an operation material request");
  }

  const warehouseIds = [payload.source_warehouse_id, payload.destination_warehouse_id, payload.warehouse_id]
    .map((value) => String(value || ""))
    .filter(Boolean);
  const { data: warehouses, error: warehouseError } = await supabase
    .from("warehouses")
    .select("id,warehouse_type")
    .eq("company_id", companyId)
    .in("id", Array.from(new Set(warehouseIds)));
  if (warehouseError) throw new Error(warehouseError.message);
  if (
    (warehouses || []).length !== Array.from(new Set(warehouseIds)).length ||
    (warehouses || []).some((row: any) => !AGROCHEMICAL_WAREHOUSE_TYPES.includes(row.warehouse_type as any))
  ) {
    throw new WarehouseScopeError("Warehousekeeper movement is limited to agrochemical warehouses");
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id,type,product_type,category,company_id")
    .eq("id", payload.product_id)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .maybeSingle();
  if (productError || !product?.id) throw new WarehouseScopeError(productError?.message || "Material not found");
  if (!isAgrochemicalProductType(product.product_type || product.type || product.category)) {
    throw new WarehouseScopeError("Warehousekeeper movement is limited to agrochemical materials");
  }
}

function ensureSufficientStock(
  balanceMap: Map<string, number>,
  payload: {
    movement_type: MovementType;
    transaction_type: TransactionDirection;
    source_warehouse_id?: string | null;
    product_id: string;
    quantity: number;
    base_uom: string;
    batch_class: string;
  }
) {
  const productId = String(payload.product_id || "");
  const qty = toNumberSafe(payload.quantity);
  if (!productId || qty <= 0) return;

  const needsSourceCheck =
    payload.movement_type === "issue" ||
    payload.movement_type === "writeoff" ||
    payload.movement_type === "transfer" ||
    (payload.movement_type === "adjustment" && payload.transaction_type === "out");
  if (!needsSourceCheck) return;

  const sourceId = String(payload.source_warehouse_id || "").trim();
  if (!sourceId) return;
  const available = balanceMap.get(`${sourceId}|${productId}|${payload.base_uom}|${payload.batch_class}`) || 0;
  if (available < qty) {
    throw new Error(
      `Insufficient stock. Available: ${available.toFixed(2)}, requested: ${qty.toFixed(2)}`
    );
  }
}

function buildPayloadFromBody(
  body: Record<string, unknown>,
  actorProfileId: string,
  actorAuthUserId: string,
  companyId: string
) {
  const status = normalizeStatus(body.status);
  const movementType = normalizeMovementType(body.movement_type, body.transaction_type);
  const quantity = toNumberSafe(body.quantity);
  const operationDatetime = String(body.operation_datetime || "").trim();

  const { warehouseId, direction } = deriveWarehouseAndDirection(body);
  if (!warehouseId) throw new Error("Warehouse is required for this operation");
  if (!operationDatetime) throw new Error("operation_datetime is required");
  if (quantity <= 0) throw new Error("quantity must be > 0");
  if (!String(body.product_id || "").trim()) throw new Error("product_id is required");

  const opDate = operationDatetime.slice(0, 10);
  const nowIso = new Date().toISOString();

  return {
    payload: {
      warehouse_id: warehouseId,
      source_warehouse_id: toNullableText(body.source_warehouse_id),
      destination_warehouse_id: toNullableText(body.destination_warehouse_id),
      product_id: String(body.product_id),
      quantity,
      transaction_type: direction,
      movement_type: movementType,
      status,
      operation_datetime: operationDatetime,
      date: opDate,
      notes: toNullableText(body.notes),
      responsible_user_id: toNullableText(body.responsible_user_id) || actorProfileId,
      user_id: actorAuthUserId,
      confirmed_at: status === "confirmed" ? nowIso : null,
      cancelled_at: status === "cancelled" ? nowIso : null,
      company_id: companyId,
      operation_id: toNullableText(body.operation_id),
      field_id: toNullableText(body.field_id),
      warehouse_issue_request_id: toNullableText(body.warehouse_issue_request_id),
      warehouse_issue_request_item_id: toNullableText(body.warehouse_issue_request_item_id),
      quantity_input: body.quantity_input !== undefined ? toNumberSafe(body.quantity_input) : null,
      input_uom: toNullableText(body.input_uom),
    },
    movementType,
    direction,
    status,
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 500);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 2000) : 500;

    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    const { data, error } = await supabase
      .from("stock_ledger_entries")
      .select(`
        *,
        warehouses:warehouse_id (name, name_ru, name_kz, name_en, warehouse_type),
        products:product_id (name, name_ru, name_kz, name_en, type, product_type, unit, base_uom),
        profiles:created_by (email),
        tickets:ticket_id (ticket_no)
      `)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const visibleRows = (data || []).filter((row: any) => {
      if (actor.role !== "warehouse" && actor.role !== "warehouse_operator") return true;
      return isAgrochemicalWarehouseType(row.warehouses?.warehouse_type) &&
        isAgrochemicalProductType(row.products?.product_type || row.products?.type);
    });

    const transactions = visibleRows.map((row: any) => {
      const direction = row.direction === "in" ? "in" : "out";
      const quantityDelta = Number.isFinite(Number(row.delta_qty_signed))
        ? Number(row.delta_qty_signed)
        : direction === "in"
          ? Math.abs(toNumberSafe(row.quantity))
          : -Math.abs(toNumberSafe(row.quantity));
      const occurredAt = row.occurred_at || row.created_at || null;
      const warehouseName = row.warehouses?.name || "N/A";
      return {
        id: String(row.id),
        warehouse_id: String(row.warehouse_id || ""),
        source_warehouse_id: direction === "out" ? String(row.warehouse_id || "") : null,
        destination_warehouse_id: direction === "in" ? String(row.warehouse_id || "") : null,
        product_id: String(row.product_id || ""),
        quantity: Math.abs(toNumberSafe(row.quantity || quantityDelta)),
        quantity_delta: quantityDelta,
        transaction_type: direction,
        movement_type: normalizeLedgerMovementType(row.reason_type, direction),
        status: "confirmed",
        operation_datetime: occurredAt,
        date: occurredAt ? String(occurredAt).slice(0, 10) : null,
        notes: row.notes || row.reason_type || null,
        responsible_user_id: row.created_by || null,
        confirmed_at: occurredAt,
        cancelled_at: null,
        created_at: row.created_at || occurredAt,
        updated_at: row.created_at || occurredAt,
        user_id: row.created_by || "",
        company_id: row.company_id || companyId,
        source_warehouse_name: direction === "out" ? warehouseName : "-",
        destination_warehouse_name: direction === "in" ? warehouseName : "-",
        warehouse_name: warehouseName,
        product_name: row.products?.name || "N/A",
        product_type: row.products?.product_type || row.products?.type || "N/A",
        product_unit: row.uom || "legacy/unknown",
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
    });

    return NextResponse.json({ transactions });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = await getUserScopedClientFromRequest(request);

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WRITE_ROLES],
    });

    const normalized = buildPayloadFromBody(body, actor.id, actor.authUserId, companyId);
    const contract = await resolveWarehouseStockContract(supabase, {
      companyId,
      productId: normalized.payload.product_id,
      quantity: normalized.payload.quantity,
      inputUom: body.input_uom,
      requestedBatchClass: body.batch_class,
      event: stockEventForMovement(normalized.movementType),
    });
    const canonicalPayload = {
      ...normalized.payload,
      quantity: contract.baseQuantity,
      unit: contract.baseUom,
      base_quantity_kg: contract.massKg,
      ...toStockContractColumns(contract),
    };

    await assertWarehousekeeperMovementScope(
      supabase,
      actor.role,
      companyId,
      canonicalPayload,
      normalized.movementType
    );

    if (normalized.status === "confirmed") {
      const balances = await loadConfirmedBalanceMap(supabase, companyId);
      ensureSufficientStock(balances, {
        movement_type: normalized.movementType,
        transaction_type: normalized.direction,
        source_warehouse_id: canonicalPayload.source_warehouse_id,
        product_id: canonicalPayload.product_id,
        quantity: canonicalPayload.base_quantity,
        base_uom: canonicalPayload.base_uom,
        batch_class: canonicalPayload.batch_class,
      });
    }

    const { data, error } = await supabase
      .from("inventory_transactions")
      .insert(canonicalPayload)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Failed to create movement" }, { status: 400 });
    }

    await postInventoryTransactionToLedger(supabase, data);

    return NextResponse.json({ transaction: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof WarehouseScopeError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
