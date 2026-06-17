export type AssistantDraftCardStatus = "draft" | "confirmed" | "cancelled" | "expired";

export type AssistantDraftMaterialLine = {
  id: string;
  name: string;
  ratePerHa: number | null;
  unit: string | null;
  requiredQty: number | null;
  calculation: string | null;
};

export type AssistantDraftTankLine = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
};

export type AssistantDraftConfirmPayload = {
  endpoint: "/api/operations";
  method: "POST";
  idempotencyKey: string;
  body: Record<string, unknown>;
  missingFields: string[];
};

export type AssistantOperationDraftCard = {
  id: string;
  kind: "operation";
  status: AssistantDraftCardStatus;
  collapsed?: boolean;
  title: string;
  operationType: string | null;
  field: string | null;
  section: string | null;
  crop: string | null;
  areaHa: number | null;
  sprayVolumeLHa: number | null;
  materials: AssistantDraftMaterialLine[];
  tankTotals: AssistantDraftTankLine[];
  date: string | null;
  responsible: string | null;
  comment: string | null;
  recommendations: string[];
  shortageMessage?: string | null;
  confirm: AssistantDraftConfirmPayload;
  error?: string | null;
};

export type AssistantGenericDraftKind =
  | "weighbridge_ticket"
  | "warehouse"
  | "field"
  | "meal_order"
  | "transfer"
  | "fuel_issue"
  | "field_task"
  | "material_issue";

export type AssistantGenericDraftItem = {
  id: string;
  label: string;
  value: string;
};

export type AssistantGenericDraftCard = {
  id: string;
  kind: AssistantGenericDraftKind;
  status: AssistantDraftCardStatus;
  collapsed?: boolean;
  title: string;
  summary: string;
  route: string;
  actionLabel: string;
  items: AssistantGenericDraftItem[];
  missingFields: string[];
  note?: string | null;
  error?: string | null;
};

export type AssistantDraftCard = AssistantOperationDraftCard | AssistantGenericDraftCard;

type PendingDraftPayload = {
  draftKind?: unknown;
  collectedFields?: Record<string, unknown>;
  missingFields?: unknown[];
  requiredFields?: unknown[];
  parameters?: Record<string, unknown>;
  requestMessage?: unknown;
};

type BuildDraftCardsInput = {
  pendingActionType?: string | null;
  pendingActionPayloadJson?: string | null;
};

const GENERIC_DRAFT_META: Record<
  AssistantGenericDraftKind,
  { title: string; summary: string; route: string; actionLabel: string }
> = {
  weighbridge_ticket: {
    title: "Черновик талона весовой",
    summary: "Поставка, отгрузка или перемещение через весовую.",
    route: "/weighbridge",
    actionLabel: "Открыть весовую",
  },
  warehouse: {
    title: "Черновик склада",
    summary: "Новый склад или место хранения.",
    route: "/warehouses",
    actionLabel: "Открыть склады",
  },
  field: {
    title: "Черновик поля",
    summary: "Новое поле или участок хозяйства.",
    route: "/fields",
    actionLabel: "Открыть поля",
  },
  meal_order: {
    title: "Черновик заявки питания",
    summary: "Питание, люди и доставка термосов.",
    route: "/meal-thermoses",
    actionLabel: "Открыть питание",
  },
  transfer: {
    title: "Черновик перемещения",
    summary: "Перемещение материалов между складами.",
    route: "/warehouses",
    actionLabel: "Открыть склады",
  },
  fuel_issue: {
    title: "Черновик выдачи ГСМ",
    summary: "Выдача топлива на машину или технику.",
    route: "/fuel",
    actionLabel: "Открыть ГСМ",
  },
  field_task: {
    title: "Черновик полевого задания",
    summary: "Задача по полю без немедленной записи.",
    route: "/operations",
    actionLabel: "Открыть операции",
  },
  material_issue: {
    title: "Черновик выдачи материала",
    summary: "Подготовка выдачи материалов под операцию.",
    route: "/operations",
    actionLabel: "Открыть операции",
  },
};

