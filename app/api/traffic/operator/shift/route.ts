import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore, operator, sameOrigin, TrafficError } from "@/lib/traffic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hectares = z.number().finite().min(0).max(1_000_000);
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    cropStructureId: z.string().uuid(),
    key: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("switch"),
    shiftId: z.string().uuid(),
    cropStructureId: z.string().uuid(),
    hectaresFieldTotal: hectares,
    fieldFinished: z.boolean(),
    confirmOutsideTolerance: z.boolean().optional(),
    key: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("close"),
    shiftId: z.string().uuid(),
    hectaresFieldTotal: hectares,
    fieldFinished: z.boolean().optional(),
    hectaresShift: hectares.optional(),
    confirmOutsideTolerance: z.boolean().optional(),
    key: z.string().uuid(),
  }).strict(),
]).superRefine((value, context) => {
  if (value.action === "close") {
    const isCurrent = typeof value.fieldFinished === "boolean" && value.hectaresShift === undefined;
    const isLegacy = value.fieldFinished === undefined && value.hectaresShift !== undefined;
    if (!isCurrent && !isLegacy) context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid close payload" });
  }
});
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
  cropStructureId: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await operator(request);
    if (actor.role !== "harvester") throw new TrafficError("PTC_SHIFT_FORBIDDEN", 403);
    const input = command.parse(await request.json());
    const legacyClose = input.action === "close" && input.hectaresShift !== undefined;
    if (legacyClose) {
      const { data, error } = await getServiceClient().rpc("ptc_set_combine_shift_v1", {
        p_actor: actor.actorId,
        p_command: "close",
        p_shift: input.shiftId,
        p_hectares_shift: input.hectaresShift,
        p_hectares_field_total: input.hectaresFieldTotal,
        p_key: input.key,
      });
      if (error) throw new Error(error.message);
      const parsed = receipt.safeParse(data);
      if (!parsed.success) throw new Error("Invalid legacy combine shift receipt");
      return noStore(parsed.data);
    }
    const { data, error } = await getServiceClient().rpc("ptc_set_combine_shift_v2", {
      p_actor: actor.actorId,
      p_command: input.action,
      p_shift: input.action === "open" ? null : input.shiftId,
      p_crop_structure: input.action === "close" ? null : input.cropStructureId,
      p_hectares_field_total: input.action === "open" ? null : input.hectaresFieldTotal,
      p_field_finished: input.action === "open" ? null : input.fieldFinished === true,
      p_confirm_outside_tolerance: input.action === "open" ? false : input.confirmOutsideTolerance === true,
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
