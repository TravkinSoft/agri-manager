import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
} from "@/app/api/material-requests/_helpers";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";

type IssueLinePayload = {
  itemId?: string;
  issuedQuantity?: number;
  batchId?: string | null;
};

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function allocateStockIdentity(
  supabase: any,
  params: {
    companyId: string;
    warehouseId: string;
    productId: string;
    quantity: number;
    batchId?: string | null;
    uom: string;
    batchClass: string;
  }
) {
  let query = supabase
    .from("v_stock_balance_identity")
    .select("batch_id,batch_class,uom,quantity,last_movement_at")
    .eq("company_id", params.companyId)
    .eq("warehouse_id", params.warehouseId)
    .eq("product_id", params.productId)
    .eq("uom", params.uom)
    .eq("batch_class", params.batchClass)
    .gt("quantity", 0)
    .order("last_movement_at", { ascending: true });
  if (params.batchId) query = query.eq("batch_id", params.batchId);

  const { data, error } = await query;
  if (error) throw new Error(error.message || "Failed to allocate stock identity");

  const allocations: Array<{ quantity: number; batchId: string | null; batchClass: string; uom: string }> = [];
  let remaining = params.quantity;
  for (const row of data || []) {
    if (remaining <= 0.000001) break;
    const available = toNumber(row.quantity);
    if (available <= 0) continue;
    const quantity = Math.min(available, remaining);
    allocations.push({
      quantity: Number(quantity.toFixed(4)),
      batchId: row.batch_id ? String(row.batch_id) : null,
      batchClass: String(row.batch_class),
      uom: String(row.uom),
    });
    remaining = Number((remaining - quantity).toFixed(4));
  }
  if (remaining > 0.000001) {
    throw new OperationMutationInputError(
      `Insufficient stock for product ${params.productId}. Available identity stock is lower than required.`,
      409
    );
  }
  return allocations;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requestId = String(id || "").trim();
    if (!requestId) return NextResponse.json({ error: "request id is required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sourceWarehouseId = String(body.sourceWarehouseId || "").trim();
    if (!sourceWarehouseId) {
      return NextResponse.json({ error: "sourceWarehouseId is required" }, { status: 400 });
    }
    const idempotency = requireOperationIdempotency(request, { ...body, requestId, action: "issue" });
    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });

    const { data: requestRow, error: requestError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status,source_warehouse_id,request_number,operation_id")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (requestError || !requestRow) {
      return NextResponse.json({ error: requestError?.message || "Material request not found" }, { status: 404 });
    }

    if (["issued", "issued_by_warehouse"].includes(String(requestRow.status || ""))) {
      const { data, error } = await supabase.rpc("issue_material_request_atomic_v1", {
        p_company_id: companyId,
        p_actor_profile_id: actor.id,
        p_request_id: requestId,
        p_source_warehouse_id: sourceWarehouseId,
        p_items: [],
        p_ledger_rows: [],
        p_idempotency_key: idempotency.key,
        p_request_fingerprint: idempotency.fingerprint,
      });
      if (error || !data) {
        const failure = operationMutationError(error, "Material issue was not saved");
        return NextResponse.json({ error: failure.message }, { status: failure.status });
      }
      return NextResponse.json(data);
    }

    const { data: requestItems, error: itemsError } = await supabase
      .from("warehouse_issue_request_items")
      .select("id,product_id,prepared_quantity,issued_quantity,batch_id,unit,planned_product_id,actual_product_id,substitution_status")
      .eq("request_id", requestId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 400 });
    if (!requestItems?.length) {
      return NextResponse.json({ error: "Material request has no items to issue" }, { status: 400 });
    }

    const requested = new Map(
      (Array.isArray(body.items) ? body.items : []).map((raw) => {
        const item = raw as IssueLinePayload;
        return [String(item.itemId || ""), item] as const;
      })
    );
    const items: Array<Record<string, unknown>> = [];
    const ledgerRows: Array<Record<string, unknown>> = [];
    const nowIso = new Date().toISOString();

    for (const item of requestItems) {
      const prepared = toNumber(item.prepared_quantity);
      const issued = toNumber(item.issued_quantity);
      const remaining = Math.max(prepared - issued, 0);
      const requestedItem = requested.get(String(item.id));
      const quantity = requestedItem ? toNumber(requestedItem.issuedQuantity) : remaining;
      if (quantity <= 0) continue;
      if (quantity > remaining + 0.000001) {
        return NextResponse.json({ error: `Issued quantity exceeds prepared remainder for item ${item.id}` }, { status: 400 });
      }
      if (
        item.planned_product_id &&
        item.actual_product_id &&
        item.planned_product_id !== item.actual_product_id &&
        item.substitution_status !== "approved"
      ) {
        return NextResponse.json({ error: `Material substitution must be approved for item ${item.id}` }, { status: 409 });
      }

      const contract = await resolveWarehouseStockContract(supabase, {
        companyId,
        productId: item.product_id,
        quantity,
        inputUom: item.unit,
        event: "material_issue",
      });
      const batchId = requestedItem?.batchId || item.batch_id || null;
      const allocations = await allocateStockIdentity(supabase, {
        companyId,
        warehouseId: sourceWarehouseId,
        productId: String(item.product_id),
        quantity,
        batchId,
        uom: contract.baseUom,
        batchClass: contract.batchClass,
      });

      items.push({
        item_id: item.id,
        issued_quantity: Number(quantity.toFixed(4)),
        issued_unit: item.unit,
        batch_id: batchId,
      });
      for (const allocation of allocations) {
        const allocationContract = await resolveWarehouseStockContract(supabase, {
          companyId,
          productId: item.product_id,
          quantity: allocation.quantity,
          inputUom: allocation.uom,
          requestedBatchClass: allocation.batchClass,
          event: "material_issue",
          unitSourceOverride: "stock_identity",
        });
        ledgerRows.push({
          product_id: item.product_id,
          warehouse_id: sourceWarehouseId,
          quantity: allocationContract.baseQuantity,
          uom: allocationContract.baseUom,
          delta_qty_signed: -Math.abs(allocationContract.baseQuantity),
          reason_ref_id: item.id,
          occurred_at: nowIso,
          notes: `Atomic warehouse issue for request ${requestRow.request_number || requestId}`,
          batch_id_text: allocation.batchId,
          batch_class: allocationContract.batchClass,
          mass_kg: allocationContract.massKg,
          density_kg_per_l: allocationContract.densityKgPerL,
          density_unit: allocationContract.densityUnit,
          density_source: allocationContract.densitySource,
          density_verification_status: allocationContract.densityVerificationStatus,
          density_verified_at: allocationContract.densityVerifiedAt,
          unit_source: allocationContract.unitSource,
          unit_contract_version: allocationContract.unitContractVersion,
        });
      }
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "Set at least one issue quantity greater than zero" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("issue_material_request_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_request_id: requestId,
      p_source_warehouse_id: sourceWarehouseId,
      p_items: items,
      p_ledger_rows: ledgerRows,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Material issue was not saved");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    const sessionError = asMaterialRequestError(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    if (error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = operationMutationError(error, "Unknown error");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
