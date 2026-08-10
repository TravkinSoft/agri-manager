import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEIGHBRIDGE_PERSONNEL_ROLES = ["driver", "mechanic_operator"];

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const [vehiclesRes, peopleRes, legacyDriversRes, profilesRes] = await Promise.all([
      supabase
        .from("reference_vehicles")
        .select("id,name,custom_name,plate_number,type,fleet_type,primary_responsible_personnel_id,is_active,archived")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("archived", false)
        .order("name", { ascending: true }),
      supabase
        .from("company_people")
        .select("id,full_name,role_type,position,department,status,deleted_at")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null)
        .in("role_type", WEIGHBRIDGE_PERSONNEL_ROLES)
        .order("full_name", { ascending: true }),
      supabase
        .from("reference_specialists")
        .select("id,person_id,full_name,name_ru,name_kz,name_en")
        .eq("company_id", companyId),
      supabase
        .from("profiles")
        .select("id,full_name,email")
        .eq("company_id", companyId),
    ]);

    const error = vehiclesRes.error || peopleRes.error || legacyDriversRes.error || profilesRes.error;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const vehicles = (vehiclesRes.data || []).map((row: any) => ({
      id: String(row.id),
      name: String(row.custom_name || row.name || "Машина"),
      plate: String(row.plate_number || ""),
      type: String(row.type || ""),
      fleetType: String(row.fleet_type || ""),
      primaryPersonnelId: row.primary_responsible_personnel_id
        ? String(row.primary_responsible_personnel_id)
        : null,
    }));

    const legacyPersonById = new Map<string, string>();
    const driverNames: Record<string, string> = {};
    (legacyDriversRes.data || []).forEach((row: any) => {
      const legacyId = String(row.id);
      if (row.person_id) legacyPersonById.set(legacyId, String(row.person_id));
      driverNames[legacyId] = String(
        row.name_ru || row.full_name || row.name_en || row.name_kz || "Водитель"
      );
    });
    (profilesRes.data || []).forEach((row: any) => {
      driverNames[String(row.id)] = String(row.full_name || row.email || "Водитель");
    });

    const byDriver = new Map<string, string[]>();
    vehicles.forEach((vehicle) => {
      if (!vehicle.primaryPersonnelId) return;
      const canonicalPersonId = legacyPersonById.get(vehicle.primaryPersonnelId);
      if (!canonicalPersonId) return;
      const assigned = byDriver.get(canonicalPersonId) || [];
      assigned.push(vehicle.id);
      byDriver.set(canonicalPersonId, assigned);
    });

    const drivers = (peopleRes.data || []).map((row: any) => {
      const id = String(row.id);
      const name = String(row.full_name || "Сотрудник");
      driverNames[id] = name;
      return {
      id: String(row.id),
      name,
      machineId: null as string | null,
      roleType: String(row.role_type),
      position: String(row.position || ""),
      department: String(row.department || ""),
      assignedVehicleIds: byDriver.get(id) || [],
    };
    });

    return NextResponse.json({ companyId, vehicles, drivers, driverNames });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load weighbridge resources" },
      { status: 500 }
    );
  }
}
