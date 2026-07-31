export type CropStructureEditorRow = {
  id?: string;
  land_use_type: "crop" | "fallow";
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  notes?: string | null;
  area: number | null;
  irrigation_type?: string | null;
  row_spacing_m?: number | null;
  seed_spacing_cm?: number | null;
};

export type CropStructureChangeSummary = {
  added: number;
  updated: number;
  deleted: number;
};

type ReproductionIdentity = {
  code?: string | null;
  name?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  level_order?: number | null;
};

const normalizeToken = (value: unknown) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[\s_-]+/g, " ");

const rowFingerprint = (row: CropStructureEditorRow) =>
  JSON.stringify([
    row.land_use_type,
    row.crop_id || null,
    row.variety_id || null,
    row.reproduction_id || null,
    String(row.notes || "").trim(),
    row.area == null ? null : Number(row.area),
    row.irrigation_type || "unknown",
    row.row_spacing_m == null ? null : Number(row.row_spacing_m),
    row.seed_spacing_cm == null ? null : Number(row.seed_spacing_cm),
  ]);

export function summarizeCropStructureChanges(
  previousRows: CropStructureEditorRow[],
  nextRows: CropStructureEditorRow[]
): CropStructureChangeSummary {
  const previousById = new Map(
    previousRows.filter((row) => row.id).map((row) => [String(row.id), row])
  );
  const nextIds = new Set(nextRows.map((row) => row.id).filter(Boolean).map(String));

  let added = 0;
  let updated = 0;
  for (const row of nextRows) {
    if (!row.id) {
      added += 1;
      continue;
    }
    const previous = previousById.get(row.id);
    if (previous && rowFingerprint(previous) !== rowFingerprint(row)) updated += 1;
  }

  const deleted = Array.from(previousById.keys()).filter((id) => !nextIds.has(id)).length;
  return { added, updated, deleted };
}

export function hasCropStructureChanges(summary: CropStructureChangeSummary) {
  return summary.added + summary.updated + summary.deleted > 0;
}

export function agronomicReproductionRank(item: ReproductionIdentity) {
  const tokens = [item.code, item.name_ru, item.name, item.name_en].map(normalizeToken);
  const matches = (...values: string[]) => tokens.some((token) => values.includes(token));

  // Seed multiplication order: original material, pre-basic generations,
  // elite seed, then successive certified reproductions.
  if (matches("os", "ос", "original", "оригинальные", "оригинальные семена")) return 10;
  if (matches("sse", "ссэ", "суперсуперэлита", "супер суперэлита", "super super elite")) return 20;
  if (matches("se", "сэ", "суперэлита", "супер элита", "super elite", "superelite")) return 30;
  if (matches("es", "эс", "e", "elite", "элита", "элитные", "элитные семена")) return 40;
  if (matches("r1", "rs1", "рс1", "1 репродукция", "первая репродукция", "first reproduction")) return 50;
  if (matches("r2", "rs2", "рс2", "2 репродукция", "вторая репродукция", "second reproduction")) return 60;
  if (matches("r3", "rs3", "рс3", "3 репродукция", "третья репродукция", "third reproduction")) return 70;
  if (matches("r4", "rs4", "рс4", "4 репродукция", "четвертая репродукция", "fourth reproduction")) return 80;
  if (matches("f1", "гибрид f1", "hybrid f1")) return 90;

  return 1000 + Number(item.level_order || 0);
}

export function compactReproductionLabel(item: ReproductionIdentity | null | undefined) {
  if (!item) return "";

  switch (agronomicReproductionRank(item)) {
    case 10:
      return "ОС";
    case 20:
      return "ССЭ";
    case 30:
      return "СЭ";
    case 40:
      return "ЭС";
    case 50:
      return "1 р.";
    case 60:
      return "2 р.";
    case 70:
      return "3 р.";
    case 80:
      return "4 р.";
    case 90:
      return "F1";
    default:
      return String(item.name_ru || item.name || item.code || "").trim();
  }
}

export function sortReproductionsAgronomically<T extends ReproductionIdentity>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const rankDiff = agronomicReproductionRank(left) - agronomicReproductionRank(right);
    if (rankDiff !== 0) return rankDiff;
    const orderDiff = Number(left.level_order || 0) - Number(right.level_order || 0);
    if (orderDiff !== 0) return orderDiff;
    return normalizeToken(left.code || left.name_ru || left.name).localeCompare(
      normalizeToken(right.code || right.name_ru || right.name),
      "ru"
    );
  });
}
