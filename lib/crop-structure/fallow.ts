export const FALLOW_CROP_SLUG = "fallow";

export const LAND_USE_TYPES = ["crop", "fallow"] as const;
export type LandUseType = (typeof LAND_USE_TYPES)[number];

export type CropIdentity = {
  id?: string | null;
  slug?: string | null;
};

export type VarietyIdentity = {
  id?: string | null;
  crop_id?: string | null;
};

export type CropStructureSeedAttributes = {
  land_use_type?: LandUseType | null;
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

export function isFallowLandUse(value: LandUseType | string | null | undefined): boolean {
  return value === "fallow";
}

export function getCropStructureLandUseType(
  row: Pick<CropStructureSeedAttributes, "land_use_type" | "crop_id">,
  crop?: CropIdentity | null
): LandUseType {
  if (isFallowLandUse(row.land_use_type)) return "fallow";
  // Read compatibility for old installations; new writes never use a fake crop.
  if (row.land_use_type == null && isFallowCrop(crop)) return "fallow";
  return "crop";
}

export function formatCropStructureIdentity(input: {
  landUseType?: LandUseType | string | null;
  cropName?: string | null;
  varietyName?: string | null;
  reproductionName?: string | null;
}): string {
  if (isFallowLandUse(input.landUseType)) return "Пар";
  return [input.cropName, input.varietyName, input.reproductionName].filter(Boolean).join(" / ") || "Культура не указана";
}

export function normalizeCropStructureSeedAttributes<T extends CropStructureSeedAttributes>(
  row: T,
  crop: CropIdentity | null | undefined
): T {
  const landUseType = getCropStructureLandUseType(row, crop);
  if (landUseType === "crop") return { ...row, land_use_type: "crop" };

  return {
    ...row,
    land_use_type: "fallow",
    crop_id: null,
    variety_id: null,
    reproduction_id: null,
    row_spacing_m: null,
    seed_spacing_cm: null,
  };
}

export function validateAndNormalizeCropStructureRows<T extends CropStructureSeedAttributes>(params: {
  rows: T[];
  cropsById: ReadonlyMap<string, CropIdentity>;
  varietiesById?: ReadonlyMap<string, VarietyIdentity>;
  fieldArea: number;
  areaEpsilon?: number;
}): CropStructureRowsValidation<T> {
  const areaEpsilon = params.areaEpsilon ?? 0.0001;
  for (let index = 0; index < params.rows.length; index += 1) {
    const row = params.rows[index];
    if (isFallowLandUse(row.land_use_type) && (row.crop_id || row.variety_id || row.reproduction_id)) {
      return {
        ok: false,
        rows: params.rows.map((item) => ({ ...item })),
        rowIndex: index,
        message: "Для пара культура, сорт и репродукция не указываются.",
      };
    }
  }
  const normalizedRows = params.rows.map((row) =>
    normalizeCropStructureSeedAttributes(row, row.crop_id ? params.cropsById.get(row.crop_id) : null)
  );

  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index];
    if (row.area == null || !Number.isFinite(Number(row.area)) || Number(row.area) <= 0) {
      return { ok: false, rows: normalizedRows, rowIndex: index, message: "Укажите корректную площадь участка." };
    }

    const crop = row.crop_id ? params.cropsById.get(row.crop_id) : null;
    const landUseType = getCropStructureLandUseType(row, crop);
    if (landUseType === "crop" && (!row.crop_id || !row.variety_id || !row.reproduction_id)) {
      return {
        ok: false,
        rows: normalizedRows,
        rowIndex: index,
        message: "Укажите культуру, сорт, репродукцию и площадь.",
      };
    }
    if (
      landUseType === "crop" &&
      row.variety_id &&
      params.varietiesById &&
      params.varietiesById.get(row.variety_id)?.crop_id !== row.crop_id
    ) {
      return {
        ok: false,
        rows: normalizedRows,
        rowIndex: index,
        message: "Выбранный сорт не относится к указанной культуре.",
      };
    }
  }

  const identityKeys = new Set<string>();
  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index];
    const crop = row.crop_id ? params.cropsById.get(row.crop_id) : null;
    if (getCropStructureLandUseType(row, crop) === "fallow") continue;
    const key = `${row.crop_id || ""}:${row.variety_id || ""}:${row.reproduction_id || ""}`;
    if (identityKeys.has(key)) {
      return {
        ok: false,
        rows: normalizedRows,
        rowIndex: index,
        message: "Такая культура, сорт и репродукция уже добавлены для этого поля.",
      };
    }
    identityKeys.add(key);
  }

  const totalArea = normalizedRows.reduce((sum, row) => sum + Number(row.area || 0), 0);
  if (totalArea > Number(params.fieldArea || 0) + areaEpsilon) {
    return {
      ok: false,
      rows: normalizedRows,
      rowIndex: null,
      message: "Суммарная площадь участков превышает площадь поля.",
    };
  }

  return { ok: true, rows: normalizedRows };
}
