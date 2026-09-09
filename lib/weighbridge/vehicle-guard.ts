export type WeighbridgeVehicleSource = "reference_vehicles" | "reference_machines";

export type WeighbridgeVehicleGuardRow = {
  id?: unknown;
  source_machine_id?: unknown;
};

export type WeighbridgeVehicleSelection = {
  source: WeighbridgeVehicleSource;
  row: WeighbridgeVehicleGuardRow & Record<string, unknown>;
};

export function requestedWeighbridgeVehicleSource(value: unknown): WeighbridgeVehicleSource {
  return value === "reference_machines" ? "reference_machines" : "reference_vehicles";
}

export function selectWeighbridgeVehicle(params: {
  requestedId: unknown;
  requestedSource: WeighbridgeVehicleSource;
  vehicleRow: (WeighbridgeVehicleGuardRow & Record<string, unknown>) | null | undefined;
  machineRow: (WeighbridgeVehicleGuardRow & Record<string, unknown>) | null | undefined;
}): WeighbridgeVehicleSelection | null {
  const requestedId = String(params.requestedId || "");
  const vehicleRow = String(params.vehicleRow?.id || "") === requestedId ? params.vehicleRow : null;
  const machineRow = String(params.machineRow?.id || "") === requestedId ? params.machineRow : null;

  if (params.requestedSource === "reference_machines") {
    if (machineRow) return { source: "reference_machines", row: machineRow };
    if (vehicleRow) return { source: "reference_vehicles", row: vehicleRow };
    return null;
  }

  if (vehicleRow) return { source: "reference_vehicles", row: vehicleRow };
  if (machineRow) return { source: "reference_machines", row: machineRow };
  return null;
}

export function physicalWeighbridgeVehicleIds(
  selection: WeighbridgeVehicleSelection,
  projectionRows: WeighbridgeVehicleGuardRow[] = []
): string[] {
  const ids = new Set<string>();
  const selectedId = String(selection.row.id || "");
  if (selectedId) ids.add(selectedId);

  const canonicalMachineId = selection.source === "reference_machines"
    ? selectedId
    : String(selection.row.source_machine_id || "");
  if (canonicalMachineId) ids.add(canonicalMachineId);

  projectionRows.forEach((row) => {
    if (canonicalMachineId && String(row.source_machine_id || "") !== canonicalMachineId) return;
    const id = String(row.id || "");
    if (id) ids.add(id);
  });

  return Array.from(ids);
}
