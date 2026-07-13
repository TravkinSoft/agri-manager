import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
} from "@/app/api/material-requests/_helpers";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import { toStockContractColumns } from "@/lib/warehouse/stock-unit-contract";
import { postInventoryTransactionToLedger } from "@/app/api/warehouses/transactions/_ledger";

type ReturnItemInput = {
  itemId: string;
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

    const body = await request.json().catch(() => ({}));
    const acceptReturn = Boolean(body.acceptReturn);
    let itemsRaw = Array.isArray(body.items) ? body.items : [];
    const closeWithoutReturn = Boolean(body.closeWithoutReturn);
    if (!acceptReturn && itemsRaw.length === 0) {
      return NextResponse.json({ error: "Return items are required" }, { status: 400 });
    }

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
        const nowIso = new Date().toISOString();
        const closePatch: Record<string, unknown> = {
          updated_at: nowIso,
          warehouse_request_status: "closed",
          return_closed_at: nowIso,
          return_received_by_user_id: actor.id,
        };
        let closeResult = await supabase
          .from("warehouse_issue_requests")
          .update(closePatch)
          .eq("id", requestId)
          .eq("company_id", companyId);

        if (closeResult.error && isV5WarehouseSchemaError(closeResult.error)) {
          closeResult = await supabase
            .from("warehouse_issue_requests")
            .update({ updated_at: nowIso })
            .eq("id", requestId)
            .eq("company_id", companyId);
        }

        if (closeResult.error) {
          return NextResponse.json(
            { error: closeResult.error.message || "Failed to close return workflow" },
            { status: 400 }
          );
        }

        return NextResponse.json({
          success: true,
          returned_items: 0,
          return_movements: 0,
          already_received: true,
          request_id: requestId,
        });
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
      const returnedQty = toNonNegativeNumber(item?.returnedQuantity);
      const lossQty = toNonNegativeNumber(item?.lossQuantity ?? 0) ?? 0;
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
      const alreadyReceived = Number(dbItem.return_received_quantity || 0);
      const existingLoss = Number(dbItem.loss_quantity || 0);
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

    if (acceptReturn && txPayload.length > 0) {
      const { data: insertedTransactions, error: insertError } = await supabase
        .from("inventory_transactions")
        .insert(txPayload)
        .select("*");
      if (insertError) {
        return NextResponse.json({ error: insertError.message || "Failed to register return movement" }, { status: 400 });
      }

      for (const tx of insertedTransactions || []) {
        if (!tx?.id) continue;
        try {
          await postInventoryTransactionToLedger(supabase, tx);
        } catch (ledgerPostError) {
          return NextResponse.json(
            { error: ledgerPostError instanceof Error ? ledgerPostError.message : "Failed to post return movement to stock ledger" },
            { status: 400 }
          );
        }
      }
    }

    for (const row of normalized) {
      const nextReturned = acceptReturn ? row.alreadyReturned : row.alreadyReturned + row.returnedQuantity;
      const nextReceived = acceptReturn ? row.alreadyReceived + row.returnedQuantity : row.alreadyReceived;
      const nextLoss = acceptReturn ? row.existingLoss : row.existingLoss + row.lossQuantity;
      const nextStatus = acceptReturn
        ? nextReceived + MATERIAL_QTY_EPS >= nextReturned
          ? "return_received"
          : "return_declared"
        : nextReturned > MATERIAL_QTY_EPS
          ? "return_declared"
          : nextLoss > MATERIAL_QTY_EPS
            ? "loss_review"
            : "reconciled";
      const baseItemPatch = {
        returned_quantity: Number(nextReturned.toFixed(4)),
        consumed_quantity: Number(row.consumedQuantity.toFixed(4)),
      };
      const v5ItemPatch = {
        ...baseItemPatch,
        return_received_quantity: Number(nextReceived.toFixed(4)),
        loss_quantity: Number(nextLoss.toFixed(4)),
        reconciliation_status: nextStatus,
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
    const v5RequestPatch: Record<string, unknown> = {
      ...baseRequestPatch,
      warehouse_request_status: acceptReturn ? "closed" : "return_expected",
    };
    if (acceptReturn) {
      v5RequestPatch.return_received_at = txPayload.length > 0 ? nowIso : null;
      v5RequestPatch.return_closed_at = nowIso;
      v5RequestPatch.return_received_by_user_id = actor.id;
    } else {
      v5RequestPatch.return_expected_at = nowIso;
      v5RequestPatch.return_requested_by_user_id = actor.id;
    }
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
