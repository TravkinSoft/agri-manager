/** Approved accounting documents. Never map these to synthetic tickets/trips. */
export type ImpurityAdjustment = {
  id: string;
  shift_id: string;
  accounting_at: string;
  created_at: string;
  document_no: string;
  warehouse_id: string;
  crop_structure_id: string;
  field_id: string;
  crop_id: string;
  variety_id: string | null;
  reproduction_id: string | null;
  quantity_kg: number;
  reason: string;
  reversed_at?: string | null;
};

export function periodImpurityAdjustments(
  rows: ImpurityAdjustment[],
  period: { start: string; end: string },
  filters: { fieldId?: string | null; warehouseId?: string | null; cropId?: string | null; varietyId?: string | null; reproductionId?: string | null },
) {
  const start = Date.parse(period.start), end = Date.parse(period.end);
  const selected = Array.from(new Map(rows.map(row => [row.id, row])).values()).filter(row => {
    const time = Date.parse(row.accounting_at);
    return row.reversed_at == null && time >= start && time < end
      && (!filters.fieldId || row.field_id === filters.fieldId)
      && (!filters.warehouseId || row.warehouse_id === filters.warehouseId)
      && (!filters.cropId || row.crop_id === filters.cropId)
      && (!filters.varietyId || row.variety_id === filters.varietyId)
      && (!filters.reproductionId || row.reproduction_id === filters.reproductionId);
  });
  if (selected.some(row => row.quantity_kg == null || !Number.isFinite(Number(row.quantity_kg)) || Number(row.quantity_kg) <= 0)) {
    throw new Error("Не определена масса корректировки примесей");
  }
  return { kg: selected.reduce((sum, row) => sum + Math.round(Number(row.quantity_kg) * 1000), 0) / 1000, documents: selected };
}
