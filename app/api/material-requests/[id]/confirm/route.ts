import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
  toWorkflowStatus,
} from "@/app/api/material-requests/_helpers";

function isV5WarehouseSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /warehouse_request_status|picked_up_at|received_quantity|received_unit|reconciliation_status|schema cache|column/i.test(message);
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
    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });

    const { data: reqRow, error: reqError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status,company_id,assigned_specialist_id,recipient_user_id,source_warehouse_id")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (reqError || !reqRow?.id) {
      return NextResponse.json({ error: reqError?.message || "Material request not found" }, { status: 404 });
    }

    const assignedSpecialistId = String(reqRow.assigned_specialist_id || reqRow.recipient_user_id || "").trim();
    const canBypassAssignee =
      actor.role === "global_admin" || actor.role === "company_admin" || actor.role === "agronomist";
    if (assignedSpecialistId && actor.id !== assignedSpecialistId && !canBypassAssignee) {
      return NextResponse.json({ error: "Only assigned specialist can accept these materials" }, { status: 403 });
    }

    if (String(reqRow.status || "") === "ready") {
      if (!reqRow.source_warehouse_id) {
        return NextResponse.json({ error: "Source warehouse is not set for request" }, { status: 400 });
      }

      const { data: items, error: itemsError } = await supabase
        .from("warehouse_issue_request_items")
        .select("id,prepared_quantity,unit")
        .eq("request_id", requestId)
        .eq("company_id", companyId);

      if (itemsError && !isV5WarehouseSchemaError(itemsError)) {
        return NextResponse.json({ error: itemsError.message || "Failed to load prepared materials" }, { status: 400 });
      }

      const preparedItems = (items || []).map((item: any) => ({
        ...item,
        preparedQuantity: Math.max(Number(item.prepared_quantity || 0), 0),
      }));
      if (!preparedItems.some((item: any) => item.preparedQuantity > 0.000001)) {
        return NextResponse.json(
          { error: "Warehouse has not prepared any available materials for this request" },
          { status: 409 }
        );
      }

      const nowIso = new Date().toISOString();
      const basePatch = {
        status: "received_confirmed",
        received_confirmed_at: nowIso,
        specialist_confirmed_at: nowIso,
        received_confirmed_by_user_id: actor.id,
        specialist_confirmed_by_user_id: actor.id,
        updated_at: nowIso,
      };
      const v5Patch = {
        ...basePatch,
        warehouse_request_status: "picked_up_by_specialist",
        picked_up_at: nowIso,
      };

      let updateResult = await supabase
        .from("warehouse_issue_requests")
        .update(v5Patch)
        .eq("id", requestId)
        .eq("company_id", companyId)
        .eq("status", "ready")
        .select("id,status,received_confirmed_at,specialist_confirmed_at")
        .single();

      if (updateResult.error && isV5WarehouseSchemaError(updateResult.error)) {
        updateResult = await supabase
          .from("warehouse_issue_requests")
          .update(basePatch)
          .eq("id", requestId)
          .eq("company_id", companyId)
          .eq("status", "ready")
          .select("id,status,received_confirmed_at,specialist_confirmed_at")
          .single();
      }

      if (updateResult.error || !updateResult.data?.id) {
        return NextResponse.json(
          { error: updateResult.error?.message || "Failed to accept prepared materials" },
          { status: 400 }
        );
      }

      if (preparedItems.length) {
        for (const item of preparedItems) {
          const receivedQuantity = item.preparedQuantity;
          const { error: itemUpdateError } = await supabase
            .from("warehouse_issue_request_items")
            .update({
              received_quantity: Number(receivedQuantity.toFixed(4)),
              received_unit: item.unit || null,
              reconciliation_status: "received",
            })
            .eq("id", item.id)
            .eq("company_id", companyId);

          if (itemUpdateError && !isV5WarehouseSchemaError(itemUpdateError)) {
            return NextResponse.json(
              { error: itemUpdateError.message || "Failed to save received quantities" },
              { status: 400 }
            );
          }
        }
      }

      return NextResponse.json({
        result: updateResult.data,
        workflow_status: toWorkflowStatus(updateResult.data.status),
      });
    }

    if (String(reqRow.status || "") === "received_confirmed") {
      return NextResponse.json({
        result: { success: true, already_confirmed: true, request_id: requestId, status: "received_confirmed" },
        workflow_status: toWorkflowStatus("received_confirmed"),
      });
    }

    if (!["issued_by_warehouse", "partially_issued"].includes(String(reqRow.status || ""))) {
      return NextResponse.json(
        { error: "Materials can be accepted only after warehouse marks the request ready" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Legacy warehouse confirmation is disabled. Prepare the request in the current workflow before specialist acceptance." },
      { status: 409 }
    );
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
