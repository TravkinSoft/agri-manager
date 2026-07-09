import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import {
  SeasonGuardError,
  assertSeasonWritableForMutation,
  resolveOperationSeasonIdForGuard,
} from "@/lib/seasons/season-guard";
import { calculateMaterialReconciliation } from "@/lib/materials/reconciliation";

const PROGRESS_ALLOWED_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "specialist",
  "brigadier",
] as const;

const SCHEMA_FALLBACK_RE = /operation_progress|operation_status|specialist_task_status|planned_area_ha|completed_area_ha|remaining_area_ha|progress_percent|last_progress_at|last_stop_reason|expected_consumed_quantity|shortage_quantity|reconciliation_status|schema cache|does not exist|column/i;

function toNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function isSchemaFallbackError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return SCHEMA_FALLBACK_RE.test(message);
}

async function readPersistedProgressTotal(
  supabase: any,
  params: { companyId: string; operationId: string }
): Promise<{ total: number; available: boolean }> {
  const { data, error } = await supabase
    .from("operation_progress")
    .select("completed_area_ha")
    .eq("company_id", params.companyId)
    .eq("operation_id", params.operationId);

  if (error) {
    if (isSchemaFallbackError(error)) return { total: 0, available: false };
    throw new Error(error.message || "Failed to read operation progress");
  }

  const total = (data || []).reduce((sum: number, row: any) => sum + Number(row.completed_area_ha || 0), 0);
  return { total, available: true };
}

async function updateOperationExecutionState(
  supabase: any,
  params: {
    companyId: string;
    operationId: string;
    plannedArea: number;
    completedArea: number;
    remainingArea: number;
    progressPercent: number;
    statusAfterReport: "in_progress" | "paused" | "ready_to_close";
    stopReason: string | null;
    nowIso: string;
  }
) {
  const basePatch = {
    work_status: "in_progress",
    status: "in_progress",
    updated_at: params.nowIso,
  };

  const v5Patch = {
    ...basePatch,
    operation_status: params.statusAfterReport,
    specialist_task_status: params.statusAfterReport,
    planned_area_ha: round4(params.plannedArea),
    completed_area_ha: round4(params.completedArea),
    remaining_area_ha: round4(params.remainingArea),
    progress_percent: round2(params.progressPercent),
    last_progress_at: params.nowIso,
    last_stop_reason: params.stopReason,
  };

  const { error } = await supabase
    .from("operations")
    .update(v5Patch)
    .eq("id", params.operationId)
    .eq("company_id", params.companyId);

  if (!error) return true;
  if (!isSchemaFallbackError(error)) throw new Error(error.message || "Failed to update operation progress");

  const { error: fallbackError } = await supabase
    .from("operations")
    .update(basePatch)
    .eq("id", params.operationId)
    .eq("company_id", params.companyId);

  if (fallbackError) throw new Error(fallbackError.message || "Failed to update operation state");
  return false;
}

async function updateOperationLinesActual(
  supabase: any,
  params: {
    companyId: string;
    operationId: string;
    completedArea: number;
    actorId: string;
    nowIso: string;
  }
) {
  const { data: lines, error } = await supabase
    .from("operation_lines")
    .select("id,planned_area_ha")
    .eq("company_id", params.companyId)
    .eq("operation_id", params.operationId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message || "Failed to read operation lines");
  if (!lines?.length) return;

  let remainingCompleted = params.completedArea;
  for (const line of lines as any[]) {
    const planned = Number(line.planned_area_ha || 0);
    const actual = planned > 0 ? Math.min(planned, Math.max(remainingCompleted, 0)) : Math.max(remainingCompleted, 0);
    remainingCompleted = Math.max(remainingCompleted - actual, 0);

    const { error: updateError } = await supabase
      .from("operation_lines")
      .update({
        actual_area_ha: round4(actual),
        completed_by: params.actorId,
        completed_at: actual > 0 ? params.nowIso : null,
        updated_by_user_id: params.actorId,
      })
      .eq("id", line.id)
      .eq("company_id", params.companyId);

    if (updateError) throw new Error(updateError.message || "Failed to update operation line progress");
  }
}

