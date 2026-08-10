export type WeighbridgeFastRepeatContext = {
  fieldId: string;
  cropStructureAllocationId: string;
  warehouseToId: string;
};

const STORAGE_PREFIX = "travkin.weighbridge.fastRepeat.v1";

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function weighbridgeFastRepeatStorageKey(
  companyId: string | null | undefined,
  activeShiftId: string | null | undefined
) {
  const company = clean(companyId);
  const shift = clean(activeShiftId);
  return company && shift ? `${STORAGE_PREFIX}.${company}.${shift}` : "";
}

export function pickWeighbridgeFastRepeatContext(
  value: Partial<WeighbridgeFastRepeatContext>
): WeighbridgeFastRepeatContext {
  return {
    fieldId: clean(value.fieldId),
    cropStructureAllocationId: clean(value.cropStructureAllocationId),
    warehouseToId: clean(value.warehouseToId),
  };
}

export function parseWeighbridgeFastRepeatContext(
  value: string | null | undefined
): WeighbridgeFastRepeatContext | null {
  if (!value) return null;
  try {
    return pickWeighbridgeFastRepeatContext(JSON.parse(value));
  } catch {
    return null;
  }
}