const GENERIC_FIELD_LABELS: Record<string, string> = {
  movement_type: "Тип движения",
  movementType: "Тип движения",
  direction: "Направление",
  warehouse: "Склад",
  warehouse_alias: "Склад",
  counterparty_or_source: "Контрагент / источник",
  counterparty: "Контрагент",
  supplier: "Поставщик",
  source: "Источник",
  source_warehouse: "Склад-источник",
  from_warehouse: "Склад-источник",
  destination_warehouse: "Склад назначения",
  to_warehouse: "Склад назначения",
  product_lines: "Товары",
  products: "Товары",
  materials: "Материалы",
  lines: "Строки",
  document_number: "Документ",
  document: "Документ",
  date: "Дата",
  meal_date: "Дата питания",
  meal_type: "Тип питания",
  people: "Люди",
  persons: "Люди",
  count: "Количество людей",
  name: "Название",
  title: "Название",
  warehouse_type: "Тип склада",
  type: "Тип",
  capacity: "Вместимость",
  location: "Место",
  area_ha: "Площадь",
  area: "Площадь",
  crop: "Культура",
  field: "Поле",
  crop_structure: "Участок",
  task: "Задача",
  operation: "Операция",
  fuel_source: "Источник ГСМ",
  vehicle_or_machine: "Машина / техника",
  vehicle: "Машина",
  machine: "Техника",
  quantity: "Количество",
  qty: "Количество",
  amount: "Количество",
  unit: "Единица",
  responsible: "Ответственный",
  comment: "Комментарий",
};

const GENERIC_ITEM_ORDER: Record<AssistantGenericDraftKind, string[]> = {
  weighbridge_ticket: [
    "movement_type",
    "counterparty_or_source",
    "counterparty",
    "supplier",
    "warehouse",
    "product_lines",
    "products",
    "lines",
    "document_number",
    "date",
  ],
  warehouse: ["name", "warehouse_type", "capacity", "location"],
  field: ["name", "area_ha", "crop", "location"],
  meal_order: ["meal_date", "meal_type", "people", "field", "location", "comment"],
  transfer: ["source_warehouse", "destination_warehouse", "product_lines", "products", "materials", "date"],
  fuel_issue: ["fuel_source", "vehicle_or_machine", "vehicle", "machine", "quantity", "unit", "date"],
  field_task: ["field", "crop_structure", "task", "date", "responsible"],
  material_issue: ["operation", "materials", "product_lines", "warehouse", "date"],
};

const GENERIC_INTERNAL_KEYS = new Set([
  "companyId",
  "company_id",
  "query",
  "tool",
  "output_type",
  "requestMessage",
  "draftKind",
  "draft_kind",
  "idempotency_key",
  "id",
  "field_id",
  "warehouse_id",
  "operation_id",
  "crop_structure_id",
  "responsible_user_id",
]);

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function isUuidLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function publicText(value: unknown): string | null {
  const text = cleanText(value);
  if (!text || isUuidLike(text)) return null;
  return text;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = publicText(value);
    if (text) return text;
  }
  return null;
}

function firstRawText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(",", ".").trim();
  if (!text) return null;
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function normalizeDate(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/(сегодня|today)/i.test(lower)) return new Date().toISOString().slice(0, 10);
  if (/(завтра|tomorrow)/i.test(lower)) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const ruDate = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (ruDate) {
    const day = ruDate[1].padStart(2, "0");
    const month = ruDate[2].padStart(2, "0");
    const year = ruDate[3] ? (ruDate[3].length === 2 ? `20${ruDate[3]}` : ruDate[3]) : String(new Date().getFullYear());
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
}

function mergeDraftParams(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const next = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    const hasValue =
      Array.isArray(value)
        ? value.length > 0
        : value !== null && value !== undefined && String(value).trim().length > 0;
    if (hasValue) next[key] = value;
  });
  return next;
}

function inferOperationTypeFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (/гербицид|herbicid/.test(lower)) return "Гербицидная обработка";
  if (/фунгицид|fungicid/.test(lower)) return "Фунгицидная обработка";
  if (/инсектицид|insecticid/.test(lower)) return "Инсектицидная обработка";
  if (/десикац|desiccat/.test(lower)) return "Десикация";
  if (/фертигац|fertigation/.test(lower)) return "Фертигация";
  if (/посадк.*картоф|картоф.*посадк/.test(lower)) return "Посадка картофеля";
  if (/посев|сеять|sowing|planting/.test(lower)) return "Посев";
  if (/уборк|комбайн|harvest/.test(lower)) return "Уборка";
  if (/диск|лущен|культивац|борон|вспаш|гребн|почво|soil/.test(lower)) return "Почвообработка";
  if (/удобрен|селитр|диаммофоск|fertiliz/.test(lower)) return "Внесение удобрений";
  return null;
}

