import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, fleetManager, noStore, sameOrigin, TrafficError } from "@/lib/traffic/server";
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
    const { actor, companyId } = await fleetManager(request);
    if (input.companyId !== companyId) {
      throw new TrafficError("Компания изменилась. Откройте список заново.", 409);
    }
    const db = getServiceClient();
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
