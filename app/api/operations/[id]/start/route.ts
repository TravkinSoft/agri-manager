import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

const START_ALLOWED_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "specialist",
  "brigadier",
] as const;

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
      allowedRoles: [...START_ALLOWED_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,responsible_user_id,work_status,status")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (operationError || !operation?.id) {
      return NextResponse.json(
        { error: operationError?.message || "Operation not found" },
        { status: 404 }
      );
    }

    const isAdmin =
      actor.role === "global_admin" || actor.role === "company_admin" || actor.role === "agronomist";
    const responsibleId = String(operation.responsible_user_id || "").trim();
    if (!isAdmin && responsibleId && responsibleId !== actor.id) {
      return NextResponse.json({ error: "Operation is assigned to another specialist" }, { status: 403 });
    }

    const { data: requests, error: reqError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status")
      .eq("company_id", companyId)
      .eq("operation_id", operationId);

    if (reqError) {
      return NextResponse.json({ error: reqError.message }, { status: 400 });
    }

    if ((requests || []).length > 0) {
      const hasConfirmedIssue = (requests || []).some((row: any) =>
        String(row.status || "") === "received_confirmed"
      );
      if (!hasConfirmedIssue) {
        return NextResponse.json(
          {
            error:
              "Operation cannot be started before specialist material confirmation (request must be received_confirmed).",
          },
          { status: 409 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("operations")
      .update({
        work_status: "in_progress",
        status: "in_progress",
        accepted_at: nowIso,
        started_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", operationId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (updateError || !updated?.id) {
      return NextResponse.json({ error: updateError?.message || "Failed to start operation" }, { status: 400 });
    }

    return NextResponse.json({ operation: updated });
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