async function updateLinkedMaterialExpectations(
  supabase: any,
  params: {
    companyId: string;
    operationId: string;
    plannedArea: number;
    completedArea: number;
  }
) {
  const { data: requests, error: requestsError } = await supabase
    .from("warehouse_issue_requests")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("operation_id", params.operationId);

  if (requestsError) {
    if (isSchemaFallbackError(requestsError)) return false;
    throw new Error(requestsError.message || "Failed to read linked material requests");
  }

  const requestIds = (requests || []).map((row: any) => String(row.id)).filter(Boolean);
  if (requestIds.length === 0) return true;

  const { data: items, error: itemsError } = await supabase
    .from("warehouse_issue_request_items")
    .select("id,planned_quantity,required_quantity,issued_quantity,expected_return_quantity,return_received_quantity,loss_quantity,returned_quantity,consumed_quantity,package_size,substitution_status,planned_product_id,actual_product_id")
    .eq("company_id", params.companyId)
    .in("request_id", requestIds);

  if (itemsError) {
    if (isSchemaFallbackError(itemsError)) return false;
    throw new Error(itemsError.message || "Failed to read request items");
  }

  for (const item of items || []) {
    const reconciliation = calculateMaterialReconciliation({
      plannedQuantity: Number(item.planned_quantity ?? item.required_quantity ?? 0),
      plannedAreaHa: params.plannedArea,
      actualCompletedAreaHa: params.completedArea,
      issuedQuantity: Number(item.issued_quantity || 0),
      consumedQuantity: item.consumed_quantity,
      returnedQuantity: item.returned_quantity,
      returnReceivedQuantity: item.return_received_quantity,
      lossQuantity: item.loss_quantity,
      packageSize: item.package_size,
      substitutionStatus: item.substitution_status,
      plannedProductId: item.planned_product_id,
      actualProductId: item.actual_product_id,
    });

    const { error: itemUpdateError } = await supabase
      .from("warehouse_issue_request_items")
      .update({
        expected_consumed_quantity: reconciliation.expectedConsumedQuantity,
        expected_return_quantity: reconciliation.expectedReturnQuantity,
        shortage_quantity: reconciliation.shortageQuantity,
        reconciliation_status: reconciliation.reconciliationStatus,
      })
      .eq("id", item.id)
      .eq("company_id", params.companyId);

    if (itemUpdateError) {
      if (isSchemaFallbackError(itemUpdateError)) return false;
      throw new Error(itemUpdateError.message || "Failed to update material expectation");
    }
  }

  return true;
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
    const shiftArea = toNonNegativeNumber(body.completedAreaHa ?? body.completed_area_ha);
    const allowOverrun = Boolean(body.allowOverrun);
    const stopReason = String(body.stopReason || body.stop_reason || "").trim() || null;
    const comment = String(body.comment || "").trim() || null;
    const weatherNote = String(body.weatherNote || body.weather_note || "").trim() || null;

    if (shiftArea == null || shiftArea <= 0) {
      return NextResponse.json({ error: "Completed area must be greater than zero" }, { status: 400 });
    }

    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...PROGRESS_ALLOWED_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,responsible_user_id,assigned_to,work_status,status,crop_structure_id")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (operationError || !operation?.id) {
      return NextResponse.json({ error: operationError?.message || "Operation not found" }, { status: 404 });
    }

    const isManager =
      actor.role === "global_admin" || actor.role === "company_admin" || actor.role === "agronomist";
    const assignedId = String(operation.responsible_user_id || operation.assigned_to || "").trim();
    if (!isManager && assignedId && assignedId !== actor.id) {
      return NextResponse.json({ error: "Operation is assigned to another specialist" }, { status: 403 });
    }
    if (operation.work_status === "completed" || operation.status === "completed") {
      return NextResponse.json({ error: "Completed operation cannot receive progress reports" }, { status: 409 });
    }

    const guardedSeasonId = await resolveOperationSeasonIdForGuard(supabase, {
      companyId,
      cropStructureId: (operation as any).crop_structure_id,
    });
    await assertSeasonWritableForMutation(supabase, {
      companyId,
      seasonId: guardedSeasonId,
      actionLabel: "Operation progress",
    });

    const { data: lines, error: linesError } = await supabase
      .from("operation_lines")
      .select("planned_area_ha,actual_area_ha")
      .eq("operation_id", operationId)
      .eq("company_id", companyId);

    if (linesError) {
      return NextResponse.json({ error: linesError.message || "Failed to read operation lines" }, { status: 400 });
    }

    const plannedArea = (lines || []).reduce((sum: number, line: any) => sum + Number(line.planned_area_ha || 0), 0);
    if (plannedArea <= 0) {
      return NextResponse.json({ error: "Operation planned area is required before progress reporting" }, { status: 400 });
    }

    const persistedProgress = await readPersistedProgressTotal(supabase, { companyId, operationId });
    const lineActualTotal = (lines || []).reduce((sum: number, line: any) => sum + Number(line.actual_area_ha || 0), 0);
    const previousCompleted = persistedProgress.available ? persistedProgress.total : lineActualTotal;
    const nextCompleted = previousCompleted + shiftArea;

    if (!allowOverrun && nextCompleted > plannedArea + 0.000001) {
      return NextResponse.json(
        {
          error: "Completed area exceeds planned area",
          planned_area_ha: round4(plannedArea),
          completed_area_ha: round4(previousCompleted),
          attempted_total_area_ha: round4(nextCompleted),
        },
        { status: 409 }
      );
    }

    const clampedCompleted = allowOverrun ? nextCompleted : Math.min(nextCompleted, plannedArea);
    const remainingArea = Math.max(plannedArea - clampedCompleted, 0);
    const progressPercent = plannedArea > 0 ? (clampedCompleted / plannedArea) * 100 : 0;
    const statusAfterReport =
      remainingArea <= 0.000001 ? "ready_to_close" : stopReason ? "paused" : "in_progress";
    const nowIso = new Date().toISOString();

    let progressPersisted = false;
    if (persistedProgress.available) {
      const { error: progressError } = await supabase.from("operation_progress").insert({
        operation_id: operationId,
        company_id: companyId,
        reported_by: actor.id,
        reported_at: nowIso,
        completed_area_ha: round4(shiftArea),
        remaining_area_ha: round4(remainingArea),
        progress_percent: round2(progressPercent),
        status_after_report: statusAfterReport,
        stop_reason: stopReason,
        comment,
        weather_note: weatherNote,
      });
      if (progressError) throw new Error(progressError.message || "Failed to save progress report");
      progressPersisted = true;
    }

    await updateOperationLinesActual(supabase, {
      companyId,
      operationId,
      completedArea: clampedCompleted,
      actorId: actor.id,
      nowIso,
    });

    const materialExpectationsPersisted = await updateLinkedMaterialExpectations(supabase, {
      companyId,
      operationId,
      plannedArea,
      completedArea: clampedCompleted,
    });

    const v5StatePersisted = await updateOperationExecutionState(supabase, {
      companyId,
      operationId,
      plannedArea,
      completedArea: clampedCompleted,
      remainingArea,
      progressPercent,
      statusAfterReport,
      stopReason,
      nowIso,
    });

    return NextResponse.json({
      progress: {
        operation_id: operationId,
        shift_completed_area_ha: round4(shiftArea),
        planned_area_ha: round4(plannedArea),
        completed_area_ha: round4(clampedCompleted),
        remaining_area_ha: round4(remainingArea),
        progress_percent: round2(progressPercent),
        status_after_report: statusAfterReport,
        progress_persisted: progressPersisted,
        v5_state_persisted: v5StatePersisted,
        material_expectations_persisted: materialExpectationsPersisted,
      },
    });
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
