import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { postInventoryTransactionToLedger } from "../_ledger";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import { toStockContractColumns, type StockBusinessEvent } from "@/lib/warehouse/stock-unit-contract";

type MovementType = "receipt" | "issue" | "transfer" | "writeoff" | "adjustment";
type TransactionDirection = "in" | "out";
type InventoryStatus = "draft" | "confirmed" | "cancelled";

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

const DELETE_ROLES = [
  "global_admin",
  "company_admin",
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

async function loadConfirmedBalanceMap(companyId: string) {
  const supabase = getServiceClient();
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
  existing: Record<string, unknown>
) {
  const movementType = normalizeMovementType(
    body.movement_type ?? existing.movement_type,
    body.transaction_type ?? existing.transaction_type
  );
  const status = normalizeStatus(body.status ?? existing.status);
  const quantity = toNumberSafe(body.quantity ?? existing.quantity);
  const operationDatetime = String(
    body.operation_datetime ?? existing.operation_datetime ?? existing.date ?? ""
  ).trim();

  const sourceWarehouseId = toNullableText(
    body.source_warehouse_id !== undefined ? body.source_warehouse_id : existing.source_warehouse_id
  );
  const destinationWarehouseId = toNullableText(
    body.destination_warehouse_id !== undefined ? body.destination_warehouse_id : existing.destination_warehouse_id
  );
  const productId = String(body.product_id ?? existing.product_id ?? "").trim();

  const draftForDerive: Record<string, unknown> = {
    movement_type: movementType,
    transaction_type: body.transaction_type ?? existing.transaction_type,
    source_warehouse_id: sourceWarehouseId,
    destination_warehouse_id: destinationWarehouseId,
  };
  const { warehouseId, direction } = deriveWarehouseAndDirection(draftForDerive);
  if (!warehouseId) throw new Error("Warehouse is required for this operation");
  if (!operationDatetime) throw new Error("operation_datetime is required");
  if (quantity <= 0) throw new Error("quantity must be > 0");
  if (!productId) throw new Error("product_id is required");

  const opDate = operationDatetime.slice(0, 10);
  const nowIso = new Date().toISOString();

  return {
    payload: {
      warehouse_id: warehouseId,
      source_warehouse_id: sourceWarehouseId,
      destination_warehouse_id: destinationWarehouseId,
      product_id: productId,
      quantity,
      transaction_type: direction,
      movement_type: movementType,
      status,
      operation_datetime: operationDatetime,
      date: opDate,
      notes: body.notes !== undefined ? toNullableText(body.notes) : existing.notes,
      responsible_user_id:
        body.responsible_user_id !== undefined
          ? toNullableText(body.responsible_user_id)
          : existing.responsible_user_id,
      confirmed_at: status === "confirmed" ? nowIso : null,
      cancelled_at: status === "cancelled" ? nowIso : null,
      quantity_input:
        body.quantity_input !== undefined ? toNumberSafe(body.quantity_input) : existing.quantity_input,
      input_uom: body.input_uom !== undefined ? toNullableText(body.input_uom) : existing.input_uom,
    },
    movementType,
    direction,
    status,
  };
}

async function resolveTransaction(
  request: NextRequest,
  id: string,
  allowedRoles: readonly string[]
) {
  const actor = await getServerActorFromSession(request);
  const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  const supabase = getServiceClient();

  await assertActorAccess({
    supabase,
    actorUserId: actor.id,
    companyId,
    allowedRoles: [...allowedRoles] as any,
  });

  const { data, error } = await supabase
    .from("inventory_transactions")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { actor, companyId, supabase, existing: data || null };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const transactionId = String(id || "").trim();
    if (!transactionId) return NextResponse.json({ error: "Transaction id is required" }, { status: 400 });

    const { existing } = await resolveTransaction(request, transactionId, READ_ROLES);
    if (!existing?.id) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    return NextResponse.json({ transaction: existing });
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const transactionId = String(id || "").trim();
    if (!transactionId) return NextResponse.json({ error: "Transaction id is required" }, { status: 400 });

    const { companyId, supabase, existing } = await resolveTransaction(request, transactionId, WRITE_ROLES);
    if (!existing?.id) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    const existingStatus = normalizeStatus(existing.status);
    if (existingStatus === "confirmed" || existingStatus === "cancelled") {
      return NextResponse.json(
        { error: "Confirmed/cancelled movements are read-only. Create a correction movement." },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const normalized = buildPayloadFromBody(body, existing);
    const contract = await resolveWarehouseStockContract(supabase, {
      companyId,
      productId: normalized.payload.product_id,
      quantity: normalized.payload.quantity,
      inputUom: normalized.payload.input_uom || existing.base_uom || existing.unit,
      requestedBatchClass: body.batch_class ?? existing.batch_class,
      event: stockEventForMovement(normalized.movementType),
    });
    const canonicalPayload = {
      ...normalized.payload,
      quantity: contract.baseQuantity,
      unit: contract.baseUom,
      base_quantity_kg: contract.massKg,
      ...toStockContractColumns(contract),
    };

    if (normalized.status === "confirmed") {
      const balances = await loadConfirmedBalanceMap(companyId);
      const existingMovementType = normalizeMovementType(existing.movement_type, existing.transaction_type);
      const existingDirection = (existing.transaction_type === "in" ? "in" : "out") as TransactionDirection;
      applyMovementToBalances(balances, {
        status: "confirmed",
        movementType: existingMovementType,
        direction: existingDirection,
        sourceWarehouseId: existing.source_warehouse_id,
        destinationWarehouseId: existing.destination_warehouse_id,
        warehouseId: existing.warehouse_id,
        productId: String(existing.product_id || ""),
        quantity: toNumberSafe(existing.base_quantity ?? existing.quantity),
        uom: String(existing.base_uom || existing.unit || ""),
        batchClass: String(existing.batch_class || ""),
      });

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
      .update(canonicalPayload)
      .eq("id", transactionId)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Failed to update movement" }, { status: 400 });

    await postInventoryTransactionToLedger(supabase, data);

    return NextResponse.json({ transaction: data });
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

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const transactionId = String(id || "").trim();
    if (!transactionId) return NextResponse.json({ error: "Transaction id is required" }, { status: 400 });

    const { companyId, supabase, existing } = await resolveTransaction(request, transactionId, DELETE_ROLES);
    if (!existing?.id) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    if (normalizeStatus(existing.status) !== "draft") {
      return NextResponse.json(
        { error: "Only draft movements can be hard deleted" },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("inventory_transactions")
      .delete()
      .eq("id", transactionId)
      .eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ deleted: true });
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
