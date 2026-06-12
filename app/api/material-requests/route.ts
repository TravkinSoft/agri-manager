import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_READ_ROLES,
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
  toWorkflowStatus,
} from "@/app/api/material-requests/_helpers";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function workflowToRawStatuses(status: string): string[] {
  switch (status) {
    case "active":
      return ["active", "new"];
    case "preparing":
      return ["preparing"];
    case "ready":
      return ["ready"];
    case "issued":
      return ["issued_by_warehouse", "issued", "received_confirmed"];
    case "partially_issued":
      return ["partially_issued"];
    case "cancelled":
      return ["cancelled"];
    default:
      return [];
  }
}

function isV5WarehouseSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /warehouse_request_status|collecting_at|schema cache|column/i.test(message);
}

export async function GET(request: NextRequest) {
  try {
    const statusFilter = String(request.nextUrl.searchParams.get("status") || "").trim();
    const onlyMine = String(request.nextUrl.searchParams.get("mine") || "false").toLowerCase() === "true";

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_READ_ROLES,
    });

    let query = supabase
      .from("warehouse_issue_requests")
      .select(`
        *,
        fields:field_id(name),
        operations:operation_id(operation_type, date, work_status, status, notes),
        source_warehouse:source_warehouse_id(name, name_ru, name_kz, name_en),
        assigned_specialist:assigned_specialist_id(id, full_name, email),
        recipient:recipient_user_id(id, full_name, email),
        crops:crop_id(name,name_ru,name_kz,name_en,slug),
        varieties:variety_id(name),
        reproductions:reproduction_id(name,name_ru,name_kz,name_en,code),
        items:warehouse_issue_request_items(
          id,
          request_id,
          company_id,
          product_id,
          product_category,
          required_quantity,
          planned_quantity,
          issued_quantity,
          consumed_quantity,
          returned_quantity,
          unit,
          planned_rate_per_ha,
          actual_rate_per_ha,
          batch_id,
          created_at,
          products:product_id(name, trade_name, normalized_name, type, unit)
        )
      `)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (statusFilter) {
      const rawStatuses = workflowToRawStatuses(statusFilter);
      if (rawStatuses.length > 0) {
        query = query.in("status", rawStatuses);
      }
    }

    if (onlyMine && (actor.role === "specialist" || actor.role === "brigadier")) {
      query = query.or(`assigned_specialist_id.eq.${actor.id},recipient_user_id.eq.${actor.id}`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rows = (data || []).filter((row: any) => {
      const operation = row.operations || {};
      const qaText = [
        row.request_number,
        row.comment,
        operation.operation_type,
        operation.notes,
        row.fields?.name,
        row.source_warehouse?.name,
        row.source_warehouse?.name_ru,
      ].join(" ");
      return !hasQaDataMarker(qaText);
    }).map((row: any) => {
      const items = (row.items || []).map((item: any) => {
        const plannedQty = toNumber(item.planned_quantity ?? item.required_quantity);
        const issuedQty = toNumber(item.issued_quantity);
        const consumedQty = item.consumed_quantity == null ? null : toNumber(item.consumed_quantity);
        const returnedQty = item.returned_quantity == null ? null : toNumber(item.returned_quantity);
        return {
          ...item,
          planned_quantity: plannedQty,
          issued_quantity: issuedQty,
          consumed_quantity: consumedQty,
          returned_quantity: returnedQty,
          product_name: brandName(item.products) || "-",
          product_type: item.products?.type || item.product_category || "-",
          product_unit: item.products?.unit || item.unit || "kg",
        };
      });

      const totalPlanned = items.reduce((sum: number, item: any) => sum + toNumber(item.planned_quantity), 0);
      const totalIssued = items.reduce((sum: number, item: any) => sum + toNumber(item.issued_quantity), 0);

      return {
        ...row,
        workflow_status: toWorkflowStatus(row.status),
        field_name: row.fields?.name || "-",
        operation_type: row.operations?.operation_type || "-",
        operation_date: row.operations?.date || null,
        operation_work_status: row.operations?.work_status || row.operations?.status || null,
        crop_name: localizedName(row.crops, "ru") || null,
        variety_name: brandName(row.varieties) || null,
        reproduction_name: localizedName(row.reproductions, "ru", ["name", "code"]) || null,
        assigned_specialist_name: row.assigned_specialist?.full_name || row.assigned_specialist?.email || null,
        recipient_name: row.recipient?.full_name || row.recipient?.email || null,
        source_warehouse_name:
          row.source_warehouse?.name_ru ||
          row.source_warehouse?.name_kz ||
          row.source_warehouse?.name_en ||
          row.source_warehouse?.name ||
          null,
        total_planned_quantity: totalPlanned,
        total_issued_quantity: totalIssued,
        fully_issued: totalPlanned > 0 && totalIssued >= totalPlanned,
        items,
      };
    });

    return NextResponse.json({ requests: rows });
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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    const action = String(body.action || "").trim();
    const sourceWarehouseId = String(body.sourceWarehouseId || "").trim() || null;

    if (!requestId) {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }
    if (!["preparing", "ready", "cancel"].includes(action)) {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });

    const { data: existing, error: existingError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Material request not found" },
        { status: 404 }
      );
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updated_at: nowIso,
    };

    if (action === "preparing") {
      patch.status = "preparing";
      patch.warehouse_request_status = "collecting";
      patch.collecting_at = nowIso;
      patch.prepared_at = nowIso;
      if (sourceWarehouseId) patch.source_warehouse_id = sourceWarehouseId;
    }
    if (action === "ready") {
      patch.status = "ready";
      patch.warehouse_request_status = "ready_for_pickup";
      patch.ready_at = nowIso;
      if (sourceWarehouseId) patch.source_warehouse_id = sourceWarehouseId;
    }
    if (action === "cancel") {
      patch.status = "cancelled";
      patch.warehouse_request_status = "cancelled";
      patch.cancelled_at = nowIso;
    }

    let updateResult = await supabase
      .from("warehouse_issue_requests")
      .update(patch)
      .eq("id", requestId)
      .eq("company_id", companyId)
      .select("id,status,source_warehouse_id,ready_at,prepared_at,cancelled_at,updated_at")
      .single();

    if (updateResult.error && isV5WarehouseSchemaError(updateResult.error)) {
      const fallbackPatch = { ...patch };
      delete fallbackPatch.warehouse_request_status;
      delete fallbackPatch.collecting_at;
      updateResult = await supabase
        .from("warehouse_issue_requests")
        .update(fallbackPatch)
        .eq("id", requestId)
        .eq("company_id", companyId)
        .select("id,status,source_warehouse_id,ready_at,prepared_at,cancelled_at,updated_at")
        .single();
    }

    if (updateResult.error || !updateResult.data?.id) {
      return NextResponse.json({ error: updateResult.error?.message || "Failed to update request status" }, { status: 400 });
    }

    return NextResponse.json({
      request: {
        ...updateResult.data,
        workflow_status: toWorkflowStatus(updateResult.data.status),
        actor_id: actor.id,
      },
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
