export type HarvestPhysicalField = {
  id: string;
  name: string;
  area: number;
  fieldCode?: string | null;
};

export function harvestFieldsWithAllocations<TField extends HarvestPhysicalField>(
  fields: TField[],
  allocationsByField: Record<string, unknown[]>
): TField[] {
  const seen = new Set<string>();
  return fields
    .filter((field) => {
      const fieldId = String(field.id || "").trim();
      if (!fieldId || seen.has(fieldId) || !(allocationsByField[fieldId]?.length > 0)) return false;
      seen.add(fieldId);
      return true;
    })
    .slice()
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name, "ru", { numeric: true, sensitivity: "base" });
      if (byName) return byName;
      const byArea = Number(left.area || 0) - Number(right.area || 0);
      if (byArea) return byArea;
      const byCode = String(left.fieldCode || "").localeCompare(String(right.fieldCode || ""), "ru", {
        numeric: true,
        sensitivity: "base",
      });
      return byCode || left.id.localeCompare(right.id);
    });
}
