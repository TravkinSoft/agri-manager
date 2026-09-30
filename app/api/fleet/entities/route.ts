import type { NextRequest } from "next/server";
import {
  createFleetEntity,
  fleetEntityFailure,
  fleetEntityResponse,
  fleetEntitySameOrigin,
} from "@/lib/fleet/entity-creation-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    fleetEntitySameOrigin(request);
    return fleetEntityResponse(await createFleetEntity(request), 201);
  } catch (error) {
    return fleetEntityFailure(error);
  }
}
