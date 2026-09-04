import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import {
  failed,
  manager,
  noStore,
  readSnapshot,
  sameOrigin,
} from "@/lib/traffic/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z
  .object({
    action: z.literal("configure"),
    enabled: z.boolean(),
    fieldId: z.string().uuid().nullable(),
    vehicleIds: z.array(z.string().uuid()).max(100),
  })
  .strict();
async function allRows(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}
export async function GET(request: NextRequest) {
  try {
    const { actor, companyId } = await manager(request);
    const db = getServiceClient();
    if (request.nextUrl.searchParams.get("snapshot") === "1")
      return noStore({
        snapshot: await readSnapshot(companyId, "manager", ""),
      });
    const [snapshot, fleet, people, accounts] = await Promise.all([
      readSnapshot(companyId, "manager", ""),
      allRows((from, to) =>
        db
          .from("reference_vehicles")
          .select("id,name,brand,model,license_plate,plate_number")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .eq("archived", false)
          .order("name")
          .order("id")
          .range(from, to),
      ),
      allRows((from, to) =>
        db
          .from("company_people")
          .select("id,full_name,user_id")
          .eq("company_id", companyId)
          .eq("status", "active")
          .is("deleted_at", null)
          .order("full_name")
          .order("id")
          .range(from, to),
      ),
      allRows((from, to) =>
        db
          .from("profiles")
          .select("id,full_name,role,status")
          .eq("company_id", companyId)
          .in("role", ["mechanic_operator", "vegetable_brigadier"])
          .order("full_name")
          .order("id")
          .range(from, to),
      ),
    ]);
    return noStore({
      snapshot,
      fleet,
      people,
      // Keep old open clients compatible without fetching the field catalog.
      fields: [],
      accounts,
      canManageUsers:
        actor.role === "global_admin" || actor.role === "company_admin",
    });
  } catch (error) {
    return failed(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { companyId } = await manager(request);
    const input = command.parse(await request.json());
    const { error } = await getServiceClient().rpc("ptc_configure_v1", {
      p_company: companyId,
      p_enabled: input.enabled,
      p_field: input.fieldId,
      p_vehicles: input.vehicleIds,
    });
    if (error) throw new Error(error.message);
    return noStore({ ok: true });
  } catch (error) {
    return failed(error);
  }
}
