export type WeighbridgeFastRepeatContext = {
  fieldId: string;
  cropStructureAllocationId: string;
  warehouseToId: string;
};

export type WeighbridgeHarvestDraft = WeighbridgeFastRepeatContext & {
  id: string;
  vehicleId: string;
  driverId: string;
  grossKg: string;
};

export type WeighbridgeHarvestDraftsState = {
  selectedId: string;
  drafts: WeighbridgeHarvestDraft[];
};

const STORAGE_PREFIX = "travkin.weighbridge.fastRepeat.v1";
const DRAFTS_STORAGE_PREFIX = "travkin.weighbridge.parallelIntakes.v1";

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

export function weighbridgeHarvestDraftsStorageKey(
  companyId: string | null | undefined,
  activeShiftId: string | null | undefined
) {
  const company = clean(companyId);
  const shift = clean(activeShiftId);
  return company && shift ? `${DRAFTS_STORAGE_PREFIX}.${company}.${shift}` : "";
}

export function createWeighbridgeHarvestDraft(id = "intake-1"): WeighbridgeHarvestDraft {
  return {
    id: clean(id) || "intake-1",
    fieldId: "",
    cropStructureAllocationId: "",
    warehouseToId: "",
    vehicleId: "",
    driverId: "",
    grossKg: "",
  };
}

export function parseWeighbridgeHarvestDraftsState(
  value: string | null | undefined
): WeighbridgeHarvestDraftsState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<WeighbridgeHarvestDraftsState>;
    const drafts = Array.isArray(parsed.drafts)
      ? parsed.drafts.slice(0, 4).map((draft, index) => ({
          ...createWeighbridgeHarvestDraft(clean(draft?.id) || `intake-${index + 1}`),
          fieldId: clean(draft?.fieldId),
          cropStructureAllocationId: clean(draft?.cropStructureAllocationId),
          warehouseToId: clean(draft?.warehouseToId),
          vehicleId: clean(draft?.vehicleId),
          driverId: clean(draft?.driverId),
          grossKg: clean(draft?.grossKg),
        }))
      : [];
    if (drafts.length === 0) return null;
    const selectedId = drafts.some((draft) => draft.id === clean(parsed.selectedId))
      ? clean(parsed.selectedId)
      : drafts[0].id;
    return { selectedId, drafts };
  } catch {
    return null;
  }
}
