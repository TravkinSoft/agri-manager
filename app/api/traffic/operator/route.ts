import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import {
  failed,
  noStore,
  operator,
  readSnapshot,
  sameOrigin,
} from "@/lib/traffic/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const transition = z
  .object({
    vehicleId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    target: z.enum(["empty", "loaded", "unloading"]),
    key: z.string().uuid(),
  })
  .strict();
export async function GET(request: NextRequest) {
  try {
    const actor = await operator(request);
    return noStore(
      await readSnapshot(actor.companyId, actor.role, actor.personName),
    );
  } catch (error) {
    return failed(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await operator(request);
    const input = transition.parse(await request.json());
    const { data, error } = await getServiceClient().rpc("ptc_transition_v1", {
      p_token_hash: actor.hash,
      p_vehicle: input.vehicleId,
      p_version: input.version,
      p_target: input.target,
      p_key: input.key,
    });
    if (error)
      throw new Error(
        error.code === "23505" ? "PTC_KEY_CONFLICT" : error.message,
      );
    return noStore(data);
  } catch (error) {
    return failed(error);
  }
}
