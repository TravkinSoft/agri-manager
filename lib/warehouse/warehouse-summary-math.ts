export type CanonicalWarehouseMassRow = {
  warehouse_id: string | null;
  quantity: number | string | null;
  uom: string | null;
  batch_class?: string | null;
};

export type WarehouseMassBreakdown = {
  totalWeightKg: number;
  harvestWeightKg: number;
  seedWeightKg: number;
  otherMaterialWeightKg: number;
};

export function isCanonicalMassKg(uom: unknown): boolean {
  const normalized = String(uom ?? "").trim().toLowerCase();
  return normalized === "kg" || normalized === "legacy/kg";
}

export function buildWarehouseMassBreakdown(
  rows: CanonicalWarehouseMassRow[],
  harvestWeightByWarehouse: ReadonlyMap<string, number>
): Map<string, WarehouseMassBreakdown> {
  const result = new Map<string, WarehouseMassBreakdown>();

  for (const row of rows) {
    const warehouseId = String(row.warehouse_id || "");
    const quantity = Number(row.quantity || 0);
    if (!warehouseId || !isCanonicalMassKg(row.uom) || !Number.isFinite(quantity) || quantity <= 0.000001) continue;

    const current = result.get(warehouseId) || {
      totalWeightKg: 0,
      harvestWeightKg: Math.max(0, Number(harvestWeightByWarehouse.get(warehouseId) || 0)),
      seedWeightKg: 0,
      otherMaterialWeightKg: 0,
    };
    current.totalWeightKg += quantity;
    if (String(row.batch_class || "").trim().toLowerCase() === "seed") current.seedWeightKg += quantity;
    result.set(warehouseId, current);
  }

  harvestWeightByWarehouse.forEach((harvestWeight, warehouseId) => {
    const current = result.get(warehouseId) || {
      totalWeightKg: 0,
      harvestWeightKg: 0,
      seedWeightKg: 0,
      otherMaterialWeightKg: 0,
    };
    current.harvestWeightKg = Math.max(0, Number(harvestWeight || 0));
    current.otherMaterialWeightKg = Math.max(
      0,
      current.totalWeightKg - current.harvestWeightKg - current.seedWeightKg
    );
    result.set(warehouseId, current);
  });

  result.forEach((current) => {
    current.otherMaterialWeightKg = Math.max(
      0,
      current.totalWeightKg - current.harvestWeightKg - current.seedWeightKg
    );
  });

  return result;
}

export function warehouseCapacityPercent(totalWeightKg: number, capacityKg: number | null): number | null {
  if (!capacityKg || capacityKg <= 0 || totalWeightKg <= 0) return null;
  return Math.round((totalWeightKg / capacityKg) * 100);
}
