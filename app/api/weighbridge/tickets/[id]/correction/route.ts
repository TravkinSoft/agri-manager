import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  WEIGHBRIDGE_OPERATOR_COOKIE,
  asSessionErrorResponse,
  recordWeighbridgeOperatorActivity,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
  weighbridgeUserError,
} from "@/app/api/weighbridge/_auth";
import { loadSharedImpurityTicketIds } from "@/lib/server/weighbridge-shared-impurity";

const CORRECTION_LOT_ERROR = "Не удалось завершить исправление талона. Связь партии не прошла проверку. Исходный талон не изменён.";
const SHARED_IMPURITY_CORRECTION_ERROR = "Для общего талона земли используйте исправление брутто и тары в окне «Исправить талон». Если полей веса нет, обновите страницу между взвешиваниями. Аннулировать талон не требуется.";

function isCorrectionLotError(message: string) {
  return /aggregate (harvest )?lot|batch identity|batch lineage|physical batch|line identity|warehouse-local batch|company stock/i.test(message);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const reason = String(body?.reason || "").trim();
    if (!id || !["start", "finalize", "shared_weights"].includes(action)) {
      return NextResponse.json({ error: "ticket id and correction action are required" }, { status: 400 });
    }
    if (["start", "shared_weights"].includes(action) && !reason) {
      return NextResponse.json({ error: "Причина исправления обязательна." }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id,company_id,correction_of_ticket_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (ticketError || !ticket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Ticket not found" }, { status: 404 });
    }

    const sharedTicketIds = await loadSharedImpurityTicketIds(
      supabase,
      companyId,
      [id, String(ticket.correction_of_ticket_id || "")]
    );
    if (action === "shared_weights") {
      if (!sharedTicketIds.has(id)) return NextResponse.json({ error: "Это не общий талон земли и примесей." }, { status: 400 });
      const fields = ["gross_weight_kg", "tare_weight_kg", "expected_gross_weight_kg", "expected_tare_weight_kg"] as const;
      if (fields.some((key) => typeof body[key] !== "number" || !Number.isFinite(body[key]) || body[key] < 0)
        || body.gross_weight_kg <= body.tare_weight_kg || reason.length > 2000
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.idempotency_key || ""))) {
        return NextResponse.json({ error: "Проверьте брутто, тару и причину исправления." }, { status: 400 });
      }
      await requireWeighbridgeOperatorSession(request, { companyId, supabase });
      const { data, error } = await supabase.rpc("correct_shared_impurity_ticket_weights_v1", {
        p_ticket_id: id,
        p_session_token: request.cookies.get(WEIGHBRIDGE_OPERATOR_COOKIE)?.value || "",
        p_gross_weight_kg: body.gross_weight_kg, p_tare_weight_kg: body.tare_weight_kg,
        p_expected_gross_weight_kg: body.expected_gross_weight_kg, p_expected_tare_weight_kg: body.expected_tare_weight_kg,
        p_reason: reason, p_idempotency_key: body.idempotency_key,
      });
      if (error) {
        const messages: Record<string, string> = {
          SHARED_WEIGHT_CONFLICT: "Талон уже изменён в другом окне. Откройте его заново и проверьте вес.",
          SHARED_WEIGHT_ACCOUNTING_SHIFT_CLOSED: "Смена этого талона уже закрыта. Исправление её сохранённого отчёта требует отдельной сверки; талон и склад не изменены.",
          SHARED_WEIGHT_STOCK_COMMITTED: "Дополнительный вес земли превышает свободный остаток исходных партий. Талон и склад не изменены.",
          SHARED_WEIGHT_EXCEEDS_SOURCE: "Вес земли не может превышать исходную массу партий.",
          SHARED_WEIGHT_SESSION_EXPIRED: "Введите PIN весовщика повторно, затем сохраните исправление.",
          SHARED_WEIGHT_STATE_INVALID: "Этот талон уже аннулирован, заменён или не поддерживает исправление веса. Откройте его заново.",
          SHARED_WEIGHT_KEY_REUSED: "Данные запроса изменились. Закройте окно исправления и откройте его снова.",
        };
        const code = Object.keys(messages).find((key) => error.message.includes(key));
        if (code) return NextResponse.json({ error: messages[code], code }, { status: code.includes("SESSION") ? 423 : 409 });
        console.error("shared_impurity_weight_correction_failed", { ticketId: id, code: error.code, message: error.message });
        return NextResponse.json({
          error: error.code === "55P03" || error.code === "57014"
            ? "Склад сейчас обрабатывает другой талон. Повторите сохранение — повторного списания не будет."
            : "Исправление не подтверждено. Повторите сохранение с теми же значениями; повторного списания не будет.",
          code: "shared_weight_correction_failed",
        }, { status: 409 });
      }
      if (!data?.ok) return NextResponse.json({ error: "Исправление не подтверждено. Повторите сохранение." }, { status: 409 });
      await recordWeighbridgeOperatorActivity(request, { companyId, supabase }, "ticket_correction")
        .catch((activityError) => console.error("shared_weight_activity_failed", { ticketId: id, error: String(activityError) }));
      return NextResponse.json({ ...data, ticket: { id } });
    }
    if (sharedTicketIds.has(id) || (
      ticket.correction_of_ticket_id
      && sharedTicketIds.has(String(ticket.correction_of_ticket_id))
    )) {
      return NextResponse.json(
        { error: SHARED_IMPURITY_CORRECTION_ERROR, code: "shared_impurity_correction_requires_void" },
        { status: 409 }
      );
    }

    const operatorSession = actor.role === "weighman"
      ? await requireWeighbridgeOperatorSession(request, { companyId, supabase })
      : null;
    let resultId: string | null = null;
    const findExistingCorrection = async () => supabase
      .from("tickets")
      .select("id")
      .eq("company_id", companyId)
      .eq("correction_of_ticket_id", id)
      .eq("is_voided", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (action === "start") {
      const { data: existingCorrection, error: existingCorrectionError } = await findExistingCorrection();
      if (existingCorrectionError) {
        return NextResponse.json({ error: existingCorrectionError.message }, { status: 400 });
      }
      resultId = existingCorrection?.id ? String(existingCorrection.id) : null;
    }

    const rpc = action === "start"
      ? "start_weighbridge_ticket_correction_v1"
      : "finalize_weighbridge_ticket_correction_v1";
    const args = action === "start"
      ? {
          p_ticket_id: id,
          p_reason: reason,
          p_operator_person_id: operatorSession?.operator.id || null,
          p_shift_id: operatorSession?.shift.id || null,
        }
      : {
          p_ticket_id: id,
          p_operator_person_id: operatorSession?.operator.id || null,
          p_shift_id: operatorSession?.shift.id || null,
        };
    if (!resultId) {
      const { data: rpcResultId, error: rpcError } = await supabase.rpc(rpc, args);
      if (rpcError) {
        if (rpcError.message.includes("SHARED_IMPURITY_CORRECTION_REQUIRES_VOID_NEW")) {
          return NextResponse.json(
            { error: SHARED_IMPURITY_CORRECTION_ERROR, code: "shared_impurity_correction_requires_void" },
            { status: 409 }
          );
        }
        if (action === "start") {
          const message = weighbridgeUserError(rpcError.message);
          if (message.includes("последующих движениях")) {
            const { data: existingCorrection, error: existingCorrectionError } = await findExistingCorrection();
            if (!existingCorrectionError && existingCorrection?.id) {
              resultId = String(existingCorrection.id);
            }
          }
        }
        if (!resultId) {
          if (action === "finalize" && isCorrectionLotError(rpcError.message)) {
            const traceId = randomUUID();
            console.error("weighbridge_correction_lot_validation_failed", { traceId, message: rpcError.message });
            return NextResponse.json(
              { error: CORRECTION_LOT_ERROR, code: "correction_lot_validation_failed", trace_id: traceId },
              { status: 409 }
            );
          }
          const message = weighbridgeUserError(rpcError.message);
          const status = message.includes("последующих движениях") ? 409 : 400;
          return NextResponse.json({ error: message, code: status === 409 ? "downstream_dependency" : "correction_failed" }, { status });
        }
      } else {
        resultId = String(rpcResultId || id);
      }
    }

    const { data: corrected, error: correctedError } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", String(resultId || id))
      .eq("company_id", companyId)
      .single();
    if (correctedError) {
      return NextResponse.json({ error: correctedError.message }, { status: 400 });
    }
    if (operatorSession) {
      await recordWeighbridgeOperatorActivity(request, { companyId, supabase }, "ticket_correction");
    }
    return NextResponse.json({ ticket: corrected });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
