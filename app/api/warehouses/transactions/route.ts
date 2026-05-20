import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

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
  }
) {
  if (normalizeStatus(movement.status) !== "confirmed") return;
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
    .select("warehouse_id, product_id, quantity")
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  const map = new Map<string, number>();
  (data || []).forEach((row: any) => {
    const warehouseId = String(row.warehouse_id || "");
    const productId = String(row.product_id || "");
    if (!warehouseId || !productId) return;
    map.set(`${warehouseId}|${productId}`, toNumberSafe(row.quantity));
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
  const available = balanceMap.get(`${sourceId}|${productId}`) || 0;
  if (available < qty) {
    throw new Error(
      `Insufficient stock. Available: ${available.toFixed(2)}, requested: ${qty.toFixed(2)}`
    );
  }
}

function buildPayloadFromBody(
  body: Record<string, unknown>,
  actorProfileId: string,
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
      confirmed_at: status === "confirmed" ? nowIso : null,
      cancelled_at: status === "cancelled" ? nowIso : null,
      company_id: companyId,
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

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    const { data, error } = await supabase
      .from("inventory_transactions")
      .select("*")
      .eq("company_id", companyId)
      .order("operation_datetime", { ascending: false, nullsFirst: false })
      .order("date", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ transactions: data || [] });
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
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WRITE_ROLES],
    });

    const normalized = buildPayloadFromBody(body, actor.id, companyId);

    if (normalized.status === "confirmed") {
      const balances = await loadConfirmedBalanceMap(companyId);
      ensureSufficientStock(balances, {
        movement_type: normalized.movementType,
        transaction_type: normalized.direction,
        source_warehouse_id: normalized.payload.source_warehouse_id,
        product_id: normalized.payload.product_id,
        quantity: normalized.payload.quantity,
      });
    }

    const { data, error } = await supabase
      .from("inventory_transactions")
      .insert(normalized.payload)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Failed to create movement" }, { status: 400 });
    }

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
