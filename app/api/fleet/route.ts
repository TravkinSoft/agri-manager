import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore } from "@/lib/traffic/server";
import { readCompanyFleet } from "@/lib/fleet/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });
    if (!["fleet_manager", "company_admin", "global_admin"].includes(actor.role)) {
      throw new SessionAuthError("Кабинет доступен заведующему автопарком и администратору", 403);
    }
    const requestedCompany = z.string().uuid().nullable().parse(request.nextUrl.searchParams.get("companyId"));
    const companyId = resolveCompanyForActor(actor, requestedCompany);
    const db = getServiceClient();
    await assertActorAccess({
      supabase: db, actorUserId: actor.id, companyId,
      allowedRoles: ["fleet_manager", "company_admin", "global_admin"],
    });
    const vehicles = await readCompanyFleet(db, companyId);
    return noStore({ companyId, vehicles });
  } catch (error) {
    return failed(error);
  }
}
