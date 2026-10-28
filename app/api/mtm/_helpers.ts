import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, getUserScopedClientFromRequest, resolveCompanyForActor } from "@/lib/auth/server-session";
import { mtmDatabaseFailure } from "@/lib/mtm/validation";

export const MTM_READ_ROLES = ["global_admin", "company_admin", "warehouse", "warehouse_operator", "mechanic_operator", "fleet_manager", "agronomist", "director", "accountant"] as const;
export const MTM_WRITE_ROLES = ["global_admin", "company_admin"] as const;
export const MTM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function mtmSession(request: NextRequest, requestedCompanyId: string | null, write = false) {
  const actor = await getServerActorFromSession(request, { skipCache: true });
  // The new SQL contract resolves the authenticated profile, not an impersonated actor.
  // Do not silently execute an impersonated request with the administrator's rights.
  if (actor.isImpersonating) throw new SessionAuthError("Каталог МТМ пока недоступен в режиме просмотра от имени другого пользователя", 403);
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  if (!MTM_UUID.test(companyId)) throw new SessionAuthError("Выберите компанию", 400);
  const supabase = await getUserScopedClientFromRequest(request);
  await assertActorAccess({ supabase, actorUserId: actor.id, companyId, allowedRoles: [...(write ? MTM_WRITE_ROLES : MTM_READ_ROLES)] });
  return { actor, companyId, supabase, canEdit: (MTM_WRITE_ROLES as readonly string[]).includes(actor.role) };
}

export function mtmError(error: unknown) {
  if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  const failure = mtmDatabaseFailure(error as { code?: string; message?: string });
  return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status });
}
