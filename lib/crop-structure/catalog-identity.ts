export type ScopedCatalogIdentity = {
  id: string;
  company_id?: string | null;
  archived?: boolean | null;
  is_active?: boolean | null;
  name?: string | null;
  name_ru?: string | null;
  name_kz?: string | null;
  name_en?: string | null;
  code?: string | null;
};

export type ScopedVarietyIdentity = ScopedCatalogIdentity & {
  crop_id: string;
};

const normalizeIdentity = (value: unknown) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");

const displayIdentity = (row: ScopedCatalogIdentity) =>
  row.name_ru || row.name || row.name_en || row.name_kz || row.code || "";

const isAvailable = (row: ScopedCatalogIdentity, companyId: string, selectedIds: ReadonlySet<string>) =>
  selectedIds.has(row.id) ||
  (
    (row.company_id == null || row.company_id === companyId) &&
    row.archived !== true &&
    row.is_active !== false
  );

const preferCompanyRow = <T extends ScopedCatalogIdentity>(current: T | undefined, candidate: T, companyId: string) => {
  if (!current) return candidate;
  if (candidate.company_id === companyId && current.company_id == null) return candidate;
  return current;
};

export function buildVarietyOptions(params: {
  rows: ScopedVarietyIdentity[];
  companyId: string;
  canonicalCropId: (cropId: string) => string;
  selectedIds?: Iterable<string>;
}) {
  const selectedIds = new Set(params.selectedIds || []);
  const grouped = new Map<string, ScopedVarietyIdentity>();

  for (const row of params.rows) {
    if (!isAvailable(row, params.companyId, selectedIds)) continue;
    const cropId = params.canonicalCropId(row.crop_id);
    const identity = normalizeIdentity(displayIdentity(row));
    if (!cropId || !identity) continue;
    const key = `${cropId}:${identity}`;
    grouped.set(key, preferCompanyRow(grouped.get(key), row, params.companyId));
  }

  const byCrop = new Map<string, ScopedVarietyIdentity[]>();
  grouped.forEach((row) => {
    const cropId = params.canonicalCropId(row.crop_id);
    const rows = byCrop.get(cropId) || [];
    rows.push(row);
    byCrop.set(cropId, rows);
  });
  byCrop.forEach((rows, cropId) => {
    byCrop.set(
      cropId,
      rows.sort((left: ScopedVarietyIdentity, right: ScopedVarietyIdentity) =>
        displayIdentity(left).localeCompare(displayIdentity(right), "ru")
      )
    );
  });
  return byCrop;
}

export function buildReproductionOptions(params: {
  rows: ScopedCatalogIdentity[];
  companyId: string;
  selectedIds?: Iterable<string>;
}) {
  const selectedIds = new Set(params.selectedIds || []);
  const grouped = new Map<string, ScopedCatalogIdentity>();

  for (const row of params.rows) {
    if (!isAvailable(row, params.companyId, selectedIds)) continue;
    const identity = normalizeIdentity(row.code) || normalizeIdentity(displayIdentity(row));
    if (!identity) continue;
    grouped.set(identity, preferCompanyRow(grouped.get(identity), row, params.companyId));
  }

  return Array.from(grouped.values());
}

export function catalogIdentitySearchValue(row: ScopedCatalogIdentity) {
  return [row.name, row.name_ru, row.name_kz, row.name_en, row.code]
    .filter(Boolean)
    .join(" ");
}

export function normalizeCatalogIdentity(value: unknown) {
  return normalizeIdentity(value);
}
