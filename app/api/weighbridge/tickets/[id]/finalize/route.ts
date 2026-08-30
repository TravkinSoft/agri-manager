import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEIGHBRIDGE_OPERATOR_COOKIE, WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, recordWeighbridgeOperatorActivity, requireWeighbridgeOperatorSession, resolveWeighbridgeSession, weighbridgeUnexpectedUserError, weighbridgeUserError } from "@/app/api/weighbridge/_auth";
import { enrichTicketOperatorAttribution } from "@/lib/server/weighbridge-ticket-attribution";
import { getServiceClient } from "@/lib/supabase/service";

const CORRECTION_LOT_ERROR = "Не удалось завершить исправление талона. Связь партии не прошла проверку. Исходный талон не изменён.";

function correctionLotErrorResponse(message: string) {
  const traceId = randomUUID();
  console.error("weighbridge_correction_lot_validation_failed", { traceId, message });
  return NextResponse.json(
    { error: CORRECTION_LOT_ERROR, code: "correction_lot_validation_failed", trace_id: traceId },
    { status: 409 }
  );
}

function isCorrectionLotError(message: string) {
  return /aggregate (harvest )?lot|batch identity|batch lineage|physical batch|line identity|warehouse-local batch|company stock/i.test(message);
}

function transferStockErrorResponse(message: string) {
  const traceId = randomUUID();
  const insufficient = message.match(/WEIGHBRIDGE_STOCK_INSUFFICIENT\|([^|]+)\|([^|\s]+)/i);
  if (insufficient) {
    const available = Number(insufficient[1]);
    const required = Number(insufficient[2]);
    return NextResponse.json({
      error: `Недостаточно доступного остатка. Доступно ${available.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг, требуется ${required.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг.`,
      code: "stock_insufficient",
      trace_id: traceId,
      available_kg: available,
      required_kg: required,
    }, { status: 409 });
  }
  if (/WEIGHBRIDGE_STOCK_INTERNAL_NEGATIVE/i.test(message)) {
    console.error("weighbridge_stock_accounting_mismatch", { traceId });
    return NextResponse.json({
      error: "Обнаружено расхождение складского учёта. Операция полностью отменена. Сообщите администратору номер ошибки.",
      code: "stock_accounting_mismatch",
      trace_id: traceId,
    }, { status: 409 });
  }
  return null;
}

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