function parseFieldLabelFromText(text: string): string | null {
  const match = text.match(/(?:поле|field)\s*№?\s*([0-9]{1,3}(?:-[0-9]{1,3}){0,2}[а-яa-z]?)/i);
  return match?.[1] || null;
}

function parseAreaHaFromText(text: string): number | null {
  const match = text.match(/(?:^|[^\d])(\d+(?:[,.]\d+)?)\s*(?:га|ha)(?=\s|[.,;:]|$)/i);
  return match ? toNumber(match[1]) : null;
}

function cleanMaterialNameFromSegment(segment: string): string | null {
  const anchored = segment.match(/(?:материал(?:ы)?|препарат(?:ы)?|добавь|внеси)\s+(.+)/i)?.[1] || segment;
  const afterColon = anchored.includes(":") ? anchored.slice(anchored.lastIndexOf(":") + 1) : anchored;
  const beforeRate = afterColon.replace(/\s+\d+(?:[,.]\d+)?\s*(?:л|l|кг|kg|г|g|мл|ml)\s*\/\s*(?:га|ha).*$/iu, "");
  const name = beforeRate
    .replace(/^(и|плюс|а также)\s+/i, "")
    .replace(/[.;:]+$/g, "")
    .trim();
  return name || null;
}

function parseMaterialLinesFromText(text: string): {
  materials: Array<Record<string, unknown>>;
  sprayVolumeLHa: number | null;
} {
  const materials: Array<Record<string, unknown>> = [];
  let sprayVolumeLHa: number | null = null;
  const materialStart = text.match(/(?:материал(?:ы)?|препарат(?:ы)?|materials?|products?)/i);
  const source = materialStart?.index != null
    ? text.slice(materialStart.index + materialStart[0].length)
    : text;
  const segments = source
    .split(/[;,\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const lineRegex = /^(.{2,120}?)\s+(\d+(?:[,.]\d+)?)\s*(л|l|кг|kg|г|g|мл|ml)\s*\/\s*(?:га|ha)(?=\s|[.,;:]|$)/iu;
  const seen = new Set<string>();

  for (const segment of segments) {
    const match = segment.match(lineRegex);
    if (!match) continue;
    const name = cleanMaterialNameFromSegment(match[1]);
    const rate = toNumber(match[2]);
    const unit = normalizeUnit(match[3]);
    if (!name || rate == null || !unit) continue;
    const key = `${name.toLowerCase()}_${rate}_${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (/^(вода|water)$/i.test(name)) {
      sprayVolumeLHa = rate;
      continue;
    }

    materials.push({
      product: name,
      rate_per_ha: rate,
      unit,
    });
  }

  return { materials, sprayVolumeLHa };
}

function inferOperationParamsFromText(value: unknown): Record<string, unknown> {
  const text = cleanText(value) || "";
  if (!text) return {};
  const materialParse = parseMaterialLinesFromText(text);
  const inferred: Record<string, unknown> = {
    query: text,
  };
  const fieldLabel = parseFieldLabelFromText(text);
  const areaHa = parseAreaHaFromText(text);
  const operationType = inferOperationTypeFromText(text);
  const date = normalizeDate(text);

  if (fieldLabel) {
    inferred.field = fieldLabel;
    inferred.field_label = fieldLabel;
  }
  if (areaHa != null) inferred.area_ha = areaHa;
  if (operationType) {
    inferred.operation_type = operationType;
    inferred.operation_type_label = operationType;
  }
  if (date) inferred.date = date;
  if (materialParse.materials.length) {
    inferred.materials = materialParse.materials;
    inferred.product_lines = materialParse.materials;
  }
  if (materialParse.sprayVolumeLHa != null) {
    inferred.spray_volume_per_ha = materialParse.sprayVolumeLHa;
    inferred.water_rate_l_ha = materialParse.sprayVolumeLHa;
  }

  return inferred;
}

function parsePendingPayload(payloadJson: string | null | undefined): PendingDraftPayload | null {
  const text = cleanText(payloadJson);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as PendingDraftPayload) : null;
  } catch {
    return null;
  }
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value ?? {});
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeOperationKind(value: string | null): {
  categorySlug: string | null;
  typeSlug: string | null;
  operationType: string | null;
} {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  const map: Record<string, { categorySlug: string; typeSlug: string; operationType: string }> = {
    soil_operation: { categorySlug: "soil_operation", typeSlug: "soil_operation", operationType: "Почвообработка" },
    planting: { categorySlug: "planting", typeSlug: "planting", operationType: "Посев / посадка" },
    fertilizer_application: {
      categorySlug: "fertilizer_application",
      typeSlug: "fertilizer_application",
      operationType: "Внесение удобрений",
    },
    spraying: { categorySlug: "spraying", typeSlug: "spraying", operationType: "СЗР / опрыскивание" },
    fertigation: { categorySlug: "fertigation", typeSlug: "fertigation", operationType: "Фертигация" },
    irrigation: { categorySlug: "irrigation", typeSlug: "irrigation", operationType: "Полив" },
    harvesting: { categorySlug: "harvesting", typeSlug: "harvesting", operationType: "Уборка" },
  };

  if (map[lower]) return map[lower];
  if (lower.includes("spray") || lower.includes("сзр") || lower.includes("опрыск")) return map.spraying;
  if (lower.includes("удобр") || lower.includes("fertil")) return map.fertilizer_application;
  if (lower.includes("посев") || lower.includes("посад") || lower.includes("plant")) return map.planting;
  if (lower.includes("уборк") || lower.includes("harvest")) return map.harvesting;
  if (lower.includes("почв") || lower.includes("soil") || lower.includes("культивац")) return map.soil_operation;
  if (lower.includes("полив") || lower.includes("irrig")) return map.irrigation;
  if (!raw) return { categorySlug: null, typeSlug: null, operationType: null };
  return { categorySlug: null, typeSlug: null, operationType: raw };
}

function normalizeUnit(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (["l", "liter", "litre", "литр", "литров"].includes(lower)) return "л";
  if (["kg", "kilogram", "килограмм", "килограммов"].includes(lower)) return "кг";
  return text;
}

function materialLineFromRecord(row: Record<string, unknown>, index: number, areaHa: number | null): AssistantDraftMaterialLine | null {
  const name = firstText(row.product_name, row.product, row.name, row.title, row.material);
  if (!name) return null;
  const rate = toNumber(row.rate_per_ha ?? row.planned_rate ?? row.rate);
  const unit = normalizeUnit(row.unit ?? row.measure_unit);
  const requiredQty = areaHa != null && rate != null ? Number((areaHa * rate).toFixed(4)) : toNumber(row.required_qty ?? row.quantity);
  return {
    id: `material_${index}_${stableHash(row)}`,
    name,
    ratePerHa: rate,
    unit,
    requiredQty,
    calculation:
      areaHa != null && rate != null && unit
        ? `${formatNumber(rate)} × ${formatNumber(areaHa)} = ${formatNumber(requiredQty)} ${unit}`
        : null,
  };
}

function collectMaterials(params: Record<string, unknown>, areaHa: number | null): AssistantDraftMaterialLine[] {
  const rows: AssistantDraftMaterialLine[] = [];
  const add = (line: AssistantDraftMaterialLine | null) => {
    if (!line) return;
    if (!rows.some((item) => item.name.toLowerCase() === line.name.toLowerCase() && item.ratePerHa === line.ratePerHa)) {
      rows.push(line);
    }
  };

  const primaryProduct = firstText(params.product_name, params.product, params.material);
  if (primaryProduct) {
    add(
      materialLineFromRecord(
        {
          product: primaryProduct,
          rate_per_ha: params.rate_per_ha ?? params.planned_rate ?? params.rate,
          unit: params.unit,
        },
        rows.length,
        areaHa
      )
    );
  }

  const candidateArrays = [
    params.materials,
    params.product_lines,
    params.products,
    params.lines,
    params.additional_products_list,
    params.components,
  ];

  candidateArrays.forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((item) => {
      if (item && typeof item === "object") {
        add(materialLineFromRecord(item as Record<string, unknown>, rows.length, areaHa));
      } else {
        const name = firstText(item);
        if (name) add({ id: `material_${rows.length}_${stableHash(name)}`, name, ratePerHa: null, unit: null, requiredQty: null, calculation: null });
      }
    });
  });

  return rows.slice(0, 8);
}

function collectMissingLabels(payload: PendingDraftPayload, extraMissing: string[]): string[] {
  const normalizeMissingLabel = (value: string): string => {
    const lower = value.toLowerCase();
    if (/(участ|структур)/i.test(lower)) return "участок структуры";
    if (/поле/i.test(lower)) return "поле";
    if (/площад/i.test(lower)) return "площадь";
    if (/дат/i.test(lower)) return "дата";
    if (/работ|тип/i.test(lower)) return "тип работы";
    return value;
  };
  const fromPayload = Array.isArray(payload.missingFields)
    ? payload.missingFields
        .map((item) => {
          if (!item || typeof item !== "object") return publicText(item);
          const row = item as Record<string, unknown>;
          return publicText(row.label) || publicText(row.field);
        })
        .filter(Boolean)
    : [];
  return Array.from(new Set(([...fromPayload, ...extraMissing].filter(Boolean) as string[]).map(normalizeMissingLabel)));
}

function collectOperationCreateBody(params: {
  payload: PendingDraftPayload;
  raw: Record<string, unknown>;
  collected: Record<string, unknown>;
  operationKind: ReturnType<typeof normalizeOperationKind>;
  areaHa: number | null;
  date: string | null;
  comment: string | null;
  sprayVolumeLHa: number | null;
}): { body: Record<string, unknown>; missingFields: string[] } {
  const { payload, raw, collected, operationKind, areaHa, date, comment, sprayVolumeLHa } = params;
  const fieldId = firstRawText(raw.field_id, collected.field_id, collected.field);
  const cropStructureId = firstRawText(raw.crop_structure_id, raw.cropStructureId, collected.crop_structure_id, collected.crop_structure);
  const responsibleId = firstRawText(raw.responsible_user_id, raw.responsible_id, collected.responsible_user_id);
  const operationCategorySlug = firstRawText(raw.operation_category_slug, raw.categorySlug) || operationKind.categorySlug;
  const operationTypeSlug = firstRawText(raw.operation_type_slug, raw.typeSlug) || operationKind.typeSlug;
  const operationType = operationKind.operationType || firstText(raw.operation_type, raw.work, collected.operation_type);
  const fieldLabel = firstText(raw.field_label, raw.field_name, raw.field, collected.field_label, collected.field);
  const cropStructureLabel = firstText(raw.section_label, raw.crop_structure_label, raw.crop_structure, collected.crop_structure_label, collected.crop_structure);
  const missing: string[] = [];

  if ((!fieldId || !isUuidLike(fieldId)) && !fieldLabel) missing.push("поле");
  if ((!cropStructureId || !isUuidLike(cropStructureId)) && !cropStructureLabel) missing.push("участок");
  if (!operationType) missing.push("работа");
  if (areaHa == null || areaHa <= 0) missing.push("площадь");
  if (!date) missing.push("дата");

  const materials = Array.isArray(raw.materials) ? raw.materials : [];
  const tankComponents = Array.isArray(raw.components)
    ? raw.components
    : Array.isArray(raw.additional_products_list)
      ? raw.additional_products_list
      : [];

  return {
    missingFields: collectMissingLabels(payload, missing),
    body: {
      field_id: fieldId,
      crop_structure_id: cropStructureId,
      operation_category_slug: operationCategorySlug,
      operation_type_slug: operationTypeSlug,
      operation_type: operationType,
      planned_area_ha: areaHa,
      spray_volume_per_ha: sprayVolumeLHa,
      date,
      responsible_user_id: isUuidLike(responsibleId) ? responsibleId : null,
      notes: comment,
      purposes: raw.purposes,
      materials,
      tank_mix: tankComponents.length || sprayVolumeLHa
        ? {
            enabled: true,
            total_solution_l_ha: sprayVolumeLHa,
            water_rate_l_ha: sprayVolumeLHa,
            components: tankComponents,
          }
        : undefined,
    },
  };
}

function collectRecommendations(materials: AssistantDraftMaterialLine[], sprayVolumeLHa: number | null): string[] {
  if (!materials.length && !sprayVolumeLHa) return [];
  const hasPh = materials.some((item) => /ph|рн|корректор/i.test(item.name));
  const hasCropProtection = materials.some((item) => /ревус|актара|трибьют|гербицид|фунгицид|инсектицид/i.test(item.name));
  if (!hasPh && !hasCropProtection) return [];
  return [
    "Начать с воды.",
    hasPh ? "Сначала внести pH-корректор и проверить воду." : "Проверить качество воды перед смешиванием.",
    hasCropProtection ? "СЗР добавлять после корректировки воды." : "Материалы добавлять по регламенту производителя.",
    "После каждого компонента перемешивать раствор.",
  ];
}

function normalizeDraftKind(value: string | null): "operation" | AssistantGenericDraftKind | null {
  const text = String(value || "").trim();
  if (text === "operation") return "operation";
  if (text in GENERIC_DRAFT_META) return text as AssistantGenericDraftKind;
  return null;
}

function formatGenericObjectLine(row: Record<string, unknown>): string | null {
  const name = firstText(
    row.product_name,
    row.product,
    row.material,
    row.name,
    row.title,
    row.warehouse,
    row.field,
    row.task,
    row.operation
  );
  const qty = toNumber(row.quantity ?? row.qty ?? row.amount);
  const unit = normalizeUnit(row.unit ?? row.measure_unit);
  const warehouse = firstText(row.warehouse_name, row.warehouse);
  const parts: string[] = [];
  if (name) parts.push(name);
  if (qty != null || unit) parts.push(`${qty != null ? formatNumber(qty) : ""}${unit ? ` ${unit}` : ""}`.trim());
  if (warehouse && warehouse !== name) parts.push(`→ ${warehouse}`);
  if (parts.length) return parts.join(" ");

  const inline = Object.entries(row)
    .filter(([key, value]) => !GENERIC_INTERNAL_KEYS.has(key) && value != null)
    .slice(0, 3)
    .map(([key, value]) => {
      const text = typeof value === "object" ? null : publicText(value);
      return text ? `${GENERIC_FIELD_LABELS[key] || key}: ${text}` : null;
    })
    .filter(Boolean) as string[];
  return inline.length ? inline.join(", ") : null;
}

function formatGenericValue(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const rows = value
      .map((item) => {
        if (item && typeof item === "object") return formatGenericObjectLine(item as Record<string, unknown>);
        return publicText(item);
      })
      .filter(Boolean) as string[];
    if (!rows.length) return null;
    const visible = rows.slice(0, 3);
    return value.length > visible.length ? `${visible.join("; ")}; + ещё ${value.length - visible.length}` : visible.join("; ");
  }
  if (typeof value === "object") return formatGenericObjectLine(value as Record<string, unknown>);
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return publicText(value);
}

function buildGenericDraftItems(kind: AssistantGenericDraftKind, raw: Record<string, unknown>): AssistantGenericDraftItem[] {
  const items: AssistantGenericDraftItem[] = [];
  const seenKeys = new Set<string>();
  const orderedKeys = [...(GENERIC_ITEM_ORDER[kind] || []), ...Object.keys(raw).sort()];

  orderedKeys.forEach((key) => {
    if (GENERIC_INTERNAL_KEYS.has(key) || seenKeys.has(key)) return;
    seenKeys.add(key);
    const formatted = formatGenericValue(raw[key]);
    if (!formatted) return;
    const label = GENERIC_FIELD_LABELS[key] || key.replace(/_/g, " ");
    if (items.some((item) => item.label === label && item.value === formatted)) return;
    items.push({
      id: `item_${items.length}_${stableHash({ key, value: raw[key] })}`,
      label,
      value: formatted,
    });
  });

  return items.slice(0, 10);
}

function buildGenericDraftCard(payload: PendingDraftPayload, kind: AssistantGenericDraftKind): AssistantGenericDraftCard {
  const raw = mergeDraftParams(payload.parameters || {}, payload.collectedFields || {});
  const meta = GENERIC_DRAFT_META[kind];
  const missingFields = collectMissingLabels(payload, []);
  const seed = {
    kind,
    raw,
    missingFields,
    requestMessage: payload.requestMessage,
  };

  return {
    id: `generic_draft_${kind}_${stableHash(seed)}`,
    kind,
    status: "draft",
    title: meta.title,
    summary: meta.summary,
    route: meta.route,
    actionLabel: meta.actionLabel,
    items: buildGenericDraftItems(kind, raw),
    missingFields,
    note: "Пока это безопасный черновик: данные не записаны в систему.",
  };
}

function buildOperationDraftCard(payload: PendingDraftPayload): AssistantDraftCard | null {
  const requestText = cleanText(payload.requestMessage) || cleanText(payload.parameters?.query) || "";
  const raw = mergeDraftParams(inferOperationParamsFromText(requestText), payload.parameters || {});
  const collected = payload.collectedFields || {};
  const operationTypeText = firstText(
    raw.operation_type_label,
    raw.operation_type,
    raw.work,
    raw.subtype,
    collected.operation_type
  );
  const operationKind = normalizeOperationKind(operationTypeText);
  const areaHa = toNumber(raw.area_ha ?? raw.planned_area_ha ?? raw.area ?? collected.area_ha);
  const sprayVolumeLHa = toNumber(raw.spray_volume_per_ha ?? raw.sprayVolumeLHa ?? raw.water_rate_l_ha);
  const date = normalizeDate(raw.date ?? raw.planned_date ?? raw.operation_date ?? collected.date);
  const comment = firstText(raw.comment, raw.comments, raw.notes, payload.requestMessage);
  const materials = collectMaterials(raw, areaHa);
  const tankTotals: AssistantDraftTankLine[] = materials
    .filter((item) => item.requiredQty != null)
    .map((item) => ({
      id: `tank_${item.id}`,
      name: item.name,
      quantity: item.requiredQty,
      unit: item.unit,
    }));
  if (sprayVolumeLHa != null && areaHa != null) {
    tankTotals.push({
      id: "tank_water",
      name: "Вода",
      quantity: Number((sprayVolumeLHa * areaHa).toFixed(2)),
      unit: "л",
    });
  }

  const create = collectOperationCreateBody({
    payload,
    raw,
    collected,
    operationKind,
    areaHa,
    date,
    comment,
    sprayVolumeLHa,
  });
  const cardSeed = {
    kind: "operation",
    raw,
    collected,
    date,
    areaHa,
    operationType: operationKind.operationType || operationTypeText,
  };

  return {
    id: `operation_draft_${stableHash(cardSeed)}`,
    kind: "operation",
    status: "draft",
    title: "Черновик операции",
    operationType: operationKind.operationType || operationTypeText,
    field: firstText(raw.field_label, raw.field_name, raw.field, collected.field_label, collected.field),
    section: firstText(raw.section_label, raw.crop_structure_label, raw.crop_structure, collected.crop_structure_label, collected.crop_structure),
    crop: firstText(raw.crop_label, raw.crop_name, raw.crop, collected.crop_name, collected.crop),
    areaHa,
    sprayVolumeLHa,
    materials,
    tankTotals,
    date,
    responsible: firstText(raw.responsible_label, raw.responsible, raw.performer, collected.responsible),
    comment,
    recommendations: collectRecommendations(materials, sprayVolumeLHa),
    shortageMessage: null,
    confirm: {
      endpoint: "/api/operations",
      method: "POST",
      idempotencyKey: `assistant-draft-${stableHash(cardSeed)}`,
      body: create.body,
      missingFields: create.missingFields,
    },
  };
}

export function buildAssistantDraftCards(input: BuildDraftCardsInput): AssistantDraftCard[] {
  if (input.pendingActionType !== "create_draft") return [];
  const payload = parsePendingPayload(input.pendingActionPayloadJson);
  if (!payload) return [];
  const draftKind = normalizeDraftKind(cleanText(payload.draftKind) || "operation");
  if (!draftKind) return [];
  if (draftKind === "operation") {
    const operationCard = buildOperationDraftCard(payload);
    return operationCard ? [operationCard] : [];
  }
  return [buildGenericDraftCard(payload, draftKind)];
}
