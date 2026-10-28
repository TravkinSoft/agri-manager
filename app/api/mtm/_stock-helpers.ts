import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { parseCanonicalRole } from "@/lib/auth/role-contract";
import { SessionAuthError, getServerActorFromSession, getUserScopedClientFromRequest, resolveCompanyForActor } from "@/lib/auth/server-session";
import { MTM_READ_ROLES, MTM_UUID } from "./_helpers";
import { mtmStockFailure } from "@/lib/mtm/stock-validation";

// Match existing warehouse receipt/transfer rights. Company admin is not a stock writer.
export const MTM_STOCK_WRITE_ROLES = ["global_admin", "warehouse", "warehouse_operator"] as const;
export async function mtmStockSession(request: NextRequest, requestedCompanyId: string | null, write = false) {
  const actor = await getServerActorFromSession(request, { skipCache: true });
  if (actor.isImpersonating) throw new SessionAuthError("МТМ недоступна в режиме просмотра от имени другого пользователя", 403);
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  if (!MTM_UUID.test(companyId)) throw new SessionAuthError("Выберите компанию", 400);
  const supabase = await getUserScopedClientFromRequest(request);
  const profile = await assertActorAccess({ supabase, actorUserId: actor.id, companyId, allowedRoles: [...(write ? MTM_STOCK_WRITE_ROLES : MTM_READ_ROLES)] });
  const role = parseCanonicalRole(profile.role);
  const canOperate = (MTM_STOCK_WRITE_ROLES as readonly string[]).includes(role || "");
  return { actor, companyId, supabase, canOperate };
}
export function mtmStockError(error: unknown) {
  if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  const failure = mtmStockFailure(error as { code?: string; message?: string });
  return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status });
}
export function mtmOptionalId(value: string | null): string | null {
  if (value === null || value === "") return null;
  if (!MTM_UUID.test(value)) throw new SessionAuthError("Некорректный идентификатор", 400);
  return value;
}
export async function mtmStockBody(request: NextRequest) {
  const text = await request.text();
  if (text.length > 16000) throw new SessionAuthError("Слишком большой запрос", 400);
  try { return JSON.parse(text); } catch { throw new SessionAuthError("Некорректный запрос", 400); }
}
