import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

const ACCEPT_ALLOWED_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "specialist",
  "brigadier",
] as const;

function isV5SchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /operation_status|specialist_task_status|schema cache|column/i.test(message);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) {
      return NextResponse.json({ error: "operation id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...ACCEPT_ALLOWED_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,responsible_user_id,assigned_to,work_status,status,accepted_at")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (operationError || !operation?.id) {
      return NextResponse.json(
        { error: operationError?.message || "Operation not found" },
        { status: 404 }
      );
    }

    const isManager =
      actor.role === "global_admin" || actor.role === "company_admin" || actor.role === "agronomist";
    const assignedId = String(operation.responsible_user_id || operation.assigned_to || "").trim();
    if (!isManager && assignedId && assignedId !== actor.id) {
      return NextResponse.json({ error: "Operation is assigned to another specialist" }, { status: 403 });
    }

    if (operation.work_status === "completed" || operation.status === "completed") {
      return NextResponse.json({ error: "Completed operation cannot be accepted" }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const basePatch: Record<string, unknown> = {
      status: operation.status === "in_progress" ? "in_progress" : "accepted",
      accepted_at: operation.accepted_at || nowIso,
      updated_at: nowIso,
    };
    const patch: Record<string, unknown> = {
      ...basePatch,
      operation_status: operation.status === "in_progress" ? "in_progress" : "accepted",
      specialist_task_status: "accepted",
    };

    let updateResult = await supabase
      .from("operations")
      .update(patch)
      .eq("id", operationId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (updateResult.error && isV5SchemaError(updateResult.error)) {
      updateResult = await supabase
        .from("operations")
        .update(basePatch)
        .eq("id", operationId)
        .eq("company_id", companyId)
        .select("*")
        .single();
    }

    if (updateResult.error || !updateResult.data?.id) {
      return NextResponse.json({ error: updateResult.error?.message || "Failed to accept operation" }, { status: 400 });
    }

    const requestActivation = await supabase
      .from("warehouse_issue_requests")
      .update({ status: "active", warehouse_request_status: "pending", updated_at: nowIso })
      .eq("company_id", companyId)
      .eq("operation_id", operationId)
      .eq("status", "new");
    if (requestActivation.error && /warehouse_request_status|schema cache|column/i.test(requestActivation.error.message || "")) {
      await supabase
        .from("warehouse_issue_requests")
        .update({ status: "active", updated_at: nowIso })
        .eq("company_id", companyId)
        .eq("operation_id", operationId)
        .eq("status", "new");
    }

    return NextResponse.json({ operation: updateResult.data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
