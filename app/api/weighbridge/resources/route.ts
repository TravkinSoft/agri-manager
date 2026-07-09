import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIVER_PERSONNEL_TYPES = [
  "driver",
  "machine_operator",
  "combine_operator",
  "worker",
  "responsible",
];

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const [vehiclesRes, driversRes] = await Promise.all([
      supabase
        .from("reference_vehicles")
        .select("id,name,custom_name,plate_number,primary_responsible_personnel_id,is_active,archived")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("archived", false)
        .order("name", { ascending: true }),
      supabase
        .from("reference_specialists")
        .select("id,full_name,name_ru,name_kz,name_en,personnel_type,status,archived")
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("status", "active")
        .in("personnel_type", DRIVER_PERSONNEL_TYPES)
        .order("full_name", { ascending: true }),
    ]);

    const error = vehiclesRes.error || driversRes.error;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const vehicles = (vehiclesRes.data || []).map((row: any) => ({
      id: String(row.id),
      name: String(row.custom_name || row.name || "Машина"),
      plate: String(row.plate_number || ""),
      primaryPersonnelId: row.primary_responsible_personnel_id
        ? String(row.primary_responsible_personnel_id)
        : null,
    }));

    const byDriver = new Map<string, string[]>();
    vehicles.forEach((vehicle) => {
      if (!vehicle.primaryPersonnelId) return;
      const assigned = byDriver.get(vehicle.primaryPersonnelId) || [];
      assigned.push(vehicle.id);
      byDriver.set(vehicle.primaryPersonnelId, assigned);
    });

    const drivers = (driversRes.data || []).map((row: any) => ({
      id: String(row.id),
      name: String(row.name_ru || row.full_name || row.name_en || row.name_kz || "Ответственный"),
      machineId: null as string | null,
      personnelType: row.personnel_type ? String(row.personnel_type) : null,
      assignedVehicleIds: byDriver.get(String(row.id)) || [],
    }));

    return NextResponse.json({ companyId, vehicles, drivers });
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
