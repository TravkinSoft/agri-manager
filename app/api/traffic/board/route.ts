import { NextRequest } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { readCompanyFleet } from "@/lib/fleet/server";
import { failed, noStore, readSnapshot, TrafficError } from "@/lib/traffic/server";
import { buildTrafficBoard, TRAFFIC_BOARD_ROLES } from "@/lib/traffic/read-only-board";
import { readShiftTripCounts } from "@/lib/traffic/shift-trip-counts-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reading the full board does not grant the manager/operator mutation routes.
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { skipCache: true });
    if (!TRAFFIC_BOARD_ROLES.some(role => role === actor.role)) {
      throw new TrafficError("Нет доступа к доске движения машин", 403);
    }
    const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("companyId"));
    const db = getServiceClient();
    await assertActorAccess({ supabase: db, actorUserId: actor.id, companyId, allowedRoles: [...TRAFFIC_BOARD_ROLES] });
    const [snapshot, fleet, driverTripCounts] = await Promise.all([
      readSnapshot(companyId, "manager", "", false, undefined, false, false),
      readCompanyFleet(db, companyId),
      // Opt-in keeps the existing weighbridge read-only board unchanged.
      request.nextUrl.searchParams.get("includeShiftTrips") === "true"
        ? readShiftTripCounts(db, companyId).catch(() => null) : undefined,
    ]);
    return noStore(buildTrafficBoard(companyId, snapshot, fleet, driverTripCounts));
  } catch (error) {
    return failed(error);
  }
}
