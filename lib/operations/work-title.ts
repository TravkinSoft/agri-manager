type WorkTitleMaterial = {
  material_type?: string | null;
  product_type?: string | null;
  product_name?: string | null;
};

const OPERATION_LABELS: Record<string, string> = {
  spraying: "Опрыскивание",
  spray: "Опрыскивание",
  drone_spraying: "Опрыскивание дроном",
  plant_protection: "Защита растений",
  fertilization: "Внесение удобрений",
  fertilizer_application: "Внесение удобрений",
  seeding: "Посев",
  planting: "Посадка",
  seeding_planting: "Посев / посадка",
  soil_operation: "Обработка почвы",
  soil_preparation: "Обработка почвы",
  harvesting: "Уборка",
  crop_care: "Уход за посевами",
  irrigation: "Полив",
  fertigation: "Фертигация",
  logistics: "Перевозка",
  logistics_operation: "Перевозка",
  service_operation: "Сервисная работа",
  post_harvest: "Послеуборочная обработка",
};

function looksLikeSlug(value: string): boolean {
  return /^[a-z0-9_/-]+$/.test(value) || value.includes("_");
}

function materialPurposeLabel(materials: WorkTitleMaterial[]): string | null {
  const joined = materials
    .map((material) => `${material.material_type || ""} ${material.product_type || ""} ${material.product_name || ""}`)
    .join(" ")
    .toLowerCase();

  if (/drone|дрон/.test(joined)) return "Опрыскивание дроном";
  if (/fungicide|фунгицид/.test(joined)) return "Фунгицидная обработка";
  if (/herbicide|гербицид/.test(joined)) return "Гербицидная обработка";
  if (/insecticide|инсектицид/.test(joined)) return "Инсектицидная обработка";
  if (/desiccant|десикант/.test(joined)) return "Десикация";
  if (/fertilizer|удобр/.test(joined)) return "Внесение удобрений";
  if (/seed|семен|сев/.test(joined)) return "Посев";
  return null;
}

export function resolveWorkTitle(input: {
  operationType?: string | null;
  operationTypeSlug?: string | null;
  operationCategorySlug?: string | null;
  operationEngineLabel?: string | null;
  materials?: WorkTitleMaterial[];
}): string {
  const materialLabel = materialPurposeLabel(input.materials || []);
  if (materialLabel) return materialLabel;

  const candidates = [
    input.operationEngineLabel,
    input.operationTypeSlug,
    input.operationCategorySlug,
    input.operationType,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (OPERATION_LABELS[normalized]) return OPERATION_LABELS[normalized];
  }

  const readable = String(input.operationType || input.operationEngineLabel || "").trim();
  if (readable && !looksLikeSlug(readable.toLowerCase())) return readable;
  return "Полевая работа";
}
