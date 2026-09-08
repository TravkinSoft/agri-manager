type WarehouseOrderable = {
  id: string;
  name?: string | null;
  display_order?: number | null;
};

export const WAREHOUSE_ORDER_MAX_ITEMS = 500;

export function normalizeWarehouseDisplayOrder(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

export function compareWarehouseDisplayOrder<T extends WarehouseOrderable>(
  left: T,
  right: T,
  fallback?: (left: T, right: T) => number,
): number {
  const leftOrder = normalizeWarehouseDisplayOrder(left.display_order);
  const rightOrder = normalizeWarehouseDisplayOrder(right.display_order);

  if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftOrder != null && rightOrder == null) return -1;
  if (leftOrder == null && rightOrder != null) return 1;

  const fallbackResult = fallback?.(left, right) || 0;
  if (fallbackResult !== 0) return fallbackResult;

  const nameResult = String(left.name || "").localeCompare(String(right.name || ""), "ru");
  return nameResult || String(left.id).localeCompare(String(right.id));
}

export function moveWarehouseId(
  warehouseIds: readonly string[],
  sourceId: string,
  targetId: string,
): string[] {
  const sourceIndex = warehouseIds.indexOf(sourceId);
  const targetIndex = warehouseIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...warehouseIds];

  const next = [...warehouseIds];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function moveWarehouseIdByOffset(
  warehouseIds: readonly string[],
  warehouseId: string,
  offset: -1 | 1,
): string[] {
  const currentIndex = warehouseIds.indexOf(warehouseId);
  if (currentIndex < 0) return [...warehouseIds];
  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= warehouseIds.length) return [...warehouseIds];
  return moveWarehouseId(warehouseIds, warehouseId, warehouseIds[targetIndex]);
}

export function reconcileWarehouseOrder(
  orderedWarehouseIds: readonly string[],
  availableWarehouseIds: readonly string[],
): string[] {
  const available = new Set(availableWarehouseIds);
  const retained = orderedWarehouseIds.filter((warehouseId) => available.has(warehouseId));
  const retainedSet = new Set(retained);
  return [...retained, ...availableWarehouseIds.filter((warehouseId) => !retainedSet.has(warehouseId))];
}

export function withWarehouseDisplayOrder<T extends WarehouseOrderable>(
  warehouses: readonly T[],
  orderedWarehouseIds: readonly string[],
): T[] {
  const orderById = new Map(orderedWarehouseIds.map((warehouseId, index) => [warehouseId, index + 1]));
  return warehouses.map((warehouse) => {
    const displayOrder = orderById.get(warehouse.id);
    return displayOrder == null ? warehouse : { ...warehouse, display_order: displayOrder };
  });
}
