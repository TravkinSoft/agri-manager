import {
  OPERATION_SUBTYPE_DEFINITIONS,
  OPERATION_TYPE_DEFINITIONS,
  resolveCanonicalOperationType,
} from "@/lib/operations/operation-engine";
import {
  formatMaterialRateUnitRu,
  formatMaterialUnitRu,
  normalizeMaterialRateBasis,
} from "@/lib/materials/metadata";
import type {
  OperationCompletionRequest,
  OperationLine,
  OperationMaterial,
  OperationProgressReport,
  OperationWithDetails,
} from "@/lib/types/operation";

export type OperationDisplayStatus =
  | "planned"
  | "accepted"
  | "in_progress"
  | "paused"
  | "awaiting_reconciliation"
  | "awaiting_approval"
  | "completed"
  | "cancelled";

export type OperationDetailRow = {
  key: string;
  label: string;
  value: string;
};

export type OperationPlanLinePresentation = {
  id: string;
  fieldName: string | null;
  cropName: string | null;
  varietyName: string | null;
  reproductionName: string | null;
  plannedAreaHa: number;
};

export type OperationMaterialPresentation = {
  id: string;
  name: string;
  materialType: string;
  plannedRate: number | null;
  rateLabel: string | null;
  plannedQuantity: number;
  unit: string;
  formula: string | null;
  issuedQuantity: number;
  consumedQuantity: number | null;
  returnedQuantity: number | null;
  lossQuantity: number | null;
  isSeed: boolean;
};

export type OperationPresentation = {
  id: string;
  workTitle: string;
  categoryTitle: string;
  fieldName: string;
  cropName: string | null;
  varietyName: string | null;
  reproductionName: string | null;
  plannedAreaHa: number;
  completedAreaHa: number;
  remainingAreaHa: number;
  deviationAreaHa: number;
  progressPercent: number;
  isOverPlan: boolean;
  responsibleName: string | null;
  date: string;
  status: OperationDisplayStatus;
  statusLabel: string;
  machineName: string | null;
  equipmentName: string | null;
  transportName: string | null;
  agronomistComment: string | null;
  details: OperationDetailRow[];
  materials: OperationMaterial[];
  materialRows: OperationMaterialPresentation[];
  planLines: OperationPlanLinePresentation[];
  progressReports: OperationProgressReport[];
  pendingCompletion: OperationCompletionRequest | null;
};

const STATUS_LABELS: Record<OperationDisplayStatus, string> = {
  planned: "Запланировано",
  accepted: "Принято",
  in_progress: "В работе",
  paused: "Приостановлено",
  awaiting_reconciliation: "Ожидает сверку материалов",
  awaiting_approval: "На подтверждении агронома",
  completed: "Завершено",
  cancelled: "Отменено",
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown): string | null {
  const valueText = String(value ?? "").trim();
  return valueText && valueText !== "-" ? valueText : null;
}

function visibleComment(value: unknown): string | null {
  const comment = textValue(value);
  if (!comment || /^auto-created atomically from operation/i.test(comment)) return null;
  return comment;
}

function relationName(value: unknown): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  return textValue(
    record.full_name ||
      record.name ||
      [record.brand, record.model].filter(Boolean).join(" ")
  );
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function formatArea(value: number): string {
  return `${formatNumber(value, 2)} га`;
}

function resolveStatus(operation: OperationWithDetails): OperationDisplayStatus {
  const operationStatus = String(operation.operation_status || operation.status || operation.work_status || "")
    .trim()
    .toLowerCase();
  const taskStatus = String(operation.specialist_task_status || "").trim().toLowerCase();
  const pending = (operation.completion_requests || []).some((request) => request.status === "pending");

  if (operationStatus === "cancelled") return "cancelled";
  if (operationStatus === "completed" || operation.work_status === "completed") return "completed";
  if (operationStatus === "ready_to_close" || taskStatus === "ready_to_close") {
    return "awaiting_reconciliation";
  }
  if (pending || operationStatus === "awaiting_approval" || taskStatus === "awaiting_approval") {
    return "awaiting_approval";
  }
  if (operationStatus === "paused" || taskStatus === "paused") return "paused";
  if (
    operationStatus === "in_progress" ||
    taskStatus === "in_progress"
  ) {
    return "in_progress";
  }
  if (operationStatus === "accepted" || taskStatus === "accepted") return "accepted";
  return "planned";
}

