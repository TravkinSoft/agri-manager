import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

const managementRoles = ["global_admin", "company_admin", "director"] as const;
const reversalRoles = ["global_admin", "company_admin"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const userMessage = (message: string) => {
  if (message.includes("PROCESSING_BALANCE_MISMATCH")) {
    const delta = Number(message.split("|")[1] || 0);
    return `Обработка ещё не может быть закрыта. Не распределено: ${Math.abs(delta).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг.`;
  }
  if (message.includes("PROCESSING_DRYING_MOISTURE_REQUIRED")) return "Для закрытия сушки недостаточно данных о входной или выходной влажности.";
  if (message.includes("PROCESSING_OPEN_OUTPUT_TICKETS")) return "Сначала завершите все открытые выходные талоны этой обработки.";
  if (message.includes("PROCESSING_OUTPUT_TICKET_REQUIRED")) return "Каждый фактический выход должен быть оформлен завершённым весовым талоном.";
  if (message.includes("PROCESSING_SOFT_FINISH_REQUIRED")) return "Сначала отметьте, что физическая обработка закончена.";
  if (message.includes("PROCESSING_OTHER_LOSS_REASON_REQUIRED")) return "Для другой потери укажите пояснение.";
  if (message.includes("PROCESSING_ALREADY_CLOSED")) return "Материальный баланс уже закрыт. Возобновить эту обработку нельзя.";
  if (message.includes("PROCESSING_SOURCE_BALANCE_CHANGED")) return "Остаток партии изменился. Обновите данные и повторите проверку.";
  if (message.includes("PROCESSING_REVERSAL_DOWNSTREAM_DEPENDENCY")) return "Отмена обработки невозможна: произведённая продукция уже использована в последующем движении.";
  if (message.includes("PROCESSING_REVERSAL_IDEMPOTENCY_CONFLICT")) return "Ключ повтора уже использован для другого запроса отмены. Обновите данные и повторите действие с новым ключом.";
  if (message.includes("PROCESSING_ALREADY_REVERSED")) return "Обработка уже отменена. Обновите данные.";
  if (message.includes("PROCESSING_REVERSAL_REQUIRES_CLOSED")) return "Отменить можно только полностью закрытую обработку.";
  if (message.includes("PROCESSING_REVERSAL_REASON_REQUIRED")) return "Укажите причину отмены обработки.";
  if (message.includes("PROCESSING_REVERSAL_CONTEXT_REQUIRED")) return "Укажите компанию и сезон обработки.";
  if (message.includes("PROCESSING_REVERSAL_SEASON_INVALID")) return "Сезон обработки не подтверждён для текущей компании.";
  if (message.includes("PROCESSING_REVERSAL_COMPANY_MISMATCH")) return "Связанные документы обработки относятся к другой компании.";
  if (message.includes("PROCESSING_REVERSAL_REFERENCE_MISMATCH")) return "Отмена остановлена: связанные партии, талоны или объекты не соответствуют компании и сезону обработки.";
  if (message.includes("PROCESSING_LEDGER_TRACE_INCOMPLETE")) return "Отмена остановлена: складской след обработки неполный или противоречивый. Требуется сверка.";
  if (message.includes("PROCESSING_REVERSAL_POSTCONDITION_FAILED")) return "Отмена не завершена: контрольный баланс не сошёлся. Изменения отменены.";
  if (message.includes("PROCESSING_FORBIDDEN")) return "Недостаточно прав для этого действия.";
  return "Не удалось выполнить действие обработки. Обновите данные и повторите.";
};

const rpcStatus = (message: string) => {
  if (message.includes("PROCESSING_FORBIDDEN") || message.includes("permission denied")) return 403;
  if (message.includes("PROCESSING_NOT_FOUND")) return 404;
  if (
    message.includes("PROCESSING_REVERSAL_REASON_REQUIRED")
    || message.includes("PROCESSING_REVERSAL_REASON_TOO_LONG")
    || message.includes("PROCESSING_REVERSAL_KEY_TOO_LONG")
    || message.includes("PROCESSING_REVERSAL_CONTEXT_REQUIRED")
    || message.includes("IDEMPOTENCY_KEY_REQUIRED")
  ) return 400;
  return 409;
};

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const body = await request.json();
    const action = String(body.action || "");
    const isReverse = action === "reverse";
    if (isReverse && !UUID_RE.test(context.params.id)) {
      return NextResponse.json({ error: "Не удалось определить обработку." }, { status: 400 });
    }
    const actorUserId = String(body.actor_user_id || "").trim();
    const idempotencyKey = String(body.idempotency_key || "").trim();
    if ((!isReverse && !actorUserId) || !idempotencyKey) {
      return NextResponse.json({ error: "Не удалось подтвердить пользователя или повтор запроса." }, { status: 400 });
    }

    const allowedRoles = isReverse
      ? reversalRoles
      : action === "soft_finish" || action === "reopen" || action === "mark_last_main"
        ? WEIGHBRIDGE_WRITE_ROLES
        : managementRoles;
    const requestedCompanyId = isReverse ? String(body.company_id || "").trim() || null : null;
    const session = await resolveWeighbridgeSession(request, { allowedRoles, requestedCompanyId });

    if (action === "soft_finish" || action === "reopen" || action === "mark_last_main") {
      await requireWeighbridgeOperatorSession(request, session);
    }

    let rpcName = "";
    let args: Record<string, unknown> = {};
    if (action === "soft_finish") {
      rpcName = "soft_finish_processing_v1";
      args = { p_transformation_id: context.params.id, p_actor_user_id: actorUserId, p_idempotency_key: idempotencyKey };
    } else if (action === "reopen") {
      rpcName = "reopen_processing_before_close_v1";
      args = { p_transformation_id: context.params.id, p_actor_user_id: actorUserId, p_idempotency_key: idempotencyKey };
    } else if (action === "hard_close") {
      rpcName = "close_processing_material_balance_v1";
      args = { p_transformation_id: context.params.id, p_actor_user_id: actorUserId, p_idempotency_key: idempotencyKey };
    } else if (action === "approve_loss") {
      rpcName = "approve_processing_loss_v1";
      args = {
        p_transformation_id: context.params.id,
        p_loss_type: String(body.loss_type || ""),
        p_qty_kg: Number(body.qty_kg || 0),
        p_reason: String(body.reason || ""),
        p_actor_user_id: actorUserId,
        p_idempotency_key: idempotencyKey,
      };
    } else if (action === "reverse") {
      const reason = String(body.reason || "").trim();
      const seasonId = String(body.season_id || "").trim();
      if (!reason) {
        return NextResponse.json({ error: "Укажите причину отмены обработки." }, { status: 400 });
      }
      if (!UUID_RE.test(seasonId)) {
        return NextResponse.json({ error: "Укажите сезон обработки." }, { status: 400 });
      }
      rpcName = "reverse_processing_material_balance_v1";
      args = {
        p_transformation_id: context.params.id,
        p_company_id: session.companyId,
        p_season_id: seasonId,
        p_actor_user_id: session.actor.id,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_audit_run_code: String(body.audit_run_code || "").trim() || null,
      };
    } else if (action === "mark_last_main") {
      rpcName = "mark_processing_last_main_output_v1";
      args = {
        p_transformation_id: context.params.id,
        p_ticket_id: String(body.ticket_id || ""),
        p_actor_user_id: actorUserId,
        p_idempotency_key: idempotencyKey,
      };
    } else {
      return NextResponse.json({ error: "Неизвестное действие обработки." }, { status: 400 });
    }

    const { data, error } = await session.supabase.rpc(rpcName, args);
    if (error) {
      const message = error.message || "";
      return NextResponse.json({ error: userMessage(message) }, { status: isReverse ? rpcStatus(message) : 409 });
    }
    return NextResponse.json(data || { ok: true });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: "Не удалось выполнить действие обработки." }, { status: 500 });
  }
}
