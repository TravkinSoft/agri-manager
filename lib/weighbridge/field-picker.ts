export type HarvestPhysicalField = {
  id: string;
  name: string;
  area: number;
  fieldCode?: string | null;
};

export function normalizeHarvestFieldSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/\u0451/g, "\u0435")
    .trim()
    .replace(/\s+/g, " ");
}

export function rankHarvestPhysicalFieldSearch(
  field: Pick<HarvestPhysicalField, "name" | "area" | "fieldCode">,
  query: unknown
): number | null {
  const needle = normalizeHarvestFieldSearchText(query);
  if (!needle) return 0;

  const name = normalizeHarvestFieldSearchText(field.name);
  const area = normalizeHarvestFieldSearchText(field.area);
  const fieldCode = normalizeHarvestFieldSearchText(field.fieldCode);

  if (name === needle) return 0;
  if (name.startsWith(needle)) {
    const suffix = name.slice(needle.length);
    if (/^(?:\s*[-/(]|\s+)/u.test(suffix)) return 10;
    if (/^\d/u.test(suffix)) return 20;
    return 30;
  }
  if (name.includes(needle)) return 30;
  if (area === needle) return 40;
  if (area.includes(needle)) return 41;
  if (fieldCode === needle) return 50;
  if (fieldCode.startsWith(needle)) return 51;
  if (fieldCode.includes(needle)) return 52;
  return null;
}

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
