type VehicleRoleScope = {
  type?: unknown;
  fleet_type?: unknown;
  fleetType?: unknown;
};

// Only a real agricultural tractor may use a mechanic_operator as its
// permanent driver. PTC membership alone is intentionally insufficient.
export function vehicleAllowsMachineOperator(vehicle: VehicleRoleScope | null | undefined): boolean {
  return String(vehicle?.type ?? "").toLowerCase() === "tractor" ||
    String(vehicle?.fleet_type ?? vehicle?.fleetType ?? "").toLowerCase() === "tractor";
}

// The compatibility reference stores an ID, not the authoritative employee name/status.
// Default remains driver-only; callers must opt in for a verified tractor row.
export function activeAssignedDriverName(
  value: unknown,
  companyId: string,
  allowMachineOperator = false,
): string | null {
  const specialist = Array.isArray(value) ? value[0] : value;
  if (!specialist || typeof specialist !== "object") return null;
  const row = specialist as Record<string, unknown>;
  if (row.archived !== false || row.status !== "active" ||
    (row.personnel_type !== "driver" &&
      !(allowMachineOperator && row.personnel_type === "machine_operator"))) return null;
  const person = Array.isArray(row.person) ? row.person[0] : row.person;
  if (!person || typeof person !== "object") return null;
  const current = person as Record<string, unknown>;
  if (current.company_id !== companyId || current.status !== "active" ||
    current.deleted_at !== null) return null;
  const compatible =
    (row.personnel_type === "driver" && current.role_type === "driver") ||
    (row.personnel_type === "machine_operator" && current.role_type === "mechanic_operator");
  if (!compatible) return null;
  return typeof current.full_name === "string" && current.full_name.trim() ? current.full_name : null;
}
