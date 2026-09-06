import { getServiceClient } from "@/lib/supabase/service";
import { activeAssignedDriverName, vehicleAllowsMachineOperator } from "@/lib/vehicles/driver-name";
import { readVehicleRepairs } from "./repairs-server";
import type { FleetVehicle } from "./model";
import { isPtcEligibleReferenceVehicle, ptcVehicleDisplayPlate } from "@/lib/traffic/vehicle-eligibility";

// Shared catalogue for references and the off-line drawer; never truncate the fleet.
export async function readCompanyFleet(db: ReturnType<typeof getServiceClient>, companyId: string): Promise<FleetVehicle[]> {
  const vehicles: FleetVehicle[] = [];
  for (let from = 0; ; from += 250) {
    const result = await db.from("reference_vehicles")
      .select("id,name,brand,model,license_plate,plate_number,type,fleet_type,import_source,inventory_number,source_raw_name,source_clean_name,source_machine_id,ptc_enabled,primary_responsible_personnel_id,transport_model:transport_model_id(category)")
      .eq("company_id", companyId).eq("ptc_enabled", true).eq("is_active", true).eq("archived", false)
      .order("name").order("id").range(from, from + 249);
    if (result.error) throw result.error;
    const sourceRows = result.data ?? [];
    if (!sourceRows.length) break;
    const rows = sourceRows.filter(isPtcEligibleReferenceVehicle);
    if (!rows.length) {
      if (sourceRows.length < 250) break;
      continue;
    }
    const ids = Array.from(new Set(rows.flatMap(row => row.primary_responsible_personnel_id ? [String(row.primary_responsible_personnel_id)] : [])));
    const vehicleIds = rows.map(row => String(row.id));
    const [repairs, assignments, traffic] = await Promise.all([
      readVehicleRepairs(db, companyId, vehicleIds),
      ids.length ? db.from("reference_specialists")
        .select("id,personnel_type,status,archived,person:person_id(full_name,company_id,role_type,status,deleted_at)")
        .eq("company_id", companyId).in("id", ids) : { data: [], error: null },
      db.from("ptc_vehicle_states").select("vehicle_id,assigned,state,since")
        .eq("company_id", companyId).in("vehicle_id", vehicleIds),
    ]);
    if (assignments.error) throw assignments.error;
    if (traffic.error) throw traffic.error;
    const driverAssignments = new Map((assignments.data ?? []).map(row => [String(row.id), row]));
    const states = new Map((traffic.data ?? []).map(row => [String(row.vehicle_id), row]));
    vehicles.push(...rows.map(row => ({
      id: String(row.id), name: row.name || [row.brand, row.model].filter(Boolean).join(" ") || "Машина",
      plate: ptcVehicleDisplayPlate(row),
      driver: activeAssignedDriverName(
        driverAssignments.get(String(row.primary_responsible_personnel_id ?? "")),
        companyId,
        vehicleAllowsMachineOperator(row),
      ),
      inRepair: repairs.get(String(row.id))?.inRepair ?? false,
      repairVersion: repairs.get(String(row.id))?.repairVersion ?? 0,
      assigned: states.get(String(row.id))?.assigned ?? false,
      state: states.get(String(row.id))?.state ?? "empty",
      lastActivity: states.get(String(row.id))?.since ?? null,
    })));
    if (sourceRows.length < 250) break;
  }
  return vehicles;
}
