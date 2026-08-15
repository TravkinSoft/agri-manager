import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, requireWeighbridgeOperatorSession, resolveWeighbridgeSession, weighbridgeUnexpectedUserError, weighbridgeUserError } from "@/app/api/weighbridge/_auth";

async function loadHarvestClosureState(supabase: SupabaseClient, companyId: string, ticketId: string) {
  const [linesResult, weighingsResult] = await Promise.all([
    supabase
      .from("ticket_lines")
      .select("id,moisture_percent")
      .eq("company_id", companyId)
      .eq("ticket_id", ticketId)
      .limit(2),
    supabase
      .from("ticket_weighings")
      .select("weighing_no,measured_weight_kg")
      .eq("company_id", companyId)
      .eq("ticket_id", ticketId)
      .order("weighing_no", { ascending: true }),
  ]);
  if (linesResult.error) throw linesResult.error;
  if (weighingsResult.error) throw weighingsResult.error;
  return {
    lines: linesResult.data || [],
    weighings: weighingsResult.data || [],
  };
}

async function syncHarvestBatchMoisture(supabase: SupabaseClient, companyId: string, ticketId: string) {
  const { lines } = await loadHarvestClosureState(supabase, companyId, ticketId);
  if (lines.length !== 1) {
    throw new Error("Талон урожая должен содержать ровно одну строку.");
  }
  const rawMoisture = (lines[0] as any)?.moisture_percent;
  if (rawMoisture == null || String(rawMoisture).trim() === "") return;
  const moisture = Number(rawMoisture);
  if (!Number.isFinite(moisture) || moisture < 0 || moisture > 100) {
    throw new Error("Влажность рейса должна быть от 0 до 100 %.");
  }
  const { data: batches, error } = await supabase
    .from("inventory_batches")
    .update({ moisture_percent: moisture })
    .eq("company_id", companyId)
    .eq("source_ticket_id", ticketId)
    .select("id,moisture_percent");
  if (error) throw error;
  if ((batches || []).length === 0) {
    throw new Error("Партия урожая не найдена после закрытия талона.");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const timing = { authMs: 0, validationMs: 0, dbMs: 0, rpcMs: 0, totalMs: 0 };
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }

    const authStartedAt = Date.now();
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    timing.authMs = Date.now() - authStartedAt;
    const dbStartedAt = Date.now();
    const { data: ticketBefore, error: ticketBeforeError } = await supabase
      .from("tickets")
      .select("id, company_id, linked_request_id, warehouse_from_id, vehicle_id, op_type, weigh_method, is_finalized, status, net_weight_kg, correction_of_ticket_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (ticketBeforeError || !ticketBefore?.id) {
      return NextResponse.json({ error: ticketBeforeError?.message || "Ticket not found" }, { status: 404 });
    }
    const operatorSession = ticketBefore.weigh_method === "manual_override_with_reason"
      ? null
      : await requireWeighbridgeOperatorSession(request, { companyId, supabase });
    if (ticketBefore.is_finalized || ticketBefore.status === "finalized") {
      if (ticketBefore.op_type === "harvest_incoming") {
        await syncHarvestBatchMoisture(supabase, companyId, id);
      }
      timing.validationMs = Date.now() - dbStartedAt;
      timing.totalMs = Date.now() - startedAt;
      return NextResponse.json({ ticket: ticketBefore, idempotent_replay: true, debug: timing });
    }
    if (ticketBefore.op_type === "harvest_incoming") {
      const closureState = await loadHarvestClosureState(supabase, companyId, id);
      const weighingNumbers = closureState.weighings.map((row: any) => Number(row.weighing_no));
      if (
        closureState.lines.length !== 1 ||
        weighingNumbers.length !== 2 ||
        weighingNumbers[0] !== 1 ||
        weighingNumbers[1] !== 2
      ) {
        return NextResponse.json({ error: "Перед закрытием нужны два фактических взвешивания: брутто и тара." }, { status: 409 });
      }
    }
    timing.validationMs = Date.now() - dbStartedAt;

    const rpcStartedAt = Date.now();
    const finalizeRpc = ticketBefore.correction_of_ticket_id
      ? "finalize_weighbridge_ticket_correction_v1"
      : ticketBefore.op_type === "weighbridge_impurities"
        ? "finalize_weighbridge_impurity_ticket_for_session_v1"
        : "finalize_weighbridge_ticket_for_session_v1";
    const finalizeArgs = ticketBefore.correction_of_ticket_id
      ? {
          p_ticket_id: id,
          p_operator_person_id: operatorSession?.operator.id || null,
          p_shift_id: operatorSession?.shift.id || null,
        }
      : { p_ticket_id: id };
    const { error: finalizeError } = await supabase.rpc(finalizeRpc, finalizeArgs);
    timing.rpcMs = Date.now() - rpcStartedAt;

    if (finalizeError) {
      return NextResponse.json({ error: weighbridgeUserError(finalizeError.message) }, { status: 400 });
    }
    if (operatorSession?.operator.id) {
      const { error: attributionError } = await supabase
        .from("tickets")
        .update({ finalized_by_person_id: operatorSession.operator.id })
        .eq("id", id)
        .eq("company_id", companyId);
      if (attributionError) {
        return NextResponse.json({ error: attributionError.message }, { status: 400 });
      }
    }
    if (ticketBefore.op_type === "harvest_incoming") {
      try {
        await syncHarvestBatchMoisture(supabase, companyId, id);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Не удалось перенести влажность в партию урожая." },
          { status: 409 }
        );
      }
    }

    const { data: lineLinks, error: lineLinksError } = await supabase
      .from("ticket_lines")
      .select("id,operation_line_id,operation_lines:operation_line_id(operation_id)")
      .eq("ticket_id", id)
      .eq("company_id", companyId)
      .not("operation_line_id", "is", null);
    if (lineLinksError) {
      return NextResponse.json({ error: lineLinksError.message || "Operation linkage load failed" }, { status: 400 });
    }

    for (const row of lineLinks || []) {
      const operationLineRel = Array.isArray((row as any).operation_lines)
        ? (row as any).operation_lines[0]
        : (row as any).operation_lines;
      const operationId = String(operationLineRel?.operation_id || "").trim();
      if (!operationId) continue;
      const { error: fmcBackfillError } = await supabase
        .from("field_material_consumptions")
        .update({ operation_id: operationId, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("ticket_id", id)
        .eq("ticket_line_id", String((row as any).id || ""))
        .is("operation_id", null);
      if (fmcBackfillError) {
        return NextResponse.json({ error: fmcBackfillError.message || "Operation id backfill failed" }, { status: 400 });
      }
    }

    const dbAfterRpcStartedAt = Date.now();
    const { data: updated } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (ticketBefore.vehicle_id) {
      const { data: stillActive } = await supabase
        .from("tickets")
        .select("id")
        .eq("company_id", ticketBefore.company_id)
        .eq("vehicle_id", ticketBefore.vehicle_id)
        .in("status", ["draft", "active", "ready_to_close"])
        .neq("id", id)
        .limit(1);

      if ((stillActive || []).length === 0) {
        await supabase
          .from("reference_vehicles")
          .update({ status: "free" })
          .eq("id", ticketBefore.vehicle_id)
          .eq("company_id", ticketBefore.company_id);
      }
    }

    if (ticketBefore.linked_request_id) {
      const { data: requestItems } = await supabase
        .from("warehouse_issue_request_items")
        .select("id, planned_quantity, required_quantity")
        .eq("request_id", ticketBefore.linked_request_id);

      await supabase
        .from("warehouse_issue_requests")
        .update({
          status: "issued_by_warehouse",
          issued_at: new Date().toISOString(),
          issued_by_user_id: actor.id,
          source_warehouse_id: ticketBefore.warehouse_from_id || null,
        })
        .eq("id", ticketBefore.linked_request_id);

      await supabase
        .from("warehouse_issue_request_items")
        .upsert(
          (requestItems || []).map((item: any) => ({
            id: item.id,
            issued_quantity: Number(item.planned_quantity || item.required_quantity || 0),
          })),
          { onConflict: "id" }
        );
    }

    timing.dbMs = timing.validationMs + (Date.now() - dbAfterRpcStartedAt);
    timing.totalMs = Date.now() - startedAt;
    return NextResponse.json({ ticket: updated, debug: timing });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: weighbridgeUnexpectedUserError() },
      { status: 500 }
    );
  }
}
