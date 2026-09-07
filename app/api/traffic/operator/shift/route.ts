import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore, operator, sameOrigin, TrafficError } from "@/lib/traffic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hectares = z.number().finite().min(0).max(1_000_000);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), key: z.string().uuid() }).strict(),
  z.object({
    action: z.literal("close"),
    shiftId: z.string().uuid(),
    hectaresShift: hectares,
    hectaresFieldTotal: hectares,
    key: z.string().uuid(),
  }).strict(),
]);
const receipt = z.object({
  ok: z.literal(true),
  replayed: z.boolean(),
  eventId: z.string().uuid(),
  shiftId: z.string().uuid(),
  status: z.enum(["open", "closed"]),
  openedAt: z.string().datetime({ offset: true }),
  closedAt: z.string().datetime({ offset: true }).nullable(),
  hectaresShift: z.coerce.number().nullable(),
  hectaresFieldTotal: z.coerce.number().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await operator(request);
    if (actor.role !== "harvester") throw new TrafficError("PTC_SHIFT_FORBIDDEN", 403);
    const input = command.parse(await request.json());
    const { data, error } = await getServiceClient().rpc("ptc_set_combine_shift_v1", {
      p_actor: actor.actorId,
      p_command: input.action,
      p_shift: input.action === "close" ? input.shiftId : null,
      p_hectares_shift: input.action === "close" ? input.hectaresShift : null,
      p_hectares_field_total: input.action === "close" ? input.hectaresFieldTotal : null,
      p_key: input.key,
    });
    if (error) throw new Error(error.message);
    const parsed = receipt.safeParse(data);
    if (!parsed.success) throw new Error("Invalid combine shift receipt");
    return noStore(parsed.data);
  } catch (error) {
    return failed(error);
  }
}
