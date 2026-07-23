import {
  OPERATION_SUBTYPE_DEFINITIONS,
  OPERATION_TYPE_DEFINITIONS,
  resolveCanonicalOperationType,
} from "@/lib/operations/operation-engine";
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
  | "awaiting_approval"
  | "completed"
  | "cancelled";

export type OperationDetailRow = {
  key: string;
  label: string;
  value: string;
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
  progressReports: OperationProgressReport[];
  pendingCompletion: OperationCompletionRequest | null;
};

const STATUS_LABELS: Record<OperationDisplayStatus, string> = {
  planned: "Запланировано",
  accepted: "Принято",
  in_progress: "В работе",
  paused: "Приостановлено",
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
  if (pending || operationStatus === "awaiting_approval" || taskStatus === "awaiting_approval") {
    return "awaiting_approval";
  }
  if (operationStatus === "paused" || taskStatus === "paused") return "paused";
  if (
    operationStatus === "in_progress" ||
    operationStatus === "ready_to_close" ||
    taskStatus === "in_progress" ||
    taskStatus === "ready_to_close"
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
  const configuredLabel = textValue(config.operation_engine_label);
  const rawTitle = textValue(operation.operation_type);
  const canonical = resolveCanonicalOperationType({
    categorySlug: operation.operation_category_slug || textValue(config.operation_engine_type),
    typeSlug: operation.operation_type_slug || textValue(config.operation_engine_type),
    operationType: operation.operation_type,
  });
  return configuredLabel || canonical?.label || rawTitle || "Полевая работа";
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
  const canonical = resolveCanonicalOperationType({
    categorySlug: operation.operation_category_slug || operation.operation_engine_type,
    typeSlug: operation.operation_type_slug || operation.operation_engine_type,
    operationType: operation.operation_type,
  });
  const category = canonical?.categorySlug || String(operation.operation_category_slug || "");
  const rows: OperationDetailRow[] = [];
  const add = (key: string, label: string, raw: unknown, suffix = "") => {
    if (raw === null || raw === undefined || raw === "") return;
    const numeric = Number(raw);
    const value = Number.isFinite(numeric) ? `${formatNumber(numeric, 3)}${suffix}` : String(raw).trim();
    if (value) rows.push({ key, label, value });
  };

  if (category === "soil_operation" || category === "planting") {
    add("depth", "Глубина", readParam(params, ["depth_cm", "working_depth_cm", "depth"]), " см");
  }
  if (category === "planting") {
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
  }
  if (category === "spraying" || category === "fertigation") {
    const tankMix = (operation.tank_mix || config.tank_mix || {}) as Record<string, unknown>;
    const solutionRate = numberValue(tankMix.total_solution_l_ha || operation.spray_volume_per_ha);
    const components = Array.isArray(tankMix.components) ? tankMix.components as Array<Record<string, unknown>> : [];
    const liquidProducts = components
      .filter((item) => String(item.unit || "").toLowerCase() === "l")
      .reduce((sum, item) => sum + numberValue(item.planned_quantity), 0);
    const totalSolution = solutionRate > 0 ? solutionRate * plannedAreaHa : 0;
    add("solution_rate", "Рабочая жидкость", solutionRate || null, " л/га");
    add("solution_total", "Готовый раствор", totalSolution || null, " л");
    add("water", "Вода", totalSolution > 0 ? Math.max(totalSolution - liquidProducts, 0) : null, " л");
  }
  if (category === "irrigation") {
    const waterMm = numberValue(readParam(params, ["water_rate_mm", "irrigation_rate_mm", "rate_mm"]));
    add("water_rate", "Норма воды", waterMm || null, " мм");
    add("water_volume", "Объём воды", waterMm > 0 ? waterMm * plannedAreaHa * 10 : readParam(params, ["water_volume_m3"]), " м³");
    add("zone", "Зона полива", readParam(params, ["irrigation_zone", "zone"]));
    add("duration", "Длительность", readParam(params, ["duration_hours", "duration"]), " ч");
  }
  if (category === "harvesting") {
    add("harvest_method", "Способ уборки", operation.operation_target || readParam(params, ["harvest_method"]));
  }

  return rows;
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
    agronomistComment: textValue(operation.notes),
    details: buildTypeDetails(operation, plannedAreaHa),
    materials: operation.materials || [],
    progressReports,
    pendingCompletion,
  };
}

export function formatOperationArea(value: number): string {
  return formatArea(value);
}
