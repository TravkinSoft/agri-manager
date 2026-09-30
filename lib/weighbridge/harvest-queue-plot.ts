/** PTC may suggest a plot only for a blank workspace, never replace its choice. */
export function harvestQueuePlotPatch(
  current: { fieldId?: string | null; cropStructureAllocationId?: string | null },
  fieldId: string | null | undefined,
  allocation: {
    allocationId: string;
    cropId: string;
    varietyId?: string | null;
    reproductionId?: string | null;
  } | null,
) {
  if (current.fieldId || current.cropStructureAllocationId || !fieldId || !allocation) return {};
  return {
    fieldId,
    cropStructureAllocationId: allocation.allocationId,
    cropId: allocation.cropId,
    varietyId: allocation.varietyId || "",
    reproductionId: allocation.reproductionId || "",
  };
}
