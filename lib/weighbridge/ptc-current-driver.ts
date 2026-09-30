import { activeAssignedDriverName, vehicleAllowsMachineOperator } from "@/lib/vehicles/driver-name";

type Vehicle = {
  id: string;
  type?: unknown;
  fleet_type?: unknown;
  primary_responsible_personnel_id?: unknown;
};

export function currentPtcDriver(vehicle: Vehicle, specialist: any, companyId: string) {
  if (!specialist || specialist.company_id !== companyId ||
    String(specialist.id) !== String(vehicle.primary_responsible_personnel_id || "")) return null;
  const name = activeAssignedDriverName(specialist, companyId, vehicleAllowsMachineOperator(vehicle));
  const person = Array.isArray(specialist.person) ? specialist.person[0] : specialist.person;
  return name && person?.id ? { id: String(person.id), name } : null;
}

/** Same-tenant active assignments only. Historical load events remain unchanged. */
export async function loadCurrentPtcDrivers(db: any, companyId: string, vehicles: Vehicle[]) {
  const ids = Array.from(new Set(vehicles.map(row => String(row.primary_responsible_personnel_id || "")).filter(Boolean)));
  if (!ids.length) return new Map<string, { id: string; name: string }>();
  const { data, error } = await db.from("reference_specialists")
    .select("id,company_id,personnel_type,status,archived,person:person_id(id,full_name,company_id,role_type,status,deleted_at)")
    .eq("company_id", companyId).in("id", ids);
  if (error) throw error;
  const byId = new Map((data || []).map((row: any) => [String(row.id), row]));
  const drivers = new Map<string, { id: string; name: string }>();
  for (const vehicle of vehicles) {
    const driver = currentPtcDriver(vehicle, byId.get(String(vehicle.primary_responsible_personnel_id || "")), companyId);
    if (driver) drivers.set(String(vehicle.id), driver);
  }
  return drivers;
}

export async function loadCurrentPtcDriver(db: any, companyId: string, vehicleId: string) {
  const { data, error } = await db.from("reference_vehicles")
    .select("id,type,fleet_type,primary_responsible_personnel_id")
    .eq("company_id", companyId).eq("id", vehicleId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await loadCurrentPtcDrivers(db, companyId, [data])).get(vehicleId) || null;
}
