import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import {
  failed,
  manager,
  noStore,
  readSnapshot,
  sameOrigin,
  TrafficError,
} from "@/lib/traffic/server";
import { hashPassword, newCredential } from "@/lib/traffic/credentials";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("configure"),
      enabled: z.boolean(),
      fieldId: z.string().uuid().nullable(),
      vehicleIds: z.array(z.string().uuid()).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("issue"),
      personId: z.string().uuid(),
      role: z.enum(["harvester", "receiver"]),
    })
    .strict(),
  z
    .object({ action: z.literal("revoke"), accessId: z.string().uuid() })
    .strict(),
]);
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
    const { companyId } = await manager(request);
    const db = getServiceClient();
    if (request.nextUrl.searchParams.get("snapshot") === "1")
      return noStore({
        snapshot: await readSnapshot(companyId, "manager", ""),
      });
    const [snapshot, fleet, people, fields, access] = await Promise.all([
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
          .select("id,full_name")
          .eq("company_id", companyId)
          .eq("status", "active")
          .is("deleted_at", null)
          .order("full_name")
          .order("id")
          .range(from, to),
      ),
      allRows((from, to) =>
        db
          .from("fields")
          .select("id,name")
          .eq("company_id", companyId)
          .eq("archived", false)
          .order("name")
          .order("id")
          .range(from, to),
      ),
      allRows((from, to) =>
        db
          .from("ptc_access")
          .select("id,person_id,role,login,created_at,revoked_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
    ]);
    return noStore({ snapshot, fleet, people, fields, access });
  } catch (error) {
    return failed(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { actor, companyId } = await manager(request);
    const input = command.parse(await request.json());
    const db = getServiceClient();
    if (input.action === "configure") {
      const { error } = await db.rpc("ptc_configure_v1", {
        p_company: companyId,
        p_enabled: input.enabled,
        p_field: input.fieldId,
        p_vehicles: input.vehicleIds,
      });
      if (error) throw new Error(error.message);
    } else if (input.action === "issue") {
      const { data: person, error } = await db
        .from("company_people")
        .select("id")
        .eq("id", input.personId)
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!person)
        throw new TrafficError(
          "Выберите действующего сотрудника компании",
          403,
        );
      const credential = newCredential();
      const { error: insertError } = await db.from("ptc_access").insert({
        company_id: companyId,
        person_id: input.personId,
        role: input.role,
        login: credential.login,
        password_hash: await hashPassword(credential.password),
        created_by: actor.id,
      });
      if (insertError?.code === "23505")
        throw new TrafficError(
          "У сотрудника уже есть доступ. Сначала отзовите прежний",
          409,
        );
      if (insertError) throw insertError;
      return noStore({ credential }, 201);
    } else {
      const { data, error } = await db
        .from("ptc_access")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", input.accessId)
        .eq("company_id", companyId)
        .is("revoked_at", null)
        .select("id");
      if (error) throw error;
      if (!data?.length)
        throw new TrafficError("Доступ не найден или уже отозван", 404);
      // Every request and atomic transition checks grant.revoked_at; no session can outlive revocation.
    }
    return noStore({ ok: true });
  } catch (error) {
    return failed(error);
  }
}
