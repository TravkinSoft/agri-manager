import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
} from "@/app/api/material-requests/_helpers";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import { toStockContractColumns } from "@/lib/warehouse/stock-unit-contract";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requestId = String(id || "").trim();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const closeWithoutReturn = Boolean(body.closeWithoutReturn);
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (!requestId) {
      return NextResponse.json({ error: "request id is required" }, { status: 400 });
    }
    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });
    const idempotency = requireOperationIdempotency(request, {
      ...body,
      requestId,
      action: "warehouse_return_v13",
    });

    const { data: requestRow, error: requestError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,company_id,source_warehouse_id,field_id,operation_id,status,assigned_specialist_id")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (requestError || !requestRow?.id) {
      return NextResponse.json(
        { error: requestError?.message || "Material request not found" },
        { status: 404 }
      );
    }
    if (!requestRow.source_warehouse_id) {
      return NextResponse.json({ error: "Source warehouse is required" }, { status: 400 });
    }

    const { data: dbItems, error: itemsError } = await supabase
      .from("warehouse_issue_request_items")
      .select("id,product_id,issued_quantity,returned_quantity,return_received_quantity,loss_quantity,unit")
      .eq("request_id", requestId)
      .eq("company_id", companyId);
    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }
    const itemById = new Map((dbItems || []).map((item: any) => [String(item.id), item]));
    const normalized = rawItems.map((raw: any) => ({
      itemId: String(raw?.itemId || raw?.item_id || "").trim(),
      returnedQuantity: Number(raw?.returnedQuantity ?? raw?.returned_quantity ?? 0),
    }));
    if (
      normalized.some(
        (item) =>
          !item.itemId ||
          !Number.isFinite(item.returnedQuantity) ||
          item.returnedQuantity < 0 ||
          !itemById.has(item.itemId)
      )
    ) {
      return NextResponse.json({ error: "Invalid warehouse return payload" }, { status: 400 });
    }
    if (!closeWithoutReturn && !normalized.some((item) => item.returnedQuantity > 0.000001)) {
      return NextResponse.json({ error: "Physical return quantity is required" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const transactions: Array<Record<string, unknown>> = [];
    for (const item of normalized.filter((row) => row.returnedQuantity > 0.000001)) {
      const dbItem = itemById.get(item.itemId) as any;
      const issued = Number(dbItem.issued_quantity || 0);
      const received = Number(dbItem.return_received_quantity || 0);
      const loss = Number(dbItem.loss_quantity || 0);
      if (received + loss + item.returnedQuantity > issued + 0.000001) {
        return NextResponse.json(
          { error: `Return exceeds issued quantity for item ${item.itemId}` },
          { status: 409 }
        );
      }
      const contract = await resolveWarehouseStockContract(supabase, {
        companyId,
        productId: dbItem.product_id,
        quantity: item.returnedQuantity,
        inputUom: dbItem.unit,
        event: "material_return",
      });
      transactions.push({
        warehouse_issue_request_item_id: item.itemId,
        product_id: dbItem.product_id,
        quantity: contract.baseQuantity,
        base_quantity_kg: contract.massKg,
        quantity_input: item.returnedQuantity,
        input_uom: dbItem.unit,
        notes: `Physical warehouse return from request ${requestId}`,
        ...toStockContractColumns(contract),
        operation_datetime: nowIso,
      });
    }

    const { data, error } = await supabase.rpc(
      "reconcile_material_return_by_warehouse_atomic_v13",
      {
        p_company_id: companyId,
        p_actor_profile_id: actor.id,
        p_request_id: requestId,
        p_close_without_return: closeWithoutReturn,
        p_items: normalized.map((item) => ({
          item_id: item.itemId,
          returned_quantity: Number(item.returnedQuantity.toFixed(4)),
        })),
        p_transactions: transactions,
        p_idempotency_key: idempotency.key,
        p_request_fingerprint: idempotency.fingerprint,
      }
    );
    if (error || !data) {
      const failure = operationMutationError(error, "Warehouse return was not saved");
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
