import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
  toWorkflowStatus,
} from "@/app/api/material-requests/_helpers";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";

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
      const idempotency = requireOperationIdempotency(request, { ...body, requestId, action: "confirm_receipt" });
      const { data, error } = await supabase.rpc("confirm_material_request_receipt_atomic_v1", {
        p_company_id: companyId,
        p_actor_profile_id: actor.id,
        p_request_id: requestId,
        p_idempotency_key: idempotency.key,
        p_request_fingerprint: idempotency.fingerprint,
      });
      if (error || !data) {
        const failure = operationMutationError(error, "Prepared materials were not accepted");
        return NextResponse.json({ error: failure.message }, { status: failure.status });
      }
      return NextResponse.json(data);
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
    if (error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
