import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
  toWorkflowStatus,
} from "@/app/api/material-requests/_helpers";
import { calculateMaterialReconciliation, roundMaterialQuantity } from "@/lib/materials/reconciliation";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";

type IssueLinePayload = {
  itemId: string;
  issuedQuantity: number;
  batchId?: string | null;
};

function toPositiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isV5WarehouseSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /warehouse_request_status|prepared_quantity|expected_consumed_quantity|shortage_quantity|reconciliation_status|substitution_status|planned_product_id|actual_product_id|schema cache|column/i.test(message);
}

function normalizeOperationMaterialTypeForDb(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "additive") return "adjuvant";
  if (normalized === "crop_protection" || normalized === "plant_protection") return "pesticide";
  if (normalized === "micro_fertilizer") return "fertilizer";
  if (normalized === "antifoam") return "defoamer";
  return normalized || "other";
}

async function getProductBalance(
  supabase: any,
  params: {
    companyId: string;
    warehouseId: string;
    productId: string;
    uom: string;
    batchClass: string;
  }
): Promise<number> {
  const { data, error } = await supabase
    .from("v_stock_balance_identity")
    .select("quantity")
    .eq("company_id", params.companyId)
    .eq("warehouse_id", params.warehouseId)
    .eq("product_id", params.productId)
    .eq("uom", params.uom)
    .eq("batch_class", params.batchClass);

  if (error) {
    throw new Error(error.message || "Failed to check unit-aware stock balance");
  }

  return (data || []).reduce((sum: number, row: any) => sum + toNumber(row.quantity), 0);
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
): Promise<Array<{ quantity: number; batchId: string | null; batchClass: string; uom: string }>> {
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

  if (params.batchId) {
    query = query.eq("batch_id", params.batchId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || "Failed to allocate stock identity");

  const allocations: Array<{ quantity: number; batchId: string | null; batchClass: string; uom: string }> = [];
  let remaining = params.quantity;

  for (const row of data || []) {
    if (remaining <= 0.000001) break;
    const available = toNumber(row.quantity);
    if (available <= 0) continue;
    const qty = Math.min(available, remaining);
    allocations.push({
      quantity: Number(qty.toFixed(4)),
      batchId: row.batch_id ? String(row.batch_id) : null,
      batchClass: String(row.batch_class),
      uom: String(row.uom),
    });
    remaining = Number((remaining - qty).toFixed(4));
  }

  if (remaining > 0.000001) {
    throw new Error(`Insufficient stock for product ${params.productId}. Available identity stock is lower than required.`);
  }

  return allocations;
}

async function syncOperationMaterialsFromRequest(
  supabase: any,
  params: {
    companyId: string;
    requestId: string;
    operationId: string | null;
    actorId: string;
  }
) {
  if (!params.operationId) return;

  let { data: items, error } = await supabase
    .from("warehouse_issue_request_items")
    .select("product_id,product_category,planned_quantity,required_quantity,issued_quantity,unit,actual_product_id,planned_product_id,substitution_status")
    .eq("company_id", params.companyId)
    .eq("request_id", params.requestId);

  if (error && isV5WarehouseSchemaError(error)) {
    const fallback = await supabase
      .from("warehouse_issue_request_items")
      .select("product_id,product_category,planned_quantity,required_quantity,issued_quantity,unit")
      .eq("company_id", params.companyId)
      .eq("request_id", params.requestId);
    items = fallback.data;
    error = fallback.error;
  }

  if (error) throw new Error(error.message || "Failed to read request items for operation material sync");

  const grouped = new Map<
    string,
    { productId: string; materialType: string; unit: string; planned: number; issued: number }
  >();

  for (const item of items || []) {
    const productId =
      item.actual_product_id && item.substitution_status === "approved"
        ? String(item.actual_product_id)
        : String(item.product_id || "");
    if (!productId) continue;
    const current =
      grouped.get(productId) || {
        productId,
        materialType: normalizeOperationMaterialTypeForDb(item.product_category || "other"),
        unit: String(item.unit || ""),
        planned: 0,
        issued: 0,
      };
    current.planned += toNumber(item.planned_quantity ?? item.required_quantity);
    current.issued += toNumber(item.issued_quantity);
    grouped.set(productId, current);
  }

  for (const row of Array.from(grouped.values())) {
    const patch = {
      planned_quantity: Number(row.planned.toFixed(4)),
      issued_quantity: Number(row.issued.toFixed(4)),
      unit: row.unit,
      updated_by_user_id: params.actorId,
    };
    const { data: updated, error: updateError } = await supabase
      .from("operation_materials")
      .update(patch)
      .eq("company_id", params.companyId)
      .eq("operation_id", params.operationId)
      .eq("product_id", row.productId)
      .select("id");

    if (updateError) throw new Error(updateError.message || "Failed to sync issued material with operation");
    if ((updated || []).length > 0) continue;

    const { error: insertError } = await supabase.from("operation_materials").insert({
      company_id: params.companyId,
      operation_id: params.operationId,
      product_id: row.productId,
      material_type: row.materialType,
      unit: row.unit,
      planned_quantity: Number(row.planned.toFixed(4)),
      issued_quantity: Number(row.issued.toFixed(4)),
      created_by_user_id: params.actorId,
      updated_by_user_id: params.actorId,
      notes: "synced from warehouse issue request",
    });
    if (insertError) throw new Error(insertError.message || "Failed to create synced operation material");
  }
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
    const sourceWarehouseId = String(body.sourceWarehouseId || "").trim();
    if (!sourceWarehouseId) {
      return NextResponse.json({ error: "sourceWarehouseId is required" }, { status: 400 });
    }

    const issueItemsInput = Array.isArray(body.items) ? body.items : [];
    const issueItems: Array<{ item_id: string; issued_quantity: number; batch_id?: string }> = [];

    for (const raw of issueItemsInput) {
      const item = raw as IssueLinePayload;
      const itemId = String(item?.itemId || "").trim();
      const issuedQuantity = toPositiveNumber(item?.issuedQuantity);
      if (!itemId) continue;
      if (issuedQuantity == null) {
        return NextResponse.json({ error: `Invalid issuedQuantity for item ${itemId}` }, { status: 400 });
      }
      const normalized: { item_id: string; issued_quantity: number; batch_id?: string } = {
        item_id: itemId,
        issued_quantity: issuedQuantity,
      };
      if (item?.batchId) normalized.batch_id = String(item.batchId);
      issueItems.push(normalized);
    }

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });
    const actorUserId = actor.authUserId || actor.id;

    const { data: reqRow, error: reqError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status,company_id,source_warehouse_id,issued_at,request_number,operation_id,field_id,assigned_specialist_id,recipient_user_id")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (reqError || !reqRow?.id) {
      return NextResponse.json({ error: reqError?.message || "Material request not found" }, { status: 404 });
    }

    const currentStatus = String(reqRow.status || "");
    if (currentStatus === "issued_by_warehouse" || currentStatus === "issued") {
      await syncOperationMaterialsFromRequest(supabase, {
        companyId,
        requestId,
        operationId: reqRow.operation_id || null,
        actorId: actorUserId,
      });
      return NextResponse.json({
        result: { success: true, already_issued: true, request_id: requestId, status: currentStatus },
        workflow_status: toWorkflowStatus(currentStatus),
      });
    }

    if (currentStatus === "received_confirmed" && reqRow.issued_at) {
      await syncOperationMaterialsFromRequest(supabase, {
        companyId,
        requestId,
        operationId: reqRow.operation_id || null,
        actorId: actorUserId,
      });
      return NextResponse.json({
        result: { success: true, already_issued: true, request_id: requestId, status: currentStatus },
        workflow_status: toWorkflowStatus(currentStatus),
      });
    }

    if (currentStatus !== "received_confirmed") {
      return NextResponse.json(
        { error: "Specialist must accept prepared materials before warehouse issue" },
        { status: 409 }
      );
    }

    if (reqRow.source_warehouse_id && String(reqRow.source_warehouse_id) !== sourceWarehouseId) {
      return NextResponse.json(
        { error: "Selected warehouse does not match the prepared request warehouse" },
        { status: 400 }
      );
    }

    const { data: warehouseRow, error: warehouseError } = await supabase
      .from("warehouses")
      .select("id")
      .eq("id", sourceWarehouseId)
      .eq("company_id", companyId)
      .eq("archived", false)
      .maybeSingle();

    if (warehouseError || !warehouseRow?.id) {
      return NextResponse.json({ error: warehouseError?.message || "Source warehouse not found" }, { status: 404 });
    }

    const requestItemsResult = await supabase
      .from("warehouse_issue_request_items")
      .select("id,product_id,planned_quantity,required_quantity,prepared_quantity,issued_quantity,batch_id,unit,package_size,package_count,planned_product_id,actual_product_id,substitution_status")
      .eq("request_id", requestId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    let requestItems: any[] | null = requestItemsResult.data as any[] | null;
    let itemsError = requestItemsResult.error;

    if (itemsError && isV5WarehouseSchemaError(itemsError)) {
      const fallbackItems = await supabase
        .from("warehouse_issue_request_items")
        .select("id,product_id,planned_quantity,required_quantity,issued_quantity,batch_id,unit")
        .eq("request_id", requestId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      requestItems = fallbackItems.data;
      itemsError = fallbackItems.error;
    }

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    if (!requestItems?.length) {
      return NextResponse.json({ error: "Material request has no items to issue" }, { status: 400 });
    }

    const requestedByItemId = new Map(issueItems.map((item) => [item.item_id, item]));
    const issuePlan: Array<{ item: any; quantity: number; batchId: string | null }> = [];

    for (const item of requestItems) {
      const prepared = Number(item.prepared_quantity ?? 0);
      const targetQuantity = prepared;
      const alreadyIssued = Number(item.issued_quantity || 0);
      const remaining = Math.max(targetQuantity - alreadyIssued, 0);
      const requested = requestedByItemId.get(String(item.id));
      const quantity = requested ? Number(requested.issued_quantity || 0) : remaining;
      if (!Number.isFinite(quantity) || quantity < 0) {
        return NextResponse.json({ error: `Invalid issue quantity for item ${item.id}` }, { status: 400 });
      }
      if (quantity === 0) continue;
      if (quantity > remaining + 0.000001) {
        return NextResponse.json(
          { error: `Issued quantity exceeds prepared remainder for item ${item.id}` },
          { status: 400 }
        );
      }
      const plannedProductId = String(item.planned_product_id || item.product_id || "");
      const actualProductId = String(item.actual_product_id || item.product_id || "");
      if (plannedProductId && actualProductId && plannedProductId !== actualProductId && item.substitution_status !== "approved") {
        return NextResponse.json(
          { error: `Material substitution must be approved before issue for item ${item.id}` },
          { status: 409 }
        );
      }
      issuePlan.push({
        item,
        quantity: Number(quantity.toFixed(4)),
        batchId: requested?.batch_id || item.batch_id || null,
      });
    }

    if (issuePlan.length === 0) {
      return NextResponse.json({ error: "Set at least one issue quantity greater than zero" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const ledgerRows: any[] = [];
    for (const row of issuePlan) {
      const requestedContract = await resolveWarehouseStockContract(supabase, {
        companyId,
        productId: row.item.product_id,
        quantity: row.quantity,
        inputUom: row.item.unit,
        event: "material_issue",
      });
      const balance = await getProductBalance(supabase, {
        companyId,
        warehouseId: sourceWarehouseId,
        productId: row.item.product_id,
        uom: requestedContract.baseUom,
        batchClass: requestedContract.batchClass,
      });
      if (balance + 0.000001 < row.quantity) {
        return NextResponse.json(
          {
            error: `Insufficient stock for product ${row.item.product_id}. Available: ${balance}, required: ${row.quantity}`,
          },
          { status: 400 }
        );
      }

      const { data: existingLedger, error: existingLedgerError } = await supabase
        .from("stock_ledger_entries")
        .select("id,quantity,delta_qty_signed")
        .eq("company_id", companyId)
        .eq("reason_ref_id", row.item.id)
        .eq("reason_type", "warehouse_issue")
        .eq("warehouse_id", sourceWarehouseId)
        .eq("product_id", row.item.product_id)
        .eq("uom", requestedContract.baseUom)
        .eq("batch_class", requestedContract.batchClass)
        .eq("is_storno", false);
      if (existingLedgerError) {
        return NextResponse.json({ error: existingLedgerError.message || "Failed to check issued ledger" }, { status: 400 });
      }

      const alreadyPosted = (existingLedger || []).reduce(
        (sum: number, entry: any) => sum + Math.abs(toNumber(entry.delta_qty_signed ?? entry.quantity)),
        0
      );
      const quantityToPost = Math.max(row.quantity - alreadyPosted, 0);
      if (quantityToPost <= 0.000001) continue;

      const allocations = await allocateStockIdentity(supabase, {
        companyId,
        warehouseId: sourceWarehouseId,
        productId: row.item.product_id,
        quantity: Number(quantityToPost.toFixed(4)),
        batchId: row.batchId,
        uom: requestedContract.baseUom,
        batchClass: requestedContract.batchClass,
      });

      for (const allocation of allocations) {
        const contract = await resolveWarehouseStockContract(supabase, {
          companyId,
          productId: row.item.product_id,
          quantity: allocation.quantity,
          inputUom: allocation.uom,
          requestedBatchClass: allocation.batchClass,
          event: "material_issue",
          unitSourceOverride: "stock_identity",
        });
        ledgerRows.push({
          company_id: companyId,
          product_id: row.item.product_id,
          warehouse_id: sourceWarehouseId,
          direction: "out",
          quantity: contract.baseQuantity,
          uom: contract.baseUom,
          delta_qty_signed: -Math.abs(contract.baseQuantity),
          reason_type: "warehouse_issue",
          reason_ref_id: row.item.id,
          occurred_at: nowIso,
          created_by: actorUserId,
          notes: `Warehouse issue after specialist pickup. Request ${reqRow.request_number || requestId}, operation ${reqRow.operation_id || "-"}`,
          batch_id_text: allocation.batchId,
          batch_class: contract.batchClass,
          mass_kg: contract.massKg,
          density_kg_per_l: contract.densityKgPerL,
          density_unit: contract.densityUnit,
          density_source: contract.densitySource,
          density_verification_status: contract.densityVerificationStatus,
          density_verified_at: contract.densityVerifiedAt,
          unit_source: contract.unitSource,
          unit_contract_version: contract.unitContractVersion,
          operation_line_id: null,
        });
      }
    }

    if (ledgerRows.length > 0) {
      const { error: ledgerError } = await supabase.from("stock_ledger_entries").insert(ledgerRows);
      if (ledgerError) {
        return NextResponse.json({ error: ledgerError.message || "Issue ledger insert failed" }, { status: 400 });
      }
    }

    for (const row of issuePlan) {
      const nextIssued = Number(Number(row.item.issued_quantity || 0) + row.quantity);
      const reconciliation = calculateMaterialReconciliation({
        plannedQuantity: Number(row.item.planned_quantity ?? row.item.required_quantity ?? 0),
        issuedQuantity: nextIssued,
        packageSize: row.item.package_size ?? null,
        substitutionStatus: row.item.substitution_status || "none",
        plannedProductId: row.item.planned_product_id || row.item.product_id || null,
        actualProductId: row.item.actual_product_id || row.item.product_id || null,
      });
      const itemPatch = {
        issued_quantity: Number(nextIssued.toFixed(4)),
        issued_unit: row.item.unit || null,
        batch_id: row.batchId,
        expected_consumed_quantity: reconciliation.expectedConsumedQuantity,
        expected_return_quantity: reconciliation.expectedReturnQuantity,
        shortage_quantity: reconciliation.shortageQuantity,
        package_count: reconciliation.packageCount,
        reconciliation_status: "issued",
      };
      const { error: itemUpdateError } = await supabase
        .from("warehouse_issue_request_items")
        .update(itemPatch)
        .eq("id", row.item.id)
        .eq("company_id", companyId);

      if (itemUpdateError) {
        if (isV5WarehouseSchemaError(itemUpdateError)) {
          const { error: fallbackItemUpdateError } = await supabase
            .from("warehouse_issue_request_items")
            .update({
              issued_quantity: Number(nextIssued.toFixed(4)),
              batch_id: row.batchId,
            })
            .eq("id", row.item.id)
            .eq("company_id", companyId);
          if (fallbackItemUpdateError) {
            return NextResponse.json({ error: fallbackItemUpdateError.message || "Failed to update issued quantity" }, { status: 400 });
          }
        } else {
          return NextResponse.json({ error: itemUpdateError.message || "Failed to update issued quantity" }, { status: 400 });
        }
      }
    }

    const totalsResult = await supabase
      .from("warehouse_issue_request_items")
      .select("planned_quantity,required_quantity,prepared_quantity,issued_quantity")
      .eq("request_id", requestId)
      .eq("company_id", companyId);
    let totals: any[] | null = totalsResult.data as any[] | null;
    let totalsError = totalsResult.error;

    if (totalsError && isV5WarehouseSchemaError(totalsError)) {
      const fallbackTotals = await supabase
        .from("warehouse_issue_request_items")
        .select("planned_quantity,required_quantity,issued_quantity")
        .eq("request_id", requestId)
        .eq("company_id", companyId);
      totals = fallbackTotals.data;
      totalsError = fallbackTotals.error;
    }

    if (totalsError) {
      return NextResponse.json({ error: totalsError.message || "Failed to calculate issue totals" }, { status: 400 });
    }

    const totalRequired = (totals || []).reduce(
      (sum: number, item: any) => {
        const prepared = Number(item.prepared_quantity ?? 0);
        return sum + prepared;
      },
      0
    );
    const totalIssued = (totals || []).reduce(
      (sum: number, item: any) => sum + roundMaterialQuantity(Number(item.issued_quantity || 0)),
      0
    );
    const nextStatusRaw = totalRequired > 0 && totalIssued >= totalRequired - 0.000001
      ? "issued_by_warehouse"
      : "partially_issued";

    const baseRequestPatch = {
      status: nextStatusRaw,
      source_warehouse_id: sourceWarehouseId,
      issued_at: nowIso,
      issued_by_user_id: actor.id,
      updated_at: nowIso,
    };
    const v5RequestPatch = {
      ...baseRequestPatch,
      warehouse_request_status: "issued",
    };

    let requestUpdateResult = await supabase
      .from("warehouse_issue_requests")
      .update(v5RequestPatch)
      .eq("id", requestId)
      .eq("company_id", companyId)
      .select("id,status,issued_at")
      .single();

    if (requestUpdateResult.error && isV5WarehouseSchemaError(requestUpdateResult.error)) {
      requestUpdateResult = await supabase
        .from("warehouse_issue_requests")
        .update(baseRequestPatch)
        .eq("id", requestId)
        .eq("company_id", companyId)
        .select("id,status,issued_at")
        .single();
    }

    if (requestUpdateResult.error || !requestUpdateResult.data?.id) {
      return NextResponse.json(
        { error: requestUpdateResult.error?.message || "Failed to update request after issue" },
        { status: 400 }
      );
    }

    await syncOperationMaterialsFromRequest(supabase, {
      companyId,
      requestId,
      operationId: reqRow.operation_id || null,
      actorId: actorUserId,
    });

    return NextResponse.json({
      result: {
        success: true,
        request_id: requestId,
        status: nextStatusRaw,
        issued_at: nowIso,
        total_required: totalRequired,
        total_issued: totalIssued,
      },
      workflow_status: toWorkflowStatus(nextStatusRaw),
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