function resolveWorkTitle(operation: OperationWithDetails): string {
  const typeSlug = String(operation.operation_type_slug || "").trim().toLowerCase();
  const subtype = OPERATION_SUBTYPE_DEFINITIONS.find((item) => item.slug === typeSlug);
  if (subtype) return subtype.label;

  const config = (operation.operation_config || {}) as Record<string, unknown>;
  const configuredLabel =
    textValue(operation.operation_engine_label) ||
    textValue(config.operation_engine_label);
  const rawTitle = textValue(operation.operation_type);
  const canonical = resolveCanonicalOperationType({
    categorySlug: operation.operation_category_slug || textValue(config.operation_engine_type),
    typeSlug: operation.operation_type_slug || textValue(config.operation_engine_type),
    operationType: operation.operation_type,
  });
  return configuredLabel || canonical?.label || rawTitle || "Полевая работа";
}

function resolveCategory(operation: OperationWithDetails): string {
  const canonical = resolveCanonicalOperationType({
    categorySlug: operation.operation_category_slug || operation.operation_engine_type,
    typeSlug: operation.operation_type_slug || operation.operation_engine_type,
    operationType: operation.operation_type,
  });
  return canonical?.categorySlug || String(operation.operation_category_slug || "");
}

function resolveCategoryTitle(operation: OperationWithDetails): string {
  const canonical = resolveCanonicalOperationType({
    categorySlug: operation.operation_category_slug || operation.operation_engine_type,
    typeSlug: operation.operation_type_slug || operation.operation_engine_type,
    operationType: operation.operation_type,
  });
  const categorySlug = canonical?.categorySlug || String(operation.operation_category_slug || "");
  return OPERATION_TYPE_DEFINITIONS.find((item) => item.slug === categorySlug)?.label || canonical?.label || "Полевая работа";
}

