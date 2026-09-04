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
const transitionReceipt = z.object({
  eventId: z.string().uuid(),
  replayed: z.boolean(),
});
const vehicleState = z.object({
  vehicle_id: z.string().uuid(),
  state: z.enum(["empty", "loaded", "unloading"]),
  version: z.number().int().nonnegative(),
  since: z.string().datetime({ offset: true }),
  cycle: z.number().int().nonnegative(),
  assigned: z.boolean(),
});
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
  const started = Date.now();
  const timings = { auth: 0, rpc: 0, read: 0 };
  async function measure<T>(
    phase: keyof typeof timings,
    work: () => PromiseLike<T>,
  ): Promise<T> {
    const phaseStarted = Date.now();
    try {
      return await work();
    } finally {
      timings[phase] = Math.max(0, Date.now() - phaseStarted);
    }
  }
  function withTiming(response: ReturnType<typeof noStore>) {
    response.headers.set(
      "Server-Timing",
      [...Object.entries(timings), ["total", Math.max(0, Date.now() - started)]]
        .map(([phase, duration]) => `${phase};dur=${duration}`)
        .join(", "),
    );
    return response;
  }
  try {
    sameOrigin(request);
    const actor = await measure("auth", () => operator(request));
    const input = transition.parse(await request.json());
    const db = getServiceClient();
    const { data, error } = await measure("rpc", () =>
      db.rpc("ptc_actor_transition_v1", {
        p_actor: actor.actorId,
        p_vehicle: input.vehicleId,
        p_version: input.version,
        p_target: input.target,
        p_key: input.key,
      }),
    );
    if (error)
      throw new Error(
        error.code === "23505" ? "PTC_KEY_CONFLICT" : error.message,
      );
    const receipt = transitionReceipt.safeParse(data);
    if (!receipt.success) throw new Error("Invalid transition receipt");
    // A replay may belong to an older cycle. Read the current committed state,
    // never reconstruct it from the submitted target/version or a client clock.
    // Include assigned=false if a manager removed the empty vehicle meanwhile.
    let vehicle: z.infer<typeof vehicleState> | null = null;
    try {
      const current = await measure("read", () =>
        db
          .from("ptc_vehicle_states")
          .select("vehicle_id,state,version,since,cycle,assigned")
          .eq("company_id", actor.companyId)
          .eq("vehicle_id", input.vehicleId)
          .maybeSingle(),
      );
      const parsed = vehicleState.safeParse(current.data);
      if (
        !current.error &&
        parsed.success &&
        parsed.data.vehicle_id === input.vehicleId &&
        parsed.data.version > input.version
      )
        vehicle = parsed.data;
    } catch {
      // The RPC already committed. Keep its verified receipt; require a refresh
      // if the optional current-state read failed instead of claiming write failure.
    }
    return withTiming(
      noStore({
        ...receipt.data,
        vehicle,
        serverTime: new Date().toISOString(),
        refreshRequired: vehicle === null,
      }),
    );
  } catch (error) {
    return withTiming(failed(error));
  }
}
