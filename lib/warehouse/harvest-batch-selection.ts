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
