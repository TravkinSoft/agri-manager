import type { SupabaseClient } from "@supabase/supabase-js";

export async function readVehicleRepairs(db: SupabaseClient, companyId: string, vehicleIds: string[]) {
  const result = new Map<string, { inRepair: boolean; repairVersion: number }>();
  for (let from = 0; from < vehicleIds.length; from += 250) {
    const rows = await db.from("fleet_vehicle_repairs").select("vehicle_id,in_repair,version")
      .eq("company_id", companyId).in("vehicle_id", vehicleIds.slice(from, from + 250));
    if (rows.error) throw rows.error;
    for (const row of rows.data ?? []) result.set(row.vehicle_id, {
      inRepair: row.in_repair, repairVersion: row.version,
    });
  }
  return result;
}
