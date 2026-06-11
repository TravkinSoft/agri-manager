import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
  toWorkflowStatus,
} from "@/app/api/material-requests/_helpers";

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

async function getProductBalance(
  supabase: any,
  params: {
    companyId: string;
    warehouseId: string;
    productId: string;
  }
): Promise<number> {
  const { data, error } = await supabase
    .from("v_stock_balance_identity")
    .select("quantity")
    .eq("company_id", params.companyId)
    .eq("warehouse_id", params.warehouseId)
    .eq("product_id", params.productId);

  if (error) {
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_warehouse_product_balance", {
      p_company_id: params.companyId,
      p_warehouse_id: params.warehouseId,
      p_product_id: params.productId,
    });
    if (rpcError) throw new Error(rpcError.message || error.message || "Failed to check stock balance");
    return toNumber(rpcData);
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
  }
): Promise<Array<{ quantity: number; batchId: string | null; batchClass: string | null }>> {
  let query = supabase
    .from("v_stock_balance_identity")
    .select("batch_id,batch_class,quantity,last_movement_at")
    .eq("company_id", params.companyId)
    .eq("warehouse_id", params.warehouseId)
    .eq("product_id", params.productId)
    .gt("quantity", 0)
    .order("last_movement_at", { ascending: true });

  if (params.batchId) {
    query = query.eq("batch_id", params.batchId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || "Failed to allocate stock identity");

  const allocations: Array<{ quantity: number; batchId: string | null; batchClass: string | null }> = [];
  let remaining = params.quantity;

  for (const row of data || []) {
    if (remaining <= 0.000001) break;
    const available = toNumber(row.quantity);
    if (available <= 0) continue;
    const qty = Math.min(available, remaining);
    allocations.push({
      quantity: Number(qty.toFixed(4)),
      batchId: row.batch_id ? String(row.batch_id) : null,
      batchClass: row.batch_class ? String(row.batch_class) : null,
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

  const { data: items, error } = await supabase
    .from("warehouse_issue_request_items")
    .select("product_id,product_category,planned_quantity,required_quantity,issued_quantity,unit")
    .eq("company_id", params.companyId)
    .eq("request_id", params.requestId);

  if (error) throw new Error(error.message || "Failed to read request items for operation material sync");

  const grouped = new Map<
    string,
    { productId: string; materialType: string; unit: string; planned: number; issued: number }
  >();

  for (const item of items || []) {
    const productId = String(item.product_id || "");
    if (!productId) continue;
    const current =
      grouped.get(productId) || {
        productId,
        materialType: String(item.product_category || "other"),
        unit: String(item.unit || "kg"),
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

    const { data: requestItems, error: itemsError } = await supabase
      .from("warehouse_issue_request_items")
      .select("id,product_id,planned_quantity,required_quantity,issued_quantity,batch_id,unit")
      .eq("request_id", requestId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    if (!requestItems?.length) {
      return NextResponse.json({ error: "Material request has no items to issue" }, { status: 400 });
    }

    const requestedByItemId = new Map(issueItems.map((item) => [item.item_id, item]));
    const issuePlan: Array<{ item: any; quantity: number; batchId: string | null }> = [];

    for (const item of requestItems) {
      const planned = Number(item.planned_quantity ?? item.required_quantity ?? 0);
      const alreadyIssued = Number(item.issued_quantity || 0);
      const remaining = Math.max(planned - alreadyIssued, 0);
      const requested = requestedByItemId.get(String(item.id));
      const quantity = requested ? Number(requested.issued_quantity || 0) : remaining;
      if (!Number.isFinite(quantity) || quantity < 0) {
        return NextResponse.json({ error: `Invalid issue quantity for item ${item.id}` }, { status: 400 });
      }
      if (quantity === 0) continue;
      if (quantity > remaining + 0.000001) {
        return NextResponse.json(
          { error: `Issued quantity exceeds planned remainder for item ${item.id}` },
          { status: 400 }
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
      const balance = await getProductBalance(supabase, {
        companyId,
        warehouseId: sourceWarehouseId,
        productId: row.item.product_id,
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
      });

      for (const allocation of allocations) {
        ledgerRows.push({
          company_id: companyId,
          product_id: row.item.product_id,
          warehouse_id: sourceWarehouseId,
          direction: "out",
          quantity: allocation.quantity,
          uom: row.item.unit || "kg",
          delta_qty_signed: -Math.abs(allocation.quantity),
          reason_type: "warehouse_issue",
          reason_ref_id: row.item.id,
          occurred_at: nowIso,
          created_by: actorUserId,
          notes: `Warehouse issue after specialist pickup. Request ${reqRow.request_number || requestId}, operation ${reqRow.operation_id || "-"}`,
          batch_id_text: allocation.batchId,
          batch_class: allocation.batchClass || "commodity",
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
      const { error: itemUpdateError } = await supabase
        .from("warehouse_issue_request_items")
        .update({
          issued_quantity: Number(nextIssued.toFixed(4)),
          batch_id: row.batchId,
        })
        .eq("id", row.item.id)
        .eq("company_id", companyId);

      if (itemUpdateError) {
        return NextResponse.json({ error: itemUpdateError.message || "Failed to update issued quantity" }, { status: 400 });
      }
    }

    const { data: totals, error: totalsError } = await supabase
      .from("warehouse_issue_request_items")
      .select("planned_quantity,required_quantity,issued_quantity")
      .eq("request_id", requestId)
      .eq("company_id", companyId);

    if (totalsError) {
      return NextResponse.json({ error: totalsError.message || "Failed to calculate issue totals" }, { status: 400 });
    }

    const totalRequired = (totals || []).reduce(
      (sum: number, item: any) => sum + Number(item.planned_quantity ?? item.required_quantity ?? 0),
      0
    );
    const totalIssued = (totals || []).reduce(
      (sum: number, item: any) => sum + Number(item.issued_quantity || 0),
      0
    );
    const nextStatusRaw = totalRequired > 0 && totalIssued >= totalRequired - 0.000001
      ? "issued_by_warehouse"
      : "partially_issued";

    const { data: updatedRequest, error: requestUpdateError } = await supabase
      .from("warehouse_issue_requests")
      .update({
        status: nextStatusRaw,
        source_warehouse_id: sourceWarehouseId,
        issued_at: nowIso,
        issued_by_user_id: actor.id,
        updated_at: nowIso,
      })
      .eq("id", requestId)
      .eq("company_id", companyId)
      .select("id,status,issued_at")
      .single();

    if (requestUpdateError || !updatedRequest?.id) {
      return NextResponse.json(
        { error: requestUpdateError?.message || "Failed to update request after issue" },
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
