import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore, sameOrigin } from "@/lib/traffic/server";
import { dispatchPushNotifications } from "@/lib/notifications/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z.object({
  companyId: z.string().uuid(), vehicleId: z.string().uuid(), inRepair: z.boolean(),
  expectedVersion: z.number().int().min(0).max(2147483646),
}).strict();

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = command.parse(await request.json().catch(() => null));
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
    const eventKey = String(result.data?.notificationEventKey || "").trim();
    if (eventKey) {
      waitUntil(
        dispatchPushNotifications(db, { eventKey }).catch((pushError) => {
          // The fleet transaction and durable in-app notification already
          // committed. Push is a best-effort secondary delivery channel.
          console.warn("Fleet repair push dispatch failed", pushError);
        }),
      );
    }
    return noStore(result.data);
  } catch (error) { return failed(error); }
}
