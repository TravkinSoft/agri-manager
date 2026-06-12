import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
} from "@/app/api/material-requests/_helpers";

type ReturnItemInput = {
  itemId: string;
  returnedQuantity: number;
};

const MATERIAL_QTY_EPS = 0.000001;

function toNonNegativeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isV5WarehouseSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /warehouse_request_status|return_received_at|return_closed_at|expected_return_quantity|return_received_quantity|loss_quantity|schema cache|column/i.test(message);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requestId = String(id || "").trim();
    if (!requestId) {
      return NextResponse.json({ error: "request id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const closeWithoutReturn = Boolean(body.closeWithoutReturn);
    if (itemsRaw.length === 0) {
      return NextResponse.json({ error: "Return items are required" }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });

    const { data: requestRow, error: requestError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,company_id,source_warehouse_id,field_id,operation_id,status,recipient_user_id,assigned_specialist_id")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (requestError || !requestRow?.id) {
      return NextResponse.json({ error: requestError?.message || "Material request not found" }, { status: 404 });
    }
    if (!["issued", "issued_by_warehouse", "partially_issued", "received_confirmed"].includes(String(requestRow.status || ""))) {
      return NextResponse.json({ error: "Returns are allowed only after issue stage" }, { status: 409 });
    }
    if (!requestRow.source_warehouse_id) {
      return NextResponse.json({ error: "Source warehouse is not defined for this request" }, { status: 400 });
    }

    const assignedSpecialistId = String(requestRow.assigned_specialist_id || requestRow.recipient_user_id || "").trim();
    const canBypassSpecialist = actor.role === "global_admin" || actor.role === "company_admin" || actor.role === "agronomist";
    if (assignedSpecialistId && actor.id !== assignedSpecialistId && !canBypassSpecialist) {
      return NextResponse.json({ error: "Only assigned specialist can register returns" }, { status: 403 });
    }

    const { data: requestItems, error: itemsError } = await supabase
      .from("warehouse_issue_request_items")
      .select("id,product_id,issued_quantity,returned_quantity,consumed_quantity,planned_quantity,required_quantity,unit")
      .eq("request_id", requestId)
      .eq("company_id", companyId);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }
    const itemById = new Map((requestItems || []).map((row: any) => [String(row.id), row]));

    const operationMaterialByProduct = new Map<string, any>();
    if (requestRow.operation_id) {
      const { data: operationMaterials, error: operationMaterialsError } = await supabase
        .from("operation_materials")
        .select("product_id,consumed_quantity,returned_quantity")
        .eq("operation_id", requestRow.operation_id)
        .eq("company_id", companyId);

      if (operationMaterialsError) {
        return NextResponse.json(
          { error: operationMaterialsError.message || "Failed to load operation material facts" },
          { status: 400 }
        );
      }

      for (const material of operationMaterials || []) {
        const productId = String((material as any).product_id || "");
        if (productId) operationMaterialByProduct.set(productId, material);
      }
    }

    const normalized: Array<{
      itemId: string;
      returnedQuantity: number;
      dbItem: any;
      issuedQuantity: number;
      consumedQuantity: number;
      alreadyReturned: number;
    }> = [];
    for (const raw of itemsRaw) {
      const item = raw as ReturnItemInput;
      const itemId = String(item?.itemId || "").trim();
      const returnedQty = toNonNegativeNumber(item?.returnedQuantity);
      if (!itemId || returnedQty == null || (!closeWithoutReturn && returnedQty <= MATERIAL_QTY_EPS)) {
        return NextResponse.json({ error: "Invalid return item payload" }, { status: 400 });
      }
      const dbItem = itemById.get(itemId);
      if (!dbItem) {
        return NextResponse.json({ error: `Request item ${itemId} not found` }, { status: 404 });
      }
      const issuedQty = Number(dbItem.issued_quantity || 0);
      const operationMaterial = operationMaterialByProduct.get(String(dbItem.product_id || ""));
      const consumedRaw = dbItem.consumed_quantity ?? operationMaterial?.consumed_quantity ?? null;
      const returnedRaw = dbItem.returned_quantity ?? operationMaterial?.returned_quantity ?? null;
      const consumptionKnown = consumedRaw !== null && consumedRaw !== undefined;
      const consumedQty = consumptionKnown ? Number(consumedRaw || 0) : null;
      const alreadyReturned = Number(returnedRaw || 0);
      const dueReturnQty = consumptionKnown
        ? Math.max(issuedQty - Number(consumedQty || 0) - alreadyReturned, 0)
        : Math.max(issuedQty - alreadyReturned, 0);

      if (!consumptionKnown) {
        return NextResponse.json(
          { error: `Actual material usage is required before registering return for item ${itemId}` },
          { status: 409 }
        );
      }
      if (closeWithoutReturn && dueReturnQty > MATERIAL_QTY_EPS) {
        return NextResponse.json(
          { error: `Return quantity is required for item ${itemId}` },
          { status: 409 }
        );
      }
      if (alreadyReturned + returnedQty > issuedQty + MATERIAL_QTY_EPS || returnedQty > dueReturnQty + MATERIAL_QTY_EPS) {
        return NextResponse.json(
          { error: `Return quantity exceeds required return quantity for item ${itemId}` },
          { status: 400 }
        );
      }
      normalized.push({
        itemId,
        returnedQuantity: returnedQty,
        dbItem,
        issuedQuantity: issuedQty,
        consumedQuantity: Number(consumedQty || 0),
        alreadyReturned,
      });
    }

    const nowIso = new Date().toISOString();
    const txPayload = normalized
      .filter((row) => row.returnedQuantity > MATERIAL_QTY_EPS)
      .map((row) => ({
        warehouse_id: requestRow.source_warehouse_id,
        source_warehouse_id: null,
        destination_warehouse_id: requestRow.source_warehouse_id,
        product_id: row.dbItem.product_id,
        quantity: row.returnedQuantity,
        transaction_type: "in",
        movement_type: "adjustment",
        status: "confirmed",
        operation_datetime: nowIso,
        date: nowIso.slice(0, 10),
        notes: `Material return from request ${requestId}`,
        responsible_user_id: assignedSpecialistId || null,
        confirmed_at: nowIso,
        user_id: actor.id,
        company_id: companyId,
        warehouse_issue_request_id: requestId,
        warehouse_issue_request_item_id: row.itemId,
        operation_id: requestRow.operation_id || null,
        field_id: requestRow.field_id || null,
      }));

    if (txPayload.length > 0) {
      const { error: insertError } = await supabase
        .from("inventory_transactions")
        .insert(txPayload);
      if (insertError) {
        return NextResponse.json({ error: insertError.message || "Failed to register return movement" }, { status: 400 });
      }
    }

    for (const row of normalized) {
      const nextReturned = row.alreadyReturned + row.returnedQuantity;
      const baseItemPatch = {
        returned_quantity: Number(nextReturned.toFixed(4)),
        consumed_quantity: Number(row.consumedQuantity.toFixed(4)),
      };
      const v5ItemPatch = {
        ...baseItemPatch,
        expected_return_quantity: Number(row.returnedQuantity.toFixed(4)),
        return_received_quantity: Number(row.returnedQuantity.toFixed(4)),
      };
      let itemUpdateResult = await supabase
        .from("warehouse_issue_request_items")
        .update(v5ItemPatch)
        .eq("id", row.itemId)
        .eq("company_id", companyId);

      if (itemUpdateResult.error && isV5WarehouseSchemaError(itemUpdateResult.error)) {
        itemUpdateResult = await supabase
          .from("warehouse_issue_request_items")
          .update(baseItemPatch)
          .eq("id", row.itemId)
          .eq("company_id", companyId);
      }

      if (itemUpdateResult.error) {
        return NextResponse.json({ error: itemUpdateResult.error.message || "Failed to update return quantities" }, { status: 400 });
      }
    }

    const baseRequestPatch = {
      updated_at: nowIso,
    };
    const v5RequestPatch = {
      ...baseRequestPatch,
      warehouse_request_status: closeWithoutReturn || txPayload.length === 0 ? "closed" : "return_received",
      return_received_at: txPayload.length > 0 ? nowIso : null,
      return_closed_at: nowIso,
      return_requested_by_user_id: actor.id,
      return_received_by_user_id: actor.id,
    };
    let requestUpdateResult = await supabase
      .from("warehouse_issue_requests")
      .update(v5RequestPatch)
      .eq("id", requestId)
      .eq("company_id", companyId);

    if (requestUpdateResult.error && isV5WarehouseSchemaError(requestUpdateResult.error)) {
      requestUpdateResult = await supabase
        .from("warehouse_issue_requests")
        .update(baseRequestPatch)
        .eq("id", requestId)
        .eq("company_id", companyId);
    }

    if (requestUpdateResult.error) {
      return NextResponse.json(
        { error: requestUpdateResult.error.message || "Failed to update return workflow status" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      returned_items: normalized.length,
      return_movements: txPayload.length,
      closed_without_return: closeWithoutReturn,
      request_id: requestId,
    });
  } catch (error) {
    const sessionError = asMaterialRequestError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
