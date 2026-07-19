import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
} from "@/app/api/material-requests/_helpers";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import { toStockContractColumns } from "@/lib/warehouse/stock-unit-contract";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";

type ReturnItemInput = {
  itemId: string;
  consumedQuantity?: number | null;
  returnedQuantity: number;
  lossQuantity?: number | null;
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

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const acceptReturn = Boolean(body.acceptReturn);
    let itemsRaw = Array.isArray(body.items) ? body.items : [];
    const closeWithoutReturn = Boolean(body.closeWithoutReturn);
    if (!acceptReturn && itemsRaw.length === 0) {
      return NextResponse.json({ error: "Return items are required" }, { status: 400 });
    }
    const idempotency = requireOperationIdempotency(request, { ...body, requestId, action: "return" });

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: acceptReturn ? MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES : MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
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
    if (!acceptReturn && assignedSpecialistId && actor.id !== assignedSpecialistId && !canBypassSpecialist) {
      return NextResponse.json({ error: "Only assigned specialist can register returns" }, { status: 403 });
    }

    const requestItemsResult = await supabase
      .from("warehouse_issue_request_items")
      .select("id,product_id,issued_quantity,returned_quantity,consumed_quantity,planned_quantity,required_quantity,unit,return_received_quantity,loss_quantity,expected_return_quantity,reconciliation_status")
      .eq("request_id", requestId)
      .eq("company_id", companyId);
    let requestItems: any[] | null = requestItemsResult.data as any[] | null;
    let itemsError = requestItemsResult.error;

    if (itemsError && isV5WarehouseSchemaError(itemsError)) {
      const fallbackItems = await supabase
        .from("warehouse_issue_request_items")
        .select("id,product_id,issued_quantity,returned_quantity,consumed_quantity,planned_quantity,required_quantity,unit")
        .eq("request_id", requestId)
        .eq("company_id", companyId);
      requestItems = fallbackItems.data;
      itemsError = fallbackItems.error;
    }

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    if (acceptReturn && itemsRaw.length === 0) {
      itemsRaw = (requestItems || [])
        .filter((item: any) => Number(item.returned_quantity || 0) > Number(item.return_received_quantity || 0) + MATERIAL_QTY_EPS)
        .map((item: any) => ({
          itemId: item.id,
          returnedQuantity: Number(item.returned_quantity || 0) - Number(item.return_received_quantity || 0),
        }));
    }

    if (itemsRaw.length === 0) {
      if (acceptReturn) {
        const { data, error } = await supabase.rpc("return_material_request_atomic_v1", {
          p_company_id: companyId,
          p_actor_profile_id: actor.id,
          p_request_id: requestId,
          p_accept_return: true,
          p_close_without_return: closeWithoutReturn,
          p_items: [],
          p_transactions: [],
          p_idempotency_key: idempotency.key,
          p_request_fingerprint: idempotency.fingerprint,
        });
        if (error || !data) {
          const failure = operationMutationError(error, "Return workflow was not closed");
          return NextResponse.json({ error: failure.message }, { status: failure.status });
        }
        return NextResponse.json(data);
      }
      return NextResponse.json({ error: "Return items are required" }, { status: 400 });
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
      lossQuantity: number;
      dbItem: any;
      issuedQuantity: number;
      consumedQuantity: number;
      alreadyReturned: number;
      alreadyReceived: number;
      existingLoss: number;
    }> = [];
    for (const raw of itemsRaw) {
      const item = raw as ReturnItemInput;
      const itemId = String(item?.itemId || "").trim();
      const submittedConsumedQty = toNonNegativeNumber(item?.consumedQuantity);
      const returnedQty = toNonNegativeNumber(item?.returnedQuantity);
      const lossQty = toNonNegativeNumber(item?.lossQuantity ?? 0) ?? 0;
      if (
        !itemId ||
        returnedQty == null ||
        (!acceptReturn && !closeWithoutReturn && returnedQty <= MATERIAL_QTY_EPS && lossQty <= MATERIAL_QTY_EPS)
      ) {
        return NextResponse.json({ error: "Invalid return item payload" }, { status: 400 });
      }
      const dbItem = itemById.get(itemId);
      if (!dbItem) {
        return NextResponse.json({ error: `Request item ${itemId} not found` }, { status: 404 });
      }
      const issuedQty = Number(dbItem.issued_quantity || 0);
      const operationMaterial = operationMaterialByProduct.get(String(dbItem.product_id || ""));
      const consumedRaw = acceptReturn
        ? dbItem.consumed_quantity ?? operationMaterial?.consumed_quantity ?? null
        : submittedConsumedQty ?? dbItem.consumed_quantity ?? operationMaterial?.consumed_quantity ?? null;
      const returnedRaw = dbItem.returned_quantity ?? operationMaterial?.returned_quantity ?? null;
      const consumptionKnown = consumedRaw !== null && consumedRaw !== undefined;
      const consumedQty = consumptionKnown ? Number(consumedRaw || 0) : null;
      const alreadyReturned = Number(returnedRaw || 0);
      const alreadyReceived = Number(dbItem.return_received_quantity || 0);
      const existingLoss = Number(dbItem.loss_quantity || 0);
      const dueReturnQty = consumptionKnown
        ? Math.max(issuedQty - Number(consumedQty || 0) - alreadyReturned - existingLoss, 0)
        : Math.max(issuedQty - alreadyReturned - existingLoss, 0);

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
      if (!acceptReturn && (alreadyReturned + returnedQty + existingLoss + lossQty > issuedQty + MATERIAL_QTY_EPS || returnedQty + lossQty > dueReturnQty + MATERIAL_QTY_EPS)) {
        return NextResponse.json(
          { error: `Return quantity exceeds required return quantity for item ${itemId}` },
          { status: 400 }
        );
      }
      if (acceptReturn && alreadyReceived + returnedQty > alreadyReturned + MATERIAL_QTY_EPS) {
        return NextResponse.json(
          { error: `Warehouse accepted return exceeds declared return for item ${itemId}` },
          { status: 400 }
        );
      }
      normalized.push({
        itemId,
        returnedQuantity: returnedQty,
        lossQuantity: lossQty,
        dbItem,
        issuedQuantity: issuedQty,
        consumedQuantity: Number(consumedQty || 0),
        alreadyReturned,
        alreadyReceived,
        existingLoss,
      });
    }

    const nowIso = new Date().toISOString();
    const txPayload: any[] = [];
    for (const row of normalized.filter((item) => acceptReturn && item.returnedQuantity > MATERIAL_QTY_EPS)) {
      const contract = await resolveWarehouseStockContract(supabase, {
        companyId,
        productId: row.dbItem.product_id,
        quantity: row.returnedQuantity,
        inputUom: row.dbItem.unit,
        event: "material_return",
      });
      txPayload.push({
        warehouse_id: requestRow.source_warehouse_id,
        source_warehouse_id: null,
        destination_warehouse_id: requestRow.source_warehouse_id,
        product_id: row.dbItem.product_id,
        quantity: contract.baseQuantity,
        unit: contract.baseUom,
        base_quantity_kg: contract.massKg,
        transaction_type: "in",
        movement_type: "adjustment",
        status: "confirmed",
        operation_datetime: nowIso,
        date: nowIso.slice(0, 10),
        notes: `Warehouse accepted material return from request ${requestId}`,
        responsible_user_id: assignedSpecialistId || null,
        confirmed_at: nowIso,
        user_id: actor.id,
        company_id: companyId,
        warehouse_issue_request_id: requestId,
        warehouse_issue_request_item_id: row.itemId,
        operation_id: requestRow.operation_id || null,
        field_id: requestRow.field_id || null,
        quantity_input: row.returnedQuantity,
        input_uom: row.dbItem.unit,
        ...toStockContractColumns(contract),
      });
    }

    const rpcItems = normalized.map((row) => ({
      item_id: row.itemId,
      returned_quantity: Number(row.returnedQuantity.toFixed(4)),
      loss_quantity: Number(row.lossQuantity.toFixed(4)),
      consumed_quantity: Number(row.consumedQuantity.toFixed(4)),
    }));
    const { data, error } = await supabase.rpc("return_material_request_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_request_id: requestId,
      p_accept_return: acceptReturn,
      p_close_without_return: closeWithoutReturn,
      p_items: rpcItems,
      p_transactions: txPayload,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Material return was not saved");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    const sessionError = asMaterialRequestError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    if (error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = operationMutationError(error, "Unknown error");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
