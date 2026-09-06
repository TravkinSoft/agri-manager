import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, manager, noStore, sameOrigin, TrafficError } from "@/lib/traffic/server";
import { dispatchPushNotifications } from "@/lib/notifications/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z.object({
  companyId: z.string().uuid(),
  vehicleIds: z.array(z.string().uuid()).min(1).max(100),
  assigned: z.boolean(),
  expectedRevision: z.string().datetime({ offset: true }).nullable(),
}).strict();
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { actor, companyId } = await manager(request);
    const input = command.parse(await request.json());
    if (input.companyId !== companyId) throw new TrafficError("Компания изменилась. Откройте список заново.", 409);
    const db = getServiceClient();
    const { data, error } = await db.rpc("ptc_set_vehicle_line_v1", {
      p_actor: actor.id, p_company: companyId, p_vehicles: input.vehicleIds,
      p_assigned: input.assigned, p_expected_revision: input.expectedRevision,
    });
    if (error) throw new Error(error.message);
    const eventKey = String(data?.notificationEventKey || "").trim();
    if (eventKey) {
      waitUntil(
        dispatchPushNotifications(db, { eventKey }).catch((pushError) => {
          console.warn("PTC line push dispatch failed", pushError);
        }),
      );
    }
    return noStore(data);
  } catch (error) { return failed(error); }
}
