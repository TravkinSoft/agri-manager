export type WarehouseScopedHarvestBatch = {
  id: string;
  warehouseId: string;
};

/**
 * Aggregate harvest lot ids are company-wide identities and can legitimately
 * appear in several warehouses at once. A warehouse detail selection therefore
 * has to be matched by the compound location identity, never by lot id alone.
 */
export function findWarehouseScopedHarvestBatch<T extends WarehouseScopedHarvestBatch>(
  batches: readonly T[],
  selected: WarehouseScopedHarvestBatch
): T | undefined {
  return batches.find((batch) => (
    batch.id === selected.id && batch.warehouseId === selected.warehouseId
  ));
}

type WarehouseHarvestPosition = {
  productId: string;
  productIds?: string[];
  stockComponents?: Array<{ batchClass: string }>;
};

type WarehouseMaterialPosition = {
  product_id: string;
  product_ids?: string[];
  uom?: string | null;
  batch_class?: string | null;
  material_quantity?: number | null;
};

export function countColdWarehousePositions(
  harvestLotIds: readonly string[],
  materialBalances: readonly WarehouseMaterialPosition[]
): number {
  const harvestLots = new Set(harvestLotIds.map((value) => String(value || "").trim()).filter(Boolean));
  const materialPositions = new Set(materialBalances.flatMap((row) => {
    if (Number(row.material_quantity || 0) <= 0.000001) return [];
    const productIds = row.product_ids?.length ? row.product_ids : [row.product_id];
    const batchClass = String(row.batch_class || "commodity").trim().toLowerCase() || "commodity";
    const uom = String(row.uom || "").trim().toLowerCase();
    return productIds.filter(Boolean).map((productId) => `${productId}|${batchClass}|${uom}`);
  }));
  return harvestLots.size + materialPositions.size;
}

function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function warehousePositionCountLabel(count: number, harvestLotCount?: number | null): string {
  const normalized = Math.max(0, Math.trunc(Number(count) || 0));
  const neutral = `${normalized} ${pluralRu(normalized, "позиция", "позиции", "позиций")}`;
  if (harvestLotCount == null) return neutral;

  const rawHarvestLots = Number(harvestLotCount);
  if (!Number.isInteger(rawHarvestLots) || rawHarvestLots < 0 || rawHarvestLots > normalized) return neutral;
  if (normalized === 0) return neutral;

  const materialPositions = normalized - rawHarvestLots;
  const parts: string[] = [];
  if (rawHarvestLots > 0) {
    parts.push(`${rawHarvestLots} ${pluralRu(rawHarvestLots, "партия", "партии", "партий")}`);
  }
  if (materialPositions > 0) {
    parts.push(`${materialPositions} ${pluralRu(
      materialPositions,
      "позиция материала",
      "позиции материалов",
      "позиций материалов",
    )}`);
  }
  return parts.join(" · ") || neutral;
}

export function countVisibleWarehousePositions(
  harvestBatches: readonly WarehouseHarvestPosition[],
  materialBalances: readonly WarehouseMaterialPosition[]
): number {
  const representedKeys = new Set(harvestBatches.flatMap((batch) => {
    const productIds = (batch.productIds?.length ? batch.productIds : [batch.productId]).filter(Boolean);
    const batchClasses = Array.from(new Set(
      (batch.stockComponents || []).map((component) => String(component.batchClass || "commodity").toLowerCase())
    ));
    return productIds.flatMap((productId) => (batchClasses.length ? batchClasses : ["commodity"])
      .map((batchClass) => `${productId}|${batchClass}`));
  }));
  const visibleMaterials = materialBalances.filter((row) => {
    if (Number.isFinite(Number(row.material_quantity))) {
      return Number(row.material_quantity || 0) > 0.000001;
    }
    const batchClass = String(row.batch_class || "commodity").toLowerCase();
    if (batchClass === "seed") return true;
    const productIds = row.product_ids?.length ? row.product_ids : [row.product_id];
    return !productIds.some((productId) => representedKeys.has(`${productId}|${batchClass}`));
  });
  return harvestBatches.length + visibleMaterials.length;
}
