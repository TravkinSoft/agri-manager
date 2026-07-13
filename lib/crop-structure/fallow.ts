export const FALLOW_CROP_SLUG = "fallow";

export type CropIdentity = {
  id?: string | null;
  slug?: string | null;
};

export type CropStructureSeedAttributes = {
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  area: number | null;
  row_spacing_m?: number | null;
  seed_spacing_cm?: number | null;
};

export type CropStructureRowsValidation<T> =
  | { ok: true; rows: T[] }
  | { ok: false; rows: T[]; rowIndex: number | null; message: string };

export function isFallowCrop(crop: CropIdentity | null | undefined): boolean {
  return String(crop?.slug || "").trim().toLowerCase() === FALLOW_CROP_SLUG;
}

export function normalizeCropStructureSeedAttributes<T extends CropStructureSeedAttributes>(
  row: T,
  crop: CropIdentity | null | undefined
): T {
  if (!isFallowCrop(crop)) return { ...row };

  return {
    ...row,
    variety_id: null,
    reproduction_id: null,
    row_spacing_m: null,
    seed_spacing_cm: null,
  };
}

export function validateAndNormalizeCropStructureRows<T extends CropStructureSeedAttributes>(params: {
  rows: T[];
  cropsById: ReadonlyMap<string, CropIdentity>;
  fieldArea: number;
  areaEpsilon?: number;
}): CropStructureRowsValidation<T> {
  const areaEpsilon = params.areaEpsilon ?? 0.0001;
  const normalizedRows = params.rows.map((row) =>
    normalizeCropStructureSeedAttributes(row, row.crop_id ? params.cropsById.get(row.crop_id) : null)
  );

  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index];
    if (!row.crop_id || row.area == null || !Number.isFinite(Number(row.area)) || Number(row.area) <= 0) {
      return {
        ok: false,
        rows: normalizedRows,
        rowIndex: index,
        message: "Заполните культуру и площадь.",
      };
    }

    const crop = params.cropsById.get(row.crop_id);
    if (!isFallowCrop(crop) && (!row.variety_id || !row.reproduction_id)) {
      return {
        ok: false,
        rows: normalizedRows,
        rowIndex: index,
        message: "Заполните культуру, сорт, репродукцию и площадь.",
      };
    }
  }

  const totalArea = normalizedRows.reduce((sum, row) => sum + Number(row.area || 0), 0);
  if (totalArea > Number(params.fieldArea || 0) + areaEpsilon) {
    return {
      ok: false,
      rows: normalizedRows,
      rowIndex: null,
      message: "Площадь посевных строк превышает площадь поля.",
    };
  }

  return { ok: true, rows: normalizedRows };
}
