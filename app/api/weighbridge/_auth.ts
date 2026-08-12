import type { NextRequest } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

export const WEIGHBRIDGE_READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "specialist",
] as const;

export const WEIGHBRIDGE_WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "weighman",
] as const;

export const WEIGHBRIDGE_OPERATOR_COOKIE = "travkin_wb_operator";

export type WeighbridgeOperatorSession = {
  operator: { id: string; name: string };
  shift: { id: string; status: string };
  session_expires_at: string;
};

export async function resolveWeighbridgeSession(
  request: NextRequest,
  options?: {
    allowedRoles?: readonly (
      | "admin"
      | "global_admin"
      | "company_admin"
      | "agronomist"
      | "director"
      | "legal_operator"
      | "warehouse"
      | "warehouse_operator"
      | "weighman"
      | "specialist"
      | "fuel_operator"
      | "brigadier"
    )[];
    requestedCompanyId?: string | null;
  }
) {
  const actor = await getServerActorFromSession(request);
  const queryCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
  const requestedCompanyId = options?.requestedCompanyId ?? queryCompanyId;
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  const supabase = await getUserScopedClientFromRequest(request);

  await assertActorAccess({
    supabase,
    actorUserId: actor.id,
    companyId,
    allowedRoles: [...(options?.allowedRoles || WEIGHBRIDGE_READ_ROLES)],
  });

  return { actor, companyId, supabase };
}

export async function requireWeighbridgeOperatorSession(
  request: NextRequest,
  context: {
    companyId: string;
    supabase: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>;
  }
): Promise<WeighbridgeOperatorSession> {
  const token = request.cookies.get(WEIGHBRIDGE_OPERATOR_COOKIE)?.value || "";
  const { data, error } = await context.supabase.rpc("weighbridge_operator_session_state_v1", {
    p_company_id: context.companyId,
    p_session_token: token || null,
  });
  if (error) {
    throw new SessionAuthError(error.message || "Operator session check failed", 400);
  }
  const state = (data || {}) as Record<string, any>;
  if (!state.unlocked || !state.operator?.id || !state.shift?.id) {
    throw new SessionAuthError("Введите PIN весовщика, чтобы продолжить смену.", 423);
  }
  return state as WeighbridgeOperatorSession;
}

export function asSessionErrorResponse(error: unknown) {
  if (error instanceof SessionAuthError) {
    return { error: error.message, status: error.status };
  }
  return null;
}

export function weighbridgeUserError(message: unknown): string {
  const raw = String(message || "").trim();
  const lower = raw.toLowerCase();

  if (raw.includes("IMPURITY_WEIGHT_EXCEEDS_AVAILABLE|")) {
    const available = Number(raw.split("IMPURITY_WEIGHT_EXCEEDS_AVAILABLE|")[1]?.split(/\s/)[0]);
    const label = Number.isFinite(available)
      ? available.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
      : "0";
    return `Вес превышает доступную массу партии. Доступно: ${label} кг`;
  }

  if (lower.includes("actor role is not allowed to finalize")) {
    return "У вашей роли нет права закрывать талоны весовой.";
  }
  if (lower.includes("only admin can void finalized tickets")) {
    return "Закрытый талон может аннулировать только администратор или директор.";
  }
  if (lower.includes("actor does not belong to ticket company")) {
    return "Талон относится к другой компании или не выбран контекст компании.";
  }
  if (lower.includes("gross and tare are required")) {
    return "Перед закрытием укажите брутто и тару.";
  }
  if (lower.includes("net weight must be greater than zero")) {
    return "Нетто должно быть больше нуля. Проверьте брутто и тару.";
  }
  if (lower.includes("tare") && lower.includes("gross")) {
    return "Тара должна быть меньше брутто.";
  }
  if (lower.includes("простое исправление невозможно") || lower.includes("downstream")) {
    return "Этот приход уже использован в последующих движениях. Простое исправление невозможно.";
  }
  if (lower.includes("ticket already has ledger entries")) {
    return "По талону уже есть складские движения. Повторное закрытие запрещено.";
  }
  if (lower.includes("insufficient exact stock identity")) {
    return "Недостаточно остатка по выбранной складской партии.";
  }
  if (lower.includes("line quantities must match net weight")) {
    return "Сумма строк должна совпадать с нетто талона.";
  }
  if (lower.includes("void reason is required")) {
    return "Укажите причину аннулирования.";
  }

  return raw || "Операция весовой не выполнена.";
}
