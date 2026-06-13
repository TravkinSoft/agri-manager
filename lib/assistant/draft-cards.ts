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

export type AssistantDraftCard = AssistantOperationDraftCard;

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
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
  const fromPayload = Array.isArray(payload.missingFields)
    ? payload.missingFields
        .map((item) => {
          if (!item || typeof item !== "object") return publicText(item);
          const row = item as Record<string, unknown>;
          return publicText(row.label) || publicText(row.field);
        })
        .filter(Boolean)
    : [];
  return Array.from(new Set([...fromPayload, ...extraMissing].filter(Boolean) as string[]));
}

function collectOperationCreateBody(params: {
  payload: PendingDraftPayload;
  operationKind: ReturnType<typeof normalizeOperationKind>;
  areaHa: number | null;
  date: string | null;
  comment: string | null;
  sprayVolumeLHa: number | null;
}): { body: Record<string, unknown>; missingFields: string[] } {
  const { payload, operationKind, areaHa, date, comment, sprayVolumeLHa } = params;
  const collected = payload.collectedFields || {};
  const raw = payload.parameters || {};
  const fieldId = firstRawText(raw.field_id, collected.field_id, collected.field);
  const cropStructureId = firstRawText(raw.crop_structure_id, raw.cropStructureId, collected.crop_structure_id, collected.crop_structure);
  const responsibleId = firstRawText(raw.responsible_user_id, raw.responsible_id, collected.responsible_user_id);
  const operationCategorySlug = firstRawText(raw.operation_category_slug, raw.categorySlug) || operationKind.categorySlug;
  const operationTypeSlug = firstRawText(raw.operation_type_slug, raw.typeSlug) || operationKind.typeSlug;
  const operationType = operationKind.operationType || firstText(raw.operation_type, raw.work, collected.operation_type);
  const missing: string[] = [];

  if (!fieldId || !isUuidLike(fieldId)) missing.push("поле");
  if (!cropStructureId || !isUuidLike(cropStructureId)) missing.push("участок");
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

function buildOperationDraftCard(payload: PendingDraftPayload): AssistantDraftCard | null {
  const raw = payload.parameters || {};
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
  const draftKind = cleanText(payload.draftKind) || "operation";
  if (draftKind !== "operation") return [];
  const operationCard = buildOperationDraftCard(payload);
  return operationCard ? [operationCard] : [];
}
