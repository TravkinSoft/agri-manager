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
};

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
      const { data, error } = await supabase.rpc("issue_material_request_atomic_v3", {
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
      .select("id,product_id,prepared_quantity,issued_quantity,unit,planned_product_id,actual_product_id,substitution_status")
      .eq("request_id", requestId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 400 });
    if (!requestItems?.length) {
      return NextResponse.json({ error: "Material request has no items to issue" }, { status: 400 });
    }
    const { data: preparedAllocations, error: allocationsError } = await supabase
      .from("warehouse_issue_request_item_allocations")
      .select("id,request_item_id,warehouse_id,batch_id_text,batch_class,prepared_quantity,issued_quantity")
      .eq("request_id", requestId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (allocationsError) {
      return NextResponse.json(
        { error: allocationsError.message || "Failed to load prepared stock batches" },
        { status: 400 }
      );
    }
    if (!preparedAllocations?.length) {
      return NextResponse.json(
        { error: "Request has no explicitly prepared stock batches" },
        { status: 409 }
      );
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

      items.push({
        item_id: item.id,
        issued_quantity: Number(quantity.toFixed(4)),
        issued_unit: item.unit,
      });
      const allocations = preparedAllocations.filter(
        (allocation: any) =>
          String(allocation.request_item_id) === String(item.id) &&
          toNumber(allocation.prepared_quantity) -
            toNumber(allocation.issued_quantity) >
            0.000001
      );
      const allocationTotal = allocations.reduce(
        (sum: number, allocation: any) =>
          sum +
          Math.max(
            toNumber(allocation.prepared_quantity) -
              toNumber(allocation.issued_quantity),
            0
          ),
        0
      );
      if (Math.abs(allocationTotal - quantity) > 0.0001) {
        return NextResponse.json(
          { error: `Prepared batches do not match issue quantity for item ${item.id}` },
          { status: 409 }
        );
      }
      for (const allocation of allocations) {
        if (String(allocation.warehouse_id) !== sourceWarehouseId) {
          return NextResponse.json(
            { error: "Prepared batch belongs to another warehouse" },
            { status: 409 }
          );
        }
        const allocationQuantity =
          toNumber(allocation.prepared_quantity) -
          toNumber(allocation.issued_quantity);
        const allocationContract = await resolveWarehouseStockContract(supabase, {
          companyId,
          productId: item.actual_product_id || item.product_id,
          quantity: allocationQuantity,
          inputUom: item.unit,
          requestedBatchClass: allocation.batch_class,
          event: "material_issue",
          unitSourceOverride: "stock_identity",
        });
        ledgerRows.push({
          allocation_id: allocation.id,
          product_id: item.actual_product_id || item.product_id,
          warehouse_id: sourceWarehouseId,
          quantity: allocationContract.baseQuantity,
          uom: allocationContract.baseUom,
          delta_qty_signed: -Math.abs(allocationContract.baseQuantity),
          reason_ref_id: item.id,
          occurred_at: nowIso,
          notes: `Atomic warehouse issue for request ${requestRow.request_number || requestId}`,
          batch_id_text: allocation.batch_id_text,
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

    const { data, error } = await supabase.rpc("issue_material_request_atomic_v3", {
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
