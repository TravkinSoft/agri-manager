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
  batch_class?: string | null;
  material_quantity?: number | null;
};

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
