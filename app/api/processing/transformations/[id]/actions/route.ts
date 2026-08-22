import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

const managementRoles = ["global_admin", "company_admin", "director"] as const;

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
  if (message.includes("PROCESSING_FORBIDDEN")) return "Недостаточно прав для этого действия.";
  return "Не удалось выполнить действие обработки. Обновите данные и повторите.";
};

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const body = await request.json();
    const action = String(body.action || "");
    const actorUserId = String(body.actor_user_id || "").trim();
    const idempotencyKey = String(body.idempotency_key || "").trim();
    if (!actorUserId || !idempotencyKey) {
      return NextResponse.json({ error: "Не удалось подтвердить пользователя или повтор запроса." }, { status: 400 });
    }

    const allowedRoles = action === "soft_finish" || action === "reopen" || action === "mark_last_main"
      ? WEIGHBRIDGE_WRITE_ROLES
      : managementRoles;
    const session = await resolveWeighbridgeSession(request, { allowedRoles });

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
    if (error) return NextResponse.json({ error: userMessage(error.message || "") }, { status: 409 });
    return NextResponse.json(data || { ok: true });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: "Не удалось выполнить действие обработки." }, { status: 500 });
  }
}
