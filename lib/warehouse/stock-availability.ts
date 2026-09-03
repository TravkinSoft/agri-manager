import type { HarvestBatchSummary } from "../types/weighbridge";
import type { InventoryBalance, Warehouse } from "../types/warehouse";
import { normalizeStoragePlaceType } from "./warehouse-scope";

export type WarehouseView = "availability" | "warehouses";
export const parseWarehouseView = (value: unknown): WarehouseView => value === "warehouses" ? "warehouses" : "availability";
export const warehouseViewKey = (userId: string, companyId: string) =>
  `travkin.warehouses.view.v1:${encodeURIComponent(userId)}:${encodeURIComponent(companyId)}`;

export function compareStoragePlaces(a: Pick<Warehouse, "id" | "name" | "place_type">, b: Pick<Warehouse, "id" | "name" | "place_type">) {
  const rank = (place: typeof a) => ({ YARD: 0, WAREHOUSE: 1, CLEANER: 2, DRYER: 2 })[normalizeStoragePlaceType(place.place_type)];
  return rank(a) - rank(b) || a.name.localeCompare(b.name, "ru", { numeric: true }) || a.id.localeCompare(b.id);
}

export type AvailabilityPosition = {
  key: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  batch?: HarvestBatchSummary;
  material?: InventoryBalance;
};
export type AvailabilityIdentity = {
  key: string;
  label: string;
  unit: string;
  quantity: number;
  positions: AvailabilityPosition[];
};
export type AvailabilityCrop = { key: string; name: string; identities: AvailabilityIdentity[] };
export type AvailabilityAnomaly = { key: string; message: string };

const componentLabel = (batchClass: string, state: string) => {
  if (batchClass === "waste") return state === "SCREENINGS" ? "Отсев" : "Отходы";
  if (batchClass === "seed") return "Семена";
  if (state === "AFTER_CLEANING") return "После очистки";
  if (state === "AFTER_DRYING") return "После сушки";
  return batchClass === "commodity" ? "" : batchClass;
};

/** Presentation over canonical current-stock DTOs. Never sum source trips or companyCurrentKg.
 * Lot UUID already encodes season/composition/provisional identity; do not re-key it by labels.
 * Materials use only the existing material_quantity remainder, not harvest represented twice.
 */
export function buildStockAvailability(companyId: string, warehouses: Warehouse[], batches: HarvestBatchSummary[], balances: InventoryBalance[]) {
  const allowed = new Map(warehouses.filter((w) => w.company_id === companyId).map((w) => [w.id, w]));
  const crops = new Map<string, AvailabilityCrop>();
  const identities = new Map<string, AvailabilityIdentity>();
  const seen = new Set<string>();
  const anomalies: AvailabilityAnomaly[] = [];
  const add = (cropKey: string, cropName: string, identityKey: string, label: string, unit: string, position: AvailabilityPosition) => {
    if (!Number.isFinite(position.quantity) || position.quantity < -0.000001) {
      anomalies.push({ key: position.key, message: `${position.warehouseName} · ${cropName} · ${label}: ${Number.isFinite(position.quantity) ? `отрицательный остаток ${position.quantity} ${unit}` : "некорректный остаток"}` });
      return;
    }
    if (position.quantity <= 0.000001) return;
    if (seen.has(position.key)) {
      anomalies.push({ key: `duplicate:${position.key}`, message: `${position.warehouseName}: повтор позиции остатка; повтор не включён в итог.` });
      return;
    }
    seen.add(position.key);
    let crop = crops.get(cropKey);
    if (!crop) { crop = { key: cropKey, name: cropName, identities: [] }; crops.set(cropKey, crop); }
    let identity = identities.get(identityKey);
    if (!identity) {
      identity = { key: identityKey, label, unit, quantity: 0, positions: [] };
      identities.set(identityKey, identity);
      crop.identities.push(identity);
    }
    identity.quantity += position.quantity;
    identity.positions.push(position);
  };
  const checkWarehouse = (id: string) => {
    if (allowed.has(id)) return true;
    if (!anomalies.some((a) => a.key === `unavailable:${id}`)) anomalies.push({ key: `unavailable:${id}`, message: "Часть остатков относится к объекту вне доступного списка. Проверьте доступ и архив объектов." });
    return false;
  };
  for (const batch of batches) {
    if (!checkWarehouse(batch.warehouseId)) continue;
    const components = batch.stockComponents?.length ? batch.stockComponents : [{ batchClass: "commodity", physicalState: "SOURCE", quantityKg: batch.cleanMassKg }];
    for (const component of components) {
      const lotId = batch.aggregateLotId || batch.id;
      const key = JSON.stringify(["lot", lotId, component.batchClass, component.physicalState, "kg"]);
      const label = [batch.varietyName || "Сорт не указан", batch.reproductionName || "Репродукция не указана", componentLabel(component.batchClass, component.physicalState), batch.reviewState === "requires_review" ? "Требует уточнения" : ""].filter(Boolean).join(" · ");
      add(`crop:${batch.cropId || lotId}`, batch.cropName, key, label, "kg", {
        key: `${key}:${batch.warehouseId}`, warehouseId: batch.warehouseId,
        warehouseName: allowed.get(batch.warehouseId)!.name, quantity: component.quantityKg, batch,
      });
    }
  }
  for (const row of balances) {
    if (!checkWarehouse(row.warehouse_id)) continue;
    if (!Number.isFinite(row.quantity) || row.quantity < -0.000001) {
      anomalies.push({ key: `ledger:${row.warehouse_id}:${row.product_id}:${row.unit}:${row.batch_class}`, message: `${allowed.get(row.warehouse_id)!.name} · ${row.product_name}: ${Number.isFinite(row.quantity) ? `отрицательный складской остаток ${row.quantity} ${row.unit}` : "некорректный складской остаток"}` });
    }
    // Fail visible if an older/incomplete DTO cannot distinguish harvest from materials.
    if (row.material_quantity == null || !Number.isFinite(row.material_quantity)) {
      anomalies.push({ key: `material:${row.warehouse_id}:${row.product_id}`, message: `${allowed.get(row.warehouse_id)!.name}: не удалось отделить материальный остаток от урожая.` });
      continue;
    }
    const key = JSON.stringify(["material", row.product_id, row.variety_id, row.reproduction_id, row.batch_class, row.unit]);
    add(`material:${row.product_id}`, row.product_name, key, [row.variety_name, row.reproduction_name, row.batch_class === "seed" ? "Семена" : row.batch_class === "waste" ? "Отходы" : "Материал"].filter(Boolean).join(" · "), row.unit, {
      key: `${key}:${row.warehouse_id}`, warehouseId: row.warehouse_id, warehouseName: allowed.get(row.warehouse_id)!.name,
      quantity: row.material_quantity, material: { ...row, quantity: row.material_quantity },
    });
  }
  for (const crop of Array.from(crops.values())) {
    crop.identities.sort((a, b) => a.label.localeCompare(b.label, "ru") || a.key.localeCompare(b.key));
    for (const identity of crop.identities) {
      identity.quantity = Number(identity.quantity.toFixed(3));
      identity.positions.sort((a, b) => compareStoragePlaces(allowed.get(a.warehouseId)!, allowed.get(b.warehouseId)!));
    }
  }
  return { crops: Array.from(crops.values()).sort((a, b) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key)), anomalies };
}