async function syncHarvestBatchMoisture(
  supabase: SupabaseClient,
  companyId: string,
  ticketId: string,
  knownLines?: Array<{ id: string; moisture_percent: number | null }>
) {
  const lines = knownLines || (await loadHarvestClosureState(supabase, companyId, ticketId)).lines;
  if (lines.length !== 1) {
    throw new Error("Талон урожая должен содержать ровно одну строку.");
  }
  const rawMoisture = (lines[0] as any)?.moisture_percent;
  if (rawMoisture == null || String(rawMoisture).trim() === "") return;
  const moisture = Number(rawMoisture);
  if (!Number.isFinite(moisture) || moisture <= 0 || moisture >= 100) {
    throw new Error("Влажность рейса должна быть больше 0 и меньше 100 %.");
  }
  // The actor/ticket/company contract is verified by the caller with the
  // session-scoped client. inventory_batches is a server-only write surface.
  const mutationClient = getServiceClient();
  const { data: batches, error } = await mutationClient
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
      .select("id, company_id, linked_request_id, linked_processing_id, processing_output_role, warehouse_from_id, warehouse_to_id, vehicle_id, op_type, direction, weigh_method, is_finalized, status, net_weight_kg, physical_net_kg, explicit_deductions_kg, accepted_weight_kg, correction_of_ticket_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (ticketBeforeError || !ticketBefore?.id) {
      return NextResponse.json({ error: ticketBeforeError?.message || "Ticket not found" }, { status: 404 });
    }
    const operatorSession = ticketBefore.weigh_method === "manual_override_with_reason"
      ? null
      : await requireWeighbridgeOperatorSession(request, { companyId, supabase });

    if (ticketBefore.op_type === "harvest_incoming") {
      const tare = Number(body?.tare_weight_kg);
      const moisture = body?.moisture_percent == null || String(body.moisture_percent).trim() === ""
        ? null
        : Number(body.moisture_percent);
      const deductionKg = body?.deduction_kg == null || String(body.deduction_kg).trim() === ""
        ? null
        : Number(body.deduction_kg);
      const deductionPercent = body?.deduction_percent == null || String(body.deduction_percent).trim() === ""
        ? null
        : Number(body.deduction_percent);
      if (!Number.isFinite(tare) || tare < 0) {
        return NextResponse.json({ error: "Тара должна быть неотрицательным числом." }, { status: 400 });
      }
      if (moisture != null && (!Number.isFinite(moisture) || moisture <= 0 || moisture >= 100)) {
        return NextResponse.json({ error: "Влажность должна быть больше 0 и меньше 100 %." }, { status: 400 });
      }
      if (deductionKg != null && (!Number.isFinite(deductionKg) || deductionKg < 0)) {
        return NextResponse.json({ error: "Удержание в килограммах должно быть неотрицательным." }, { status: 400 });
      }
      if (deductionPercent != null && (!Number.isFinite(deductionPercent) || deductionPercent < 0 || deductionPercent >= 100)) {
        return NextResponse.json({ error: "Удержание должно быть от 0 до менее 100 %." }, { status: 400 });
      }
      if (deductionKg != null && deductionPercent != null) {
        return NextResponse.json({ error: "Укажите удержание либо в килограммах, либо в процентах." }, { status: 400 });
      }
      const sessionToken = request.cookies.get(WEIGHBRIDGE_OPERATOR_COOKIE)?.value || "";
      const rpcStartedAt = Date.now();
      const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
        "close_harvest_ticket_atomic",
        {
          p_ticket_id: id,
          p_session_token: sessionToken,
          p_tare_weight_kg: tare,
          p_moisture_percent: moisture,
          p_deduction_kg: deductionKg,
          p_deduction_percent: deductionPercent,
          p_deduction_reason: String(body?.deduction_reason || "").trim() || null,
          p_tare_variance_confirmed: Boolean(body?.confirm_tare_variance),
          p_idempotency_key: String(request.headers.get("idempotency-key") || body?.idempotency_key || "").trim() || null,
        }
      );
      timing.rpcMs = Date.now() - rpcStartedAt;
      if (finalizeError) {
        return NextResponse.json({ error: weighbridgeUserError(finalizeError.message) }, { status: 400 });
      }
      const result = (finalizeResult || {}) as Record<string, any>;
      if (result.code === "shift_expired") {
        return NextResponse.json({ error: "Введите PIN весовщика, чтобы продолжить смену.", code: result.code }, { status: 423 });
      }
      if (result.requires_confirmation) {
        return NextResponse.json({ error: "Проверьте тару.", ...result }, { status: 409 });
      }
      if (!result.ok) {
        return NextResponse.json({ error: "Не удалось завершить талон." }, { status: 409 });
      }

      const { data: updated, error: updatedError } = await supabase
        .from("tickets")
        .select("*, lines:ticket_lines(*)")
        .eq("id", id)
        .eq("company_id", companyId)
        .single();
      if (updatedError || !updated?.id) {
        return NextResponse.json({ error: updatedError?.message || "Final ticket load failed" }, { status: 400 });
      }
      timing.totalMs = Date.now() - startedAt;
      const [attributedTicket] = await enrichTicketOperatorAttribution(supabase, companyId, [updated]);
      const response = NextResponse.json({ ticket: attributedTicket, finalize: result, debug: timing });
      response.headers.set(
        "Server-Timing",
        `auth;dur=${timing.authMs}, validation;dur=${timing.validationMs}, finalize_rpc;dur=${timing.rpcMs}, total;dur=${timing.totalMs}`
      );
      return response;
    }

    const isAtomicTransfer = ticketBefore.direction === "transfer"
      && ticketBefore.weigh_method !== "manual_override_with_reason"
      && !ticketBefore.correction_of_ticket_id;
    if (isAtomicTransfer) {
      const tare = Number(body?.tare_weight_kg);
      const moisture = body?.moisture_percent == null || String(body.moisture_percent).trim() === ""
        ? null
        : Number(body.moisture_percent);
      if (!Number.isFinite(tare) || tare <= 0) {
        return NextResponse.json({ error: "Тара должна быть больше нуля." }, { status: 400 });
      }
      if (moisture != null && (!Number.isFinite(moisture) || moisture <= 0 || moisture >= 100)) {
        return NextResponse.json({ error: "Влажность должна быть больше 0 и меньше 100 %." }, { status: 400 });
      }
      const sessionToken = request.cookies.get(WEIGHBRIDGE_OPERATOR_COOKIE)?.value || "";
      const rpcStartedAt = Date.now();
      const transferCloseRpc = ticketBefore.linked_processing_id && ticketBefore.processing_output_role
        ? "close_processing_output_ticket_atomic_v1"
        : "close_transfer_ticket_atomic_v2";
      const { data: closeResult, error: closeError } = await supabase.rpc(transferCloseRpc, {
        p_ticket_id: id,
        p_session_token: sessionToken,
        p_tare_weight_kg: tare,
        p_moisture_percent: moisture,
        p_tare_variance_confirmed: Boolean(body?.confirm_tare_variance),
        p_idempotency_key: String(request.headers.get("idempotency-key") || body?.idempotency_key || "").trim() || null,
      });
      timing.rpcMs = Date.now() - rpcStartedAt;
      if (closeError) {
        const stockResponse = transferStockErrorResponse(closeError.message);
        if (stockResponse) return stockResponse;
        return NextResponse.json({ error: weighbridgeUserError(closeError.message) }, { status: 400 });
      }
      const result = (closeResult || {}) as Record<string, any>;
      if (result.code === "shift_expired") {
        return NextResponse.json({ error: "Введите PIN весовщика, чтобы продолжить смену.", code: result.code }, { status: 423 });
      }
      if (result.requires_confirmation) {
        return NextResponse.json({ error: "Проверьте тару.", ...result }, { status: 409 });
      }
      if (!result.ok) {
        return NextResponse.json({ error: "Не удалось завершить талон.", trace_id: randomUUID() }, { status: 409 });
      }
      const { data: updated, error: updatedError } = await supabase
        .from("tickets")
        .select("*, lines:ticket_lines(*)")
        .eq("id", id)
        .eq("company_id", companyId)
        .single();
      if (updatedError || !updated?.id) {
        return NextResponse.json({ error: "Талон завершён, но не удалось обновить его отображение.", trace_id: randomUUID() }, { status: 409 });
      }
      timing.totalMs = Date.now() - startedAt;
      const [attributedTicket] = await enrichTicketOperatorAttribution(supabase, companyId, [updated]);
      return NextResponse.json({ ticket: attributedTicket, finalize: result, debug: timing });
    }

    let harvestClosureState: Awaited<ReturnType<typeof loadHarvestClosureState>> | null = null;
    if (ticketBefore.is_finalized || ticketBefore.status === "finalized") {
      if (ticketBefore.op_type === "harvest_incoming") {
        harvestClosureState = await loadHarvestClosureState(supabase, companyId, id);
        await syncHarvestBatchMoisture(supabase, companyId, id, harvestClosureState.lines as any);
      }
      timing.validationMs = Date.now() - dbStartedAt;
      timing.totalMs = Date.now() - startedAt;
      const [attributedTicket] = await enrichTicketOperatorAttribution(supabase, companyId, [ticketBefore]);
      return NextResponse.json({ ticket: attributedTicket, idempotent_replay: true, debug: timing });
    }
    if (ticketBefore.op_type === "harvest_incoming") {
      harvestClosureState = await loadHarvestClosureState(supabase, companyId, id);
      const weighingNumbers = harvestClosureState.weighings.map((row: any) => Number(row.weighing_no));
      if (
        harvestClosureState.lines.length !== 1 ||
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
      if (ticketBefore.correction_of_ticket_id && isCorrectionLotError(finalizeError.message)) {
        return correctionLotErrorResponse(finalizeError.message);
      }
      return NextResponse.json({ error: weighbridgeUserError(finalizeError.message) }, { status: 400 });
    }
    const dbAfterRpcStartedAt = Date.now();
    try {
      await Promise.all([
        operatorSession?.operator.id
          ? supabase
              .from("tickets")
              .update({ finalized_by_person_id: operatorSession.operator.id })
              .eq("id", id)
              .eq("company_id", companyId)
              .then(({ error }) => { if (error) throw error; })
          : Promise.resolve(),
        ticketBefore.op_type === "harvest_incoming"
          ? syncHarvestBatchMoisture(supabase, companyId, id, harvestClosureState?.lines as any)
          : Promise.resolve(),
      ]);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Не удалось завершить данные талона." },
        { status: 409 }
      );
    }

    const [lineLinksResult, updatedResult, stillActiveResult, requestItemsResult] = await Promise.all([
      supabase
        .from("ticket_lines")
        .select("id,operation_line_id,operation_lines:operation_line_id(operation_id)")
        .eq("ticket_id", id)
        .eq("company_id", companyId)
        .not("operation_line_id", "is", null),
      supabase.from("tickets").select("*").eq("id", id).maybeSingle(),
      ticketBefore.vehicle_id
        ? supabase
            .from("tickets")
            .select("id")
            .eq("company_id", ticketBefore.company_id)
            .eq("vehicle_id", ticketBefore.vehicle_id)
            .in("status", ["draft", "active", "ready_to_close"])
            .neq("id", id)
            .limit(1)
        : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
      ticketBefore.linked_request_id
        ? supabase
            .from("warehouse_issue_request_items")
            .select("id, planned_quantity, required_quantity")
            .eq("request_id", ticketBefore.linked_request_id)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    const { data: lineLinks, error: lineLinksError } = lineLinksResult;
    if (lineLinksError) {
      return NextResponse.json({ error: lineLinksError.message || "Operation linkage load failed" }, { status: 400 });
    }
    if (updatedResult.error) {
      return NextResponse.json({ error: updatedResult.error.message || "Final ticket load failed" }, { status: 400 });
    }

    const backfillResults = await Promise.all((lineLinks || []).map(async (row) => {
      const operationLineRel = Array.isArray((row as any).operation_lines)
        ? (row as any).operation_lines[0]
        : (row as any).operation_lines;
      const operationId = String(operationLineRel?.operation_id || "").trim();
      if (!operationId) return null;
      const { error: fmcBackfillError } = await supabase
        .from("field_material_consumptions")
        .update({ operation_id: operationId, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("ticket_id", id)
        .eq("ticket_line_id", String((row as any).id || ""))
        .is("operation_id", null);
      return fmcBackfillError;
    }));
    const backfillError = backfillResults.find(Boolean);
    if (backfillError) {
      return NextResponse.json({ error: backfillError.message || "Operation id backfill failed" }, { status: 400 });
    }

    const trailingWrites: Array<PromiseLike<unknown>> = [];
    if (ticketBefore.vehicle_id && (stillActiveResult.data || []).length === 0) {
      trailingWrites.push(
        supabase
          .from("reference_vehicles")
          .update({ status: "free" })
          .eq("id", ticketBefore.vehicle_id)
          .eq("company_id", ticketBefore.company_id)
      );
    }

    if (ticketBefore.linked_request_id) {
      trailingWrites.push(
        supabase.from("warehouse_issue_requests").update({
          status: "issued_by_warehouse", issued_at: new Date().toISOString(),
          issued_by_user_id: actor.id, source_warehouse_id: ticketBefore.warehouse_from_id || null,
        }).eq("id", ticketBefore.linked_request_id),
        supabase.from("warehouse_issue_request_items").upsert(
          (requestItemsResult.data || []).map((item: any) => ({
            id: item.id,
            issued_quantity: Number(item.planned_quantity || item.required_quantity || 0),
          })),
          { onConflict: "id" }
        )
      );
    }
    await Promise.all(trailingWrites);
    if (operatorSession) {
      await recordWeighbridgeOperatorActivity(request, { companyId, supabase }, "tare_finalize");
    }

    timing.dbMs = timing.validationMs + (Date.now() - dbAfterRpcStartedAt);
    timing.totalMs = Date.now() - startedAt;
    const [attributedTicket] = await enrichTicketOperatorAttribution(supabase, companyId, [updatedResult.data]);
    const response = NextResponse.json({ ticket: attributedTicket, debug: timing });
    response.headers.set(
      "Server-Timing",
      `auth;dur=${timing.authMs}, validation;dur=${timing.validationMs}, finalize_rpc;dur=${timing.rpcMs}, db;dur=${timing.dbMs}, total;dur=${timing.totalMs}`
    );
    return response;
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
