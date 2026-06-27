import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import {
  SeasonGuardError,
  assertSeasonWritableForMutation,
  resolveOperationSeasonIdForGuard,
} from "@/lib/seasons/season-guard";

const START_ALLOWED_ROLES = [
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
      allowedRoles: [...START_ALLOWED_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,responsible_user_id,work_status,status,accepted_at,crop_structure_id")
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

    const guardedSeasonId = await resolveOperationSeasonIdForGuard(supabase, {
      companyId,
      cropStructureId: (operation as any).crop_structure_id,
    });
    await assertSeasonWritableForMutation(supabase, {
      companyId,
      seasonId: guardedSeasonId,
      actionLabel: "Operation start",
    });

    const { data: requests, error: reqError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status,issued_at")
      .eq("company_id", companyId)
      .eq("operation_id", operationId);

    if (reqError) {
      return NextResponse.json({ error: reqError.message }, { status: 400 });
    }

    const activeMaterialRequests = (requests || []).filter(
      (row: any) => !["cancelled"].includes(String(row.status || ""))
    );

    if (activeMaterialRequests.length > 0) {
      const everyRequestIssued = activeMaterialRequests.every((row: any) => {
        const status = String(row.status || "");
        if (status === "issued" || status === "issued_by_warehouse") return true;
        return status === "received_confirmed" && Boolean(row.issued_at);
      });
      if (!everyRequestIssued) {
        return NextResponse.json(
          {
            error:
              "Operation cannot be started before warehouse issue is completed.",
          },
          { status: 409 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const basePatch = {
      work_status: "in_progress",
      status: "in_progress",
      accepted_at: operation.accepted_at || nowIso,
      started_at: nowIso,
      updated_at: nowIso,
    };
    const v5Patch = {
      ...basePatch,
      operation_status: "in_progress",
      specialist_task_status: "in_progress",
    };

    let updateResult = await supabase
      .from("operations")
      .update(v5Patch)
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
      return NextResponse.json({ error: updateResult.error?.message || "Failed to start operation" }, { status: 400 });
    }

    return NextResponse.json({ operation: updateResult.data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SeasonGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
