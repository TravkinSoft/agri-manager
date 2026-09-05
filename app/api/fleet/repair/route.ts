import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore, sameOrigin } from "@/lib/traffic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z.object({
  companyId: z.string().uuid(), vehicleId: z.string().uuid(), inRepair: z.boolean(),
  expectedVersion: z.number().int().min(0).max(2147483646),
}).strict();

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = command.parse(await request.json());
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });
    if (!["fleet_manager", "company_admin", "global_admin"].includes(actor.role)) {
      throw new SessionAuthError("Ремонт отмечает заведующий автопарком или администратор", 403);
    }
    const companyId = resolveCompanyForActor(actor, input.companyId);
    const db = getServiceClient();
    await assertActorAccess({ supabase: db, actorUserId: actor.id, companyId,
      allowedRoles: ["fleet_manager", "company_admin", "global_admin"] });
    const result = await db.rpc("fleet_set_vehicle_repair_v1", {
      p_actor: actor.id, p_company: companyId, p_vehicle: input.vehicleId,
      p_in_repair: input.inRepair, p_expected_version: input.expectedVersion,
    });
    if (result.error) throw new Error(result.error.message);
    return noStore(result.data);
  } catch (error) { return failed(error); }
}
