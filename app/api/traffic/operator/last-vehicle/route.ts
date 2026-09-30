import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore, operator, sameOrigin, TrafficError } from "@/lib/traffic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("mark"),
    vehicleId: z.string().uuid(),
    key: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("clear"),
    vehicleId: z.string().uuid(),
    key: z.string().uuid(),
  }).strict(),
]);

const receipt = z.object({
  ok: z.literal(true),
  replayed: z.boolean(),
  eventId: z.string().uuid(),
  marker: z.object({
    vehicleId: z.string().uuid(),
    markedAt: z.string().datetime({ offset: true }),
    version: z.number().int().positive(),
  }).nullable(),
});

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await operator(request);
    if (actor.role !== "harvester")
      throw new TrafficError("PTC_LAST_VEHICLE_FORBIDDEN", 403);
    const input = command.parse(await request.json());
    const { data, error } = await getServiceClient().rpc("ptc_set_last_vehicle_v1", {
      p_actor: actor.actorId,
      p_vehicle: input.vehicleId,
      p_command: input.action,
      p_key: input.key,
    });
    if (error) throw new Error(error.message);
    const parsed = receipt.safeParse(data);
    if (!parsed.success) throw new Error("Invalid last vehicle receipt");
    return noStore(parsed.data);
  } catch (error) {
    return failed(error);
  }
}
