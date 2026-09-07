import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import {
  failed,
  noStore,
  operator,
  sameOrigin,
  TrafficError,
} from "@/lib/traffic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const command = z.object({
  isBroken: z.boolean(),
  version: z.number().int().nonnegative().max(2_147_483_646),
  key: z.string().uuid(),
}).strict();

const receipt = z.object({
  ok: z.literal(true),
  replayed: z.boolean(),
  eventId: z.string().uuid(),
  operatorUserId: z.string().uuid(),
  operatorName: z.string().min(1),
  isBroken: z.boolean(),
  version: z.number().int().positive(),
  changedAt: z.string().datetime({ offset: true }),
  shiftId: z.string().uuid().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await operator(request);
    if (actor.role !== "harvester")
      throw new TrafficError("PTC_COMBINE_STATUS_FORBIDDEN", 403);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new TrafficError("PTC_COMBINE_STATUS_INVALID", 400);
    }
    const input = command.parse(raw);
    const { data, error } = await getServiceClient().rpc(
      "ptc_set_combine_breakdown_v1",
      {
        p_actor: actor.actorId,
        p_is_broken: input.isBroken,
        p_expected_version: input.version,
        p_key: input.key,
      },
    );
    if (error) throw new Error(error.message);
    const parsed = receipt.safeParse(data);
    if (!parsed.success) throw new Error("Invalid combine status receipt");
    return noStore(parsed.data);
  } catch (error) {
    return failed(error);
  }
}