function readParam(params: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = params[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function buildTypeDetails(operation: OperationWithDetails, plannedAreaHa: number): OperationDetailRow[] {
  const config = (operation.operation_config || {}) as Record<string, unknown>;
  const params = (
    operation.operation_params && typeof operation.operation_params === "object"
      ? operation.operation_params
      : config.operation_params && typeof config.operation_params === "object"
        ? config.operation_params
        : {}
  ) as Record<string, unknown>;
  const category = resolveCategory(operation);
  const rows: OperationDetailRow[] = [];
  const add = (key: string, label: string, raw: unknown, suffix = "") => {
    if (rows.some((row) => row.key === key)) return;
    if (raw === null || raw === undefined || raw === "") return;
    const numeric = Number(raw);
    const value = Number.isFinite(numeric) ? `${formatNumber(numeric, 3)}${suffix}` : String(raw).trim();
    if (value) rows.push({ key, label, value });
  };
  const addChoice = (
    key: string,
    label: string,
    raw: unknown,
    values: Record<string, string>
  ) => {
    if (rows.some((row) => row.key === key)) return;
    const value = textValue(raw);
    if (!value) return;
    rows.push({ key, label, value: values[value] || value });
  };

  if (category === "soil_operation") {
    add("depth", "Глубина обработки", readParam(params, ["depth_cm", "working_depth_cm", "depth"]), " см");
    addChoice("top_removal_method", "Способ удаления ботвы", params.top_removal_method, {
      mowing: "Скашивание",
      shredding: "Измельчение",
      other_mechanical: "Другое механическое удаление",
    });
  }
  if (category === "planting") {
    add("depth", "Глубина", readParam(params, ["planting_depth_cm", "depth_cm", "working_depth_cm", "depth"]), " см");
    add("seed_rate", "Норма семян", operation.rate_per_ha || readParam(params, ["seed_rate_kg_ha"]), " кг/га");
    add(
      "seed_need",
      "Плановая потребность",
      readParam(params, ["seed_requirement_kg"]) ||
        (numberValue(operation.rate_per_ha) > 0 ? numberValue(operation.rate_per_ha) * plannedAreaHa : null),
      " кг"
    );
    add("row_spacing", "Междурядье", readParam(params, ["row_spacing_m"]), " м");
    add("seed_spacing", "Шаг посадки", readParam(params, ["seed_spacing_cm"]), " см");
    add("seed_fraction", "Фракция семян", readParam(params, ["seed_fraction"]));
    add("plants_per_ha", "Расчётная густота", readParam(params, ["calculated_plants_per_ha"]), " растений/га");
    add("total_plants", "Расчётное количество растений", readParam(params, ["calculated_total_plants"]));
  }
  if (category === "spraying" || category === "fertigation") {
    const tankMix = (operation.tank_mix || config.tank_mix || {}) as Record<string, unknown>;
    const solutionRate = numberValue(tankMix.total_solution_l_ha || operation.spray_volume_per_ha);
    const liquidProducts = (operation.materials || [])
      .filter((item) => String(item.unit || "").toLowerCase() === "l" && item.material_type !== "water")
      .reduce((sum, item) => sum + numberValue(item.planned_quantity), 0);
    const totalSolution = solutionRate > 0 ? solutionRate * plannedAreaHa : 0;
    add("solution_rate", "Норма рабочей жидкости", solutionRate || null, " л/га");
    add("liquid_materials", "Сумма жидких материалов", liquidProducts || null, " л");
    add("water", "Вода (расчёт системы)", totalSolution > 0 ? Math.max(totalSolution - liquidProducts, 0) : null, " л");
    add(
      "concentration",
      "Концентрация жидких материалов",
      totalSolution > 0 && liquidProducts > 0 ? (liquidProducts / totalSolution) * 100 : null,
      " %"
    );
    add("solution_total", "Итого готового раствора", totalSolution || null, " л");
  }
  if (category === "irrigation") {
    const waterMm = numberValue(readParam(params, ["water_norm_mm", "water_rate_mm", "irrigation_rate_mm", "rate_mm"]));
    add("water_rate", "Норма воды", waterMm || null, " мм");
    add("water_volume", "Объём воды", waterMm > 0 ? waterMm * plannedAreaHa * 10 : readParam(params, ["water_volume_m3"]), " м³");
    add("zone", "Зона полива", readParam(params, ["irrigation_zone", "zone"]));
    add("duration", "Длительность", readParam(params, ["duration_hours", "duration"]), " ч");
  }
  if (textValue(params.drip_tape_type) || numberValue(params.drip_tape_rolls) > 0) {
    add("row_spacing", "Междурядье", readParam(params, ["row_spacing_m"]), " м");
    add("row_count", "Количество рядов", readParam(params, ["row_count"]));
    add("drip_tape_type", "Тип капельной ленты", readParam(params, ["drip_tape_type"]));
    add("drip_tape_roll_length", "Длина бухты", readParam(params, ["drip_tape_roll_length_m"]), " м");
    add("drip_tape_rolls", "Количество бухт", readParam(params, ["drip_tape_rolls"]));
    add("emitter_spacing", "Шаг эмиттера", readParam(params, ["emitter_spacing_cm"]), " см");
  }
  if (category === "harvesting") {
    add("harvest_method", "Способ уборки", operation.operation_target || readParam(params, ["harvest_method"]));
  }

  return rows;
}

function buildPlanLines(operation: OperationWithDetails): OperationPlanLinePresentation[] {
  return ((operation.operation_lines || []) as OperationLine[]).map((line) => ({
    id: line.id,
    fieldName: textValue(line.field_name),
    cropName: textValue(line.crop_name),
    varietyName: textValue(line.variety_name),
    reproductionName: textValue(line.reproduction_name),
    plannedAreaHa: numberValue(line.planned_area_ha),
  }));
}

function materialFormula(
  material: OperationMaterial,
  plannedAreaHa: number,
  totalSolutionL: number,
  waterL: number
): string | null {
  const rate = numberValue(material.planned_rate);
  const quantity = numberValue(material.planned_quantity);
  if (rate <= 0 || quantity <= 0) return null;
  const basis = normalizeMaterialRateBasis(material.rate_basis);
  const rateUnit = formatMaterialRateUnitRu(material.unit, basis);
  const quantityUnit = formatMaterialUnitRu(material.unit);
  const rateText = formatNumber(rate, 4);
  const quantityText = formatNumber(quantity, 4);

  if (basis === "per_ha") {
    return `${rateText} ${rateUnit} × ${formatNumber(plannedAreaHa, 2)} га = ${quantityText} ${quantityUnit}`;
  }
  if (basis === "per_1000_l_solution") {
    return `${rateText} ${rateUnit} × ${formatNumber(totalSolutionL / 1000, 3)} = ${quantityText} ${quantityUnit}`;
  }
  if (basis === "per_l_water") {
    return `${rateText} ${rateUnit} × ${formatNumber(waterL, 2)} л воды = ${quantityText} ${quantityUnit}`;
  }
  return `${rateText} ${rateUnit} → ${quantityText} ${quantityUnit}`;
}

function buildMaterialRows(
  operation: OperationWithDetails,
  plannedAreaHa: number
): OperationMaterialPresentation[] {
  const materials = operation.materials || [];
  const config = (operation.operation_config || {}) as Record<string, unknown>;
  const tankMix = (operation.tank_mix || config.tank_mix || {}) as Record<string, unknown>;
  const solutionRate = numberValue(tankMix.total_solution_l_ha || operation.spray_volume_per_ha);
  const totalSolutionL = solutionRate * plannedAreaHa;
  const liquidMaterialsL = materials
    .filter((item) => String(item.unit || "").toLowerCase() === "l" && item.material_type !== "water")
    .reduce((sum, item) => sum + numberValue(item.planned_quantity), 0);
  const waterL = Math.max(totalSolutionL - liquidMaterialsL, 0);

  return materials
    .filter((material) => material.material_type !== "water")
    .map((material) => {
      const basis = normalizeMaterialRateBasis(material.rate_basis);
      const plannedRate = material.planned_rate == null ? null : numberValue(material.planned_rate);
      const lossQuantity = (material as OperationMaterial & { loss_quantity?: number | null }).loss_quantity;
      return {
        id: material.id,
        name: textValue(material.product_name) || "Материал",
        materialType: material.material_type,
        plannedRate,
        rateLabel:
          plannedRate != null && plannedRate > 0
            ? `${formatNumber(plannedRate, 4)} ${formatMaterialRateUnitRu(material.unit, basis)}`
            : null,
        plannedQuantity: numberValue(material.planned_quantity),
        unit: formatMaterialUnitRu(material.unit),
        formula: materialFormula(material, plannedAreaHa, totalSolutionL, waterL),
        issuedQuantity: numberValue(material.issued_quantity),
        consumedQuantity: material.consumed_quantity == null ? null : numberValue(material.consumed_quantity),
        returnedQuantity: material.returned_quantity == null ? null : numberValue(material.returned_quantity),
        lossQuantity: lossQuantity == null ? null : numberValue(lossQuantity),
        isSeed: material.material_type === "seed",
      };
    });
}

export function buildOperationPresentation(
  operation: OperationWithDetails,
  options: { responsibleName?: string | null } = {}
): OperationPresentation {
  const lines = (operation.operation_lines || []) as OperationLine[];
  const plannedFromLines = lines.reduce((sum, line) => sum + numberValue(line.planned_area_ha), 0);
  const plannedAreaHa = numberValue(operation.planned_area_ha) || plannedFromLines;
  const progressReports = [...(operation.progress_reports || [])].sort(
    (a, b) => new Date(a.reported_at).getTime() - new Date(b.reported_at).getTime()
  );
  const reportTotal = progressReports.reduce((sum, report) => sum + numberValue(report.completed_area_ha), 0);
  const lineActual = lines.reduce((sum, line) => sum + numberValue(line.actual_area_ha), 0);
  const completedAreaHa = numberValue(operation.completed_area_ha) || reportTotal || lineActual;
  const remainingAreaHa = Math.max(plannedAreaHa - completedAreaHa, 0);
  const deviationAreaHa = Math.round((completedAreaHa - plannedAreaHa) * 10000) / 10000;
  const progressPercent = plannedAreaHa > 0 ? Math.round(((completedAreaHa / plannedAreaHa) * 100) * 100) / 100 : 0;
  const status = resolveStatus(operation);
  const pendingCompletion =
    [...(operation.completion_requests || [])]
      .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())
      .find((request) => request.status === "pending") || null;

  return {
    id: operation.id,
    workTitle: resolveWorkTitle(operation),
    categoryTitle: resolveCategoryTitle(operation),
    fieldName: textValue(operation.field_name) || "Поле не указано",
    cropName: textValue(operation.crop_name),
    varietyName: textValue(operation.variety_name),
    reproductionName: textValue(operation.reproduction_name),
    plannedAreaHa,
    completedAreaHa,
    remainingAreaHa,
    deviationAreaHa,
    progressPercent,
    isOverPlan: deviationAreaHa > 0.000001,
    responsibleName: options.responsibleName || textValue(operation.responsible_name) || textValue(operation.responsible_email),
    date: operation.date,
    status,
    statusLabel: STATUS_LABELS[status],
    machineName: textValue(operation.machine_name) || relationName((operation as any).machine),
    equipmentName: textValue(operation.equipment_name) || relationName((operation as any).equipment),
    transportName: textValue(operation.transport_name) || relationName((operation as any).transport),
    agronomistComment: visibleComment(operation.notes),
    details: buildTypeDetails(operation, plannedAreaHa),
    materials: operation.materials || [],
    materialRows: buildMaterialRows(operation, plannedAreaHa),
    planLines: buildPlanLines(operation),
    progressReports,
    pendingCompletion,
  };
}

export function formatOperationArea(value: number): string {
  return formatArea(value);
}
