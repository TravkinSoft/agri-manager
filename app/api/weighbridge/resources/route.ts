import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { isCargoTractor, isCargoVehicle, isTrailerTransport, resolveTransportIdentity } from "@/lib/weighbridge/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEIGHBRIDGE_PERSONNEL_ROLES = ["driver", "mechanic_operator"];

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const [vehiclesRes, machinesRes, peopleRes, legacyDriversRes, profilesRes] = await Promise.all([
      supabase
        .from("reference_vehicles")
        .select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name,type,fleet_type,primary_responsible_personnel_id,is_active,archived,transport_model:transport_model_id(full_name,category)")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("archived", false)
        .order("name", { ascending: true }),
      supabase
        .from("reference_machines")
        .select("id,name,full_name,brand,model,series,license_plate,plate_number,source_raw_name,type,status,is_active,archived")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("archived", false)
        .eq("type", "tractor")
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

    const error = vehiclesRes.error || machinesRes.error || peopleRes.error || legacyDriversRes.error || profilesRes.error;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const vehicleRows = (vehiclesRes.data || []).map((row: any) => {
      const transportModel = Array.isArray(row.transport_model)
        ? row.transport_model[0]
        : row.transport_model;
      const identity = resolveTransportIdentity(row);
      return {
        id: String(row.id),
        name: identity.name,
        model: String(transportModel?.full_name || row.model || row.name || ""),
        plate: identity.plate,
        searchTerms: identity.searchTerms,
        type: String(row.type || ""),
        fleetType: String(row.fleet_type || ""),
        transportCategory: String(transportModel?.category || ""),
        source: "reference_vehicles" as const,
        primaryPersonnelId: row.primary_responsible_personnel_id
          ? String(row.primary_responsible_personnel_id)
          : null,
      };
    });
    const vehicles = [
      ...vehicleRows.filter((row) => isCargoVehicle(row)),
      ...(machinesRes.data || [])
        .filter((row: any) => isCargoTractor(row))
        .map((row: any) => {
          const identity = resolveTransportIdentity(row);
          return {
            id: String(row.id),
            name: identity.name,
            model: String(row.model || row.name || ""),
            plate: identity.plate,
            searchTerms: identity.searchTerms,
            type: "tractor",
            fleetType: "tractor",
            transportCategory: "tractor",
            source: "reference_machines" as const,
            primaryPersonnelId: null,
          };
        }),
    ];
    const trailers = vehicleRows.filter((row) => isTrailerTransport(row));

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
    vehicleRows.forEach((vehicle) => {
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

    return NextResponse.json({ companyId, vehicles, trailers, drivers, driverNames });
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
