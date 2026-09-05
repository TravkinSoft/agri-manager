import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore } from "@/lib/traffic/server";
import { activeAssignedDriverName } from "@/lib/vehicles/driver-name";
import type { FleetVehicle } from "@/lib/fleet/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });
    if (!["fleet_manager", "company_admin", "global_admin"].includes(actor.role)) {
      throw new SessionAuthError("Кабинет доступен заведующему автопарком и администратору", 403);
    }
    const requestedCompany = z.string().uuid().nullable().parse(request.nextUrl.searchParams.get("companyId"));
    const companyId = resolveCompanyForActor(actor, requestedCompany);
    const db = getServiceClient();
    await assertActorAccess({
      supabase: db, actorUserId: actor.id, companyId,
      allowedRoles: ["fleet_manager", "company_admin", "global_admin"],
    });
    const vehicles: FleetVehicle[] = [];
    // Page both fleet and assignment lookup; never silently truncate at PostgREST's row limit.
    for (let from = 0; ; from += 250) {
      const result = await db.from("reference_vehicles")
        .select("id,name,brand,model,license_plate,plate_number,primary_responsible_personnel_id")
        .eq("company_id", companyId).eq("is_active", true).eq("archived", false)
        .order("name").order("id").range(from, from + 249);
      if (result.error) throw result.error;
      const rows = result.data ?? [];
      const ids = Array.from(new Set(rows.flatMap(row => row.primary_responsible_personnel_id
        ? [String(row.primary_responsible_personnel_id)] : [])));
      const assignments = ids.length ? await db.from("reference_specialists")
        .select("id,personnel_type,status,archived,person:person_id(full_name,company_id,role_type,status,deleted_at)")
        .eq("company_id", companyId).in("id", ids) : { data: [], error: null };
      if (assignments.error) throw assignments.error;
      const drivers = new Map((assignments.data ?? []).map(row =>
        [String(row.id), activeAssignedDriverName(row, companyId)]));
      vehicles.push(...rows.map(row => ({
        id: String(row.id),
        name: row.name || [row.brand, row.model].filter(Boolean).join(" ") || "Машина",
        plate: row.license_plate || row.plate_number || null,
        driver: drivers.get(String(row.primary_responsible_personnel_id ?? "")) ?? null,
      })));
      if (rows.length < 250) break;
    }
    return noStore({ companyId, vehicles });
  } catch (error) {
    return failed(error);
  }
}
