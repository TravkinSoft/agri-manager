import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyAssistantIntent } from "@/lib/assistant/engine/router";
import { getAssistantTool } from "@/lib/assistant/engine/tools";
import { normalizeAssistantUiContext } from "@/lib/assistant/engine/runtime";
import {
  EMPTY_ASSISTANT_SESSION_STATE,
  normalizeSessionState,
  updateSessionStateFromToolOutput,
} from "@/lib/assistant/engine/session-state";
import type {
  AssistantAnswerDiagnostics,
  AssistantDecisionSource,
  AssistantEngineInput,
  AssistantEngineMode,
  AssistantEngineResult,
  AssistantIntent,
  AssistantIntentName,
  AssistantNavigationAction,
  AssistantOutputType,
  AssistantSessionState,
  AssistantUiContext,
  AssistantToolCallLog,
  AssistantToolName,
  AssistantToolOutput,
} from "@/lib/assistant/engine/types";
import { buildAssistantModelCandidateList, resolveAssistantModelConfig } from "@/lib/assistant/openai";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { ServerActorContext } from "@/lib/auth/server-session";
import { isAgroKnowledgeQuestion, resolveAssistantMode } from "@/lib/assistant/agro-taxonomy";
import {
  resolveTravkinCorePrompt,
  TRAVKIN_CORE_PROMPT_UPDATED_AT,
  TRAVKIN_CORE_PROMPT_VERSION,
  type TravkinPromptSource,
} from "@/lib/assistant/prompts/travkin-core-prompt";
import {
  applySemanticExpansions,
  buildSemanticMemoryContext,
} from "@/lib/assistant/knowledge/semantic-memory";
import { runModelOrchestrator } from "@/lib/assistant/engine/model-orchestrator";
import { applyNavigationPolicy, hasExplicitNavigationRequest } from "@/lib/assistant/engine/navigation-policy";
import { noDataGroundedMessage, validateGroundedAnswer } from "@/lib/assistant/engine/response-validator";

type UsageStats = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type PromptMeta = {
  promptVersion: string;
  promptSource: TravkinPromptSource;
  promptUpdatedAt: string;
};

type LlmDiagnostics = {
  status: "not_called" | "ok" | "missing_api_key" | "network_error" | "http_error" | "invalid_response";
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  missingEnv: string[];
};

function llmNotCalled(): LlmDiagnostics {
  return {
    status: "not_called",
    httpStatus: null,
    errorCode: null,
    errorMessage: null,
    missingEnv: [],
  };
}

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeAnswerBlocks(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(String(value));
  });
  return result;
}

function safeText(value: unknown, fallback = "—"): string {
  return cleanString(value) || fallback;
}

function formatNumber(value: number, maximumFractionDigits = 3): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function formatKg(value: unknown): string {
  const qty = asNumber(value);
  return `${formatNumber(qty, 3)} кг`;
}

function formatKgAndTons(value: unknown): string {
  const qty = asNumber(value);
  return `${formatNumber(qty, 3)} кг / ${formatNumber(qty / 1000, 3)} т`;
}

function formatDateTime(value: unknown): string {
  const text = cleanString(value);
  if (!text) return "—";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("ru-RU");
}

function formatShortDate(value: unknown): string {
  const text = cleanString(value);
  if (!text) return "вЂ”";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function parseListLimit(params?: AssistantIntent["parameters"], fallback = 5): number {
  const parsed = Number(params?.limit);
  let value = Number.isFinite(parsed) ? Math.trunc(parsed) : NaN;
  if (!Number.isFinite(value)) {
    const queryText = `${cleanString(params?.query) || ""} ${cleanString(params?.entityQuery) || ""}`;
    const match = queryText.match(/\b([1-8])\b/);
    if (match) {
      value = Number(match[1]);
    }
  }
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(8, value));
}

function displayCropLabel(value: string | null): string | null {
  const key = safeText(value, "").toLowerCase();
  if (!key) return null;
  if (key === "potato") return "картофель";
  if (key === "wheat") return "пшеница";
  if (key === "barley") return "ячмень";
  if (key === "corn") return "кукуруза";
  if (key === "soraya") return "сорая";
  if (key === "gala") return "гала";
  if (key === "baltic rose") return "балтик роуз";
  if (key === "azilit") return "азилит";
  if (key === "colombo") return "коломбо";
  if (key === "impala") return "импала";
  return value;
}

function mapBatchClassLabel(value: unknown): string {
  switch (safeText(value, "commodity").toLowerCase()) {
    case "seed":
      return "Семенной";
    case "feed":
      return "Кормовой";
    case "waste":
      return "Отход";
    case "processing":
      return "Доработка";
    case "rejected":
      return "Брак";
    case "commodity":
    default:
      return "Товарный";
  }
}

function mapDirectionLabel(value: unknown): string {
  switch (safeText(value, "").toLowerCase()) {
    case "in":
    case "incoming":
      return "Приход";
    case "out":
    case "outgoing":
      return "Расход";
    case "transfer":
      return "Перемещение";
    default:
      return safeText(value);
  }
}

function mapTicketStatusLabel(value: unknown): string {
  switch (safeText(value, "").toLowerCase()) {
    case "open":
    case "active":
      return "Открыт";
    case "closed":
      return "Закрыт";
    case "voided":
      return "Сторно";
    default:
      return safeText(value);
  }
}

function mapFuelMovementType(value: unknown): string {
  switch (safeText(value, "").toLowerCase()) {
    case "issue":
      return "Выдача";
    case "transfer":
      return "Перемещение";
    case "refill":
      return "Пополнение";
    default:
      return safeText(value);
  }
}

function isRoleAllowed(settings: AssistantPlatformSettings, role: string): boolean {
  return (settings.allowedRoles || []).includes(role as any);
}

function parseFiltersJson(value: unknown): Record<string, string> | null {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const output: Record<string, string> = {};
    Object.entries(parsed || {}).forEach(([key, inner]) => {
      const text = cleanString(inner);
      if (text) output[key] = text;
    });
    return Object.keys(output).length ? output : null;
  } catch {
    return null;
  }
}

function resolveOutputType(intent: AssistantIntent): AssistantOutputType {
  const raw = cleanString(intent.parameters.output_type);
  if (
    raw === "summary_total" ||
    raw === "filtered_summary" ||
    raw === "list" ||
    raw === "action_navigation" ||
    raw === "balance" ||
    raw === "movements"
  ) {
    return raw;
  }

  const fallbackByIntent: Record<AssistantIntentName, AssistantOutputType> = {
    warehouse_count: "summary_total",
    inventory_balance: "balance",
    warehouse_movements: "movements",
    weighbridge_tickets: "filtered_summary",
    crop_structure_area: "summary_total",
    field_total_area: "summary_total",
    rotation_history: "filtered_summary",
    fields_overview: "list",
    crop_structure_overview: "summary_total",
    operations_recent: "list",
    fuel_balance: "balance",
    fuel_movements: "movements",
    entity_resolution: "filtered_summary",
    company_context: "summary_total",
    navigation_help: "action_navigation",
    create_draft: "filtered_summary",
    clarification_required: "filtered_summary",
    general_question: "filtered_summary",
  };

  return fallbackByIntent[intent.name] || "filtered_summary";
}

function getExpectedAnswerType(intentName: AssistantIntentName): AssistantOutputType | null {
  const map: Record<AssistantIntentName, AssistantOutputType | null> = {
    warehouse_count: "summary_total",
    inventory_balance: "balance",
    warehouse_movements: "movements",
    weighbridge_tickets: "filtered_summary",
    crop_structure_area: "summary_total",
    field_total_area: "summary_total",
    rotation_history: "filtered_summary",
    fields_overview: "list",
    crop_structure_overview: "summary_total",
    operations_recent: "list",
    fuel_balance: "balance",
    fuel_movements: "movements",
    entity_resolution: "filtered_summary",
    company_context: "summary_total",
    navigation_help: "action_navigation",
    create_draft: "filtered_summary",
    clarification_required: null,
    general_question: null,
  };
  return map[intentName] ?? null;
}

function getSelectedSource(intentName: AssistantIntentName): string | null {
  const map: Record<AssistantIntentName, string | null> = {
    warehouse_count: "warehouses",
    inventory_balance: "inventory_balance_view",
    warehouse_movements: "stock_ledger_entries",
    weighbridge_tickets: "tickets",
    crop_structure_area: "crop_structure",
    field_total_area: "fields",
    rotation_history: "field_history",
    fields_overview: "fields",
    crop_structure_overview: "crop_structure",
    operations_recent: "operations",
    fuel_balance: "fuel_balances",
    fuel_movements: "fuel_movements",
    entity_resolution: "entity_resolver",
    company_context: "company_context",
    navigation_help: "route_registry",
    create_draft: "draft_engine",
    clarification_required: null,
    general_question: null,
  };
  return map[intentName] ?? null;
}

function summarizeMemoryForIntent(state: AssistantSessionState, intentName: AssistantIntentName): string | null {
  switch (intentName) {
    case "warehouse_count":
      return state.lastWarehouseCount !== null ? `last_warehouse_count=${state.lastWarehouseCount}` : null;
    case "inventory_balance":
      return state.lastInventoryTotalKg !== null ? `last_inventory_kg=${state.lastInventoryTotalKg}` : null;
    case "crop_structure_area":
      return state.lastCropStructureAreaHa !== null ? `last_crop_structure_area_ha=${state.lastCropStructureAreaHa}` : null;
    case "field_total_area":
      return state.lastFieldsAreaHa !== null ? `last_fields_area_ha=${state.lastFieldsAreaHa}` : null;
    default:
      return null;
  }
}

function collectMetricsFromOutputs(outputs: AssistantToolOutput[]): {
  warehouseCount: number | null;
  inventoryTotalKg: number | null;
  cropAreaHa: number | null;
  fieldsAreaHa: number | null;
  primaryTool: string | null;
} {
  let warehouseCount: number | null = null;
  let inventoryTotalKg: number | null = null;
  let cropAreaHa: number | null = null;
  let fieldsAreaHa: number | null = null;
  const primaryTool = outputs[0]?.source.tableOrView || null;

  outputs.forEach((output) => {
    const table = String(output.source.tableOrView || "").toLowerCase();
    const rows = output.rows || [];

    if (table.includes("warehouse") && !table.includes("balance")) {
      warehouseCount = rows.length;
    }

    const qtySum = rows.reduce((acc, row) => acc + asNumber(row.quantity), 0);
    if (table.includes("balance") || table.includes("stock")) {
      inventoryTotalKg = Number(qtySum.toFixed(3));
    }

    const areaSum = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
    if (table.includes("crop_structure")) {
      cropAreaHa = Number(areaSum.toFixed(3));
    }
    if (table === "fields" || table.includes("fields")) {
      fieldsAreaHa = Number(areaSum.toFixed(3));
    }
  });

  return { warehouseCount, inventoryTotalKg, cropAreaHa, fieldsAreaHa, primaryTool };
}

function validateAnswerDataByIntent(params: {
  intent: AssistantIntent;
  outputs: AssistantToolOutput[];
  nextState: AssistantSessionState;
}): {
  pass: boolean;
  contradictionDetected: boolean;
  correctionApplied: boolean;
  correctionText: string | null;
  inconsistencyText: string | null;
} {
  const { intent, outputs, nextState } = params;
  const metrics = collectMetricsFromOutputs(outputs);
  let contradictionDetected = false;
  let correctionApplied = false;
  let correctionText: string | null = null;
  let inconsistencyText: string | null = null;
  let pass = true;

  if (intent.name === "warehouse_count") {
    const count = metrics.warehouseCount ?? 0;
    if (count <= 0 && (nextState.lastInventoryTotalKg || 0) > 0) {
      pass = false;
      contradictionDetected = true;
      correctionApplied = true;
      correctionText =
        `Вы правы: остатки на складах были найдены ранее (${formatKgAndTons(nextState.lastInventoryTotalKg || 0)}), значит склады есть. ` +
        "Ошибка была в выборе источника для вопроса о количестве складов.";
    }
  }

  if (intent.name === "inventory_balance") {
    const total = metrics.inventoryTotalKg ?? 0;
    if (total <= 0 && (nextState.lastInventoryTotalKg || 0) > 0) {
      pass = false;
      contradictionDetected = true;
      correctionApplied = true;
      correctionText =
        `Вижу расхождение с предыдущим ответом: ранее было найдено ${formatKgAndTons(nextState.lastInventoryTotalKg || 0)}. ` +
        "Проверю баланс повторно по всем складам.";
    }
  }

  if (intent.name === "field_total_area") {
    const fieldArea = metrics.fieldsAreaHa ?? 0;
    const cropArea = metrics.cropAreaHa ?? 0;
    if (fieldArea <= 0 && cropArea > 0) {
      pass = false;
      contradictionDetected = true;
      inconsistencyText =
        `Вижу расхождение: модуль полей вернул ${formatNumber(fieldArea, 2)} га, ` +
        `а структура посевов показывает ${formatNumber(cropArea, 2)} га. Для посевных площадей использую структуру посевов.`;
    }
  }

  if (intent.name === "crop_structure_area") {
    const cropArea = metrics.cropAreaHa ?? 0;
    if (cropArea <= 0 && (nextState.lastCropStructureAreaHa || 0) > 0) {
      pass = false;
      contradictionDetected = true;
      correctionApplied = true;
      correctionText =
        `Ранее в этом диалоге структура посевов уже давала ${formatNumber(nextState.lastCropStructureAreaHa || 0, 2)} га. ` +
        "Сейчас инструмент вернул 0 строк — это похоже на фильтрацию/контекст, а не на отсутствие данных.";
    }
  }

  return {
    pass,
    contradictionDetected,
    correctionApplied,
    correctionText,
    inconsistencyText,
  };
}

function validateExpectedAnswerType(params: {
  intent: AssistantIntent;
  expected: AssistantOutputType | null;
  outputs: AssistantToolOutput[];
}): boolean {
  const { intent, expected, outputs } = params;
  if (!expected) return true;

  const metrics = collectMetricsFromOutputs(outputs);
  switch (intent.name) {
    case "warehouse_count":
      return metrics.warehouseCount !== null;
    case "inventory_balance":
      return metrics.inventoryTotalKg !== null;
    case "crop_structure_area":
      return metrics.cropAreaHa !== null;
    case "field_total_area":
      return metrics.fieldsAreaHa !== null;
    case "rotation_history":
      return outputs.some((output) => (output.rows || []).length > 0) || outputs.length > 0;
    default:
      return true;
  }
}

function looksLikeErpDataQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(остат|склад|парт|движен|провод|ledger|inventory|warehouse|batch|stock|balance|талон|весов|гсм|топлив|азс|поле|посев|операц|урожа)/.test(
    text
  );
}

function isCapabilitiesQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(что ты умеешь|твои возможности|чем поможешь|help|what can you do)/.test(text);
}

function isContradictionQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(почему|как так|противореч|ошиб|сказал|говорил).*(склад|остат|нет данных|нет склад)/.test(text);
}

function buildContradictionExplanation(state: AssistantSessionState): string | null {
  const hasInventory = Number(state.lastInventoryTotalKg || 0) > 0;
  const hasWarehouses = Number(state.lastWarehouseCount || 0) > 0;
  if (!hasInventory && !hasWarehouses) return null;
  if (hasInventory && hasWarehouses) {
    return `Вы правы. Исправляю: склады есть (${formatNumber(state.lastWarehouseCount || 0, 0)}), и остатки тоже есть (${formatKgAndTons(
      state.lastInventoryTotalKg || 0
    )}). Ошибка была в выборе источника для вопроса.`;
  }
  if (hasInventory) {
    return `Вы правы. Исправляю: остатки на складах найдены (${formatKgAndTons(
      state.lastInventoryTotalKg || 0
    )}), значит склады в компании есть. Ошибка была в маршрутизации вопроса.`;
  }
  return `Вы правы. Исправляю: склады в компании есть (${formatNumber(
    state.lastWarehouseCount || 0,
    0
  )}).`;
}

function resolveAssistantEngineMode(): AssistantEngineMode {
  const raw = String(process.env.ASSISTANT_ENGINE_MODE || "hybrid").trim().toLowerCase();
  if (raw === "tool_first" || raw === "model_first" || raw === "hybrid") return raw;
  return "hybrid";
}

function resolveHybridDomains(): Set<string> {
  const raw = String(process.env.ASSISTANT_HYBRID_DOMAINS || "").trim();
  if (!raw) return new Set(["warehouses", "weighbridge", "fields", "crop", "operations", "materials", "general"]);
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function mapIntentToDomain(intent: AssistantIntent): string {
  switch (intent.name) {
    case "warehouse_count":
    case "inventory_balance":
    case "warehouse_movements":
      return "warehouses";
    case "weighbridge_tickets":
      return "weighbridge";
    case "fields_overview":
    case "field_total_area":
    case "rotation_history":
      return "fields";
    case "crop_structure_area":
    case "crop_structure_overview":
      return "crop";
    case "operations_recent":
      return "operations";
    case "general_question":
    case "clarification_required":
    default:
      return "general";
  }
}

function isTicketLatestOrRecentQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(талон|ticket).*(послед|latest|recent|last)|(?:послед|latest|recent|last).*(талон|ticket)/.test(text);
}

function isActiveTicketsQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(активн|открыт|open).*(талон|ticket)|(?:талон|ticket).*(активн|открыт|open)/.test(text);
}

function isSimpleCountQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(сколько|how many).*(склад|warehouse|полей|fields)/.test(text);
}

function isExplicitOpenCommand(message: string): boolean {
  return hasExplicitNavigationRequest(message);
}

function isFieldFactualQuery(message: string): boolean {
  const text = String(message || "").toLowerCase();
  const hasField = /(поле|field)\s*[\d\-]+/.test(text) || /[\d\-]+\s*(поле|field)/.test(text);
  if (!hasField) return false;
  if (/(что происходит|что делали|какие проблем|какие риски|почему|что дальше)/.test(text)) return false;
  return /(площад|культура|сорт|репродукц|area|crop|variety|reproduction)/.test(text);
}

function isFieldSemanticQuery(message: string): boolean {
  const text = String(message || "").toLowerCase();
  const hasField = /(поле|field)/.test(text);
  if (!hasField) return false;
  return /(что происходит|что делали|какие проблем|какие риски|почему|что дальше|why|issues|risks|what next|what happened)/.test(
    text
  );
}

function isFieldFactualQueryV2(message: string): boolean {
  const text = String(message || "");
  const hasFieldRef =
    /(?:\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field)\s*[\d\-]+/i.test(text) ||
    /[\d\-]+\s*(?:\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field)/i.test(text);
  if (!hasFieldRef) return false;
  const isSemantic =
    /(?:\u0447\u0442\u043e\s+\u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u0438\u0442|\u0447\u0442\u043e\s+\u0434\u0435\u043b\u0430\u043b\u0438|\u043a\u0430\u043a\u0438\u0435\s+\u043f\u0440\u043e\u0431\u043b\u0435\u043c\u044b|\u043a\u0430\u043a\u0438\u0435\s+\u0440\u0438\u0441\u043a\u0438|\u043f\u043e\u0447\u0435\u043c\u0443|\u0447\u0442\u043e\s+\u0434\u0430\u043b\u044c\u0448\u0435|why|issues|risks|what next|what happened)/i.test(
      text
    );
  if (isSemantic) return false;
  return /(?:\u043f\u043b\u043e\u0449\u0430\u0434\u044c|\u043a\u0443\u043b\u044c\u0442\u0443\u0440\u0430|\u0441\u043e\u0440\u0442|\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0446|area|crop|variety|reproduction)/i.test(
    text
  );
}

function shouldUseFastPath(params: {
  message: string;
  intent: AssistantIntent;
  engineMode: AssistantEngineMode;
}): boolean {
  if (params.engineMode === "tool_first") return false;
  const text = String(params.message || "").toLowerCase();
  if (isTicketLatestOrRecentQuestion(text)) return false;
  if (isFieldSemanticQuery(text)) return false;

  if (params.intent.name === "warehouse_count" && isSimpleCountQuestion(text)) return true;
  if (params.intent.name === "fields_overview" && isSimpleCountQuestion(text)) return true;
  if (params.intent.name === "navigation_help" && isExplicitOpenCommand(text)) return true;
  if (params.intent.name === "weighbridge_tickets" && isActiveTicketsQuestion(text)) return true;
  if (params.intent.name === "fields_overview" && (isFieldFactualQuery(text) || isFieldFactualQueryV2(text))) return true;

  return false;
}

type MemoryRoutingResolution = {
  routingMessage: string;
  used: boolean;
  keysUsed: string[];
  resolvedEntitySource: "explicit_user_text" | "session_memory" | "page_context" | "default";
};

function normalizeRoutingText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitFieldInText(text: string): boolean {
  if (/(?:поле|field)\s*\d{1,3}(?:-\d{1,3}){0,2}/i.test(text)) return true;
  if (/\d{1,3}(?:-\d{1,3}){0,2}\s*(?:поле|field)/i.test(text)) return true;
  return false;
}

function hasExplicitWarehouseInText(text: string): boolean {
  if (!/(?:склад|warehouse)/i.test(text)) return false;
  return /(овощн|семенн|зернов|удобр|сзр|seed|grain|fertiliz|chemical|хранилищ)/i.test(text);
}

function resolveRoutingMessageWithMemory(params: {
  message: string;
  state: AssistantSessionState;
  runtimeContext: AssistantUiContext;
}): MemoryRoutingResolution {
  const raw = String(params.message || "").trim();
  const normalized = normalizeRoutingText(raw);
  if (!normalized) {
    return {
      routingMessage: raw,
      used: false,
      keysUsed: [],
      resolvedEntitySource: "default",
    };
  }

  const hasExplicitField = hasExplicitFieldInText(normalized);
  const hasExplicitWarehouse = hasExplicitWarehouseInText(normalized);
  if (hasExplicitField || hasExplicitWarehouse) {
    return {
      routingMessage: raw,
      used: false,
      keysUsed: [],
      resolvedEntitySource: "explicit_user_text",
    };
  }

  const fieldRef =
    cleanString(params.state.lastFieldLabel) ||
    cleanString(params.state.lastField) ||
    cleanString(params.state.lastFieldId) ||
    cleanString(params.runtimeContext.selectedFieldLabel) ||
    cleanString(params.runtimeContext.selectedFieldId);
  const warehouseRef =
    cleanString(params.state.lastWarehouseLabel) ||
    cleanString(params.state.lastWarehouse) ||
    cleanString(params.state.lastWarehouseId) ||
    cleanString(params.runtimeContext.selectedWarehouseLabel) ||
    cleanString(params.runtimeContext.selectedWarehouseId);

  const mentionsMaterials = /(материал|удобр|сзр|семен|внесл|расход|выдали|списан)/i.test(normalized);
  const mentionsOperations = /(операц|работ|делал|выполн|в работе)/i.test(normalized);
  const mentionsHarvest = /(урож|уборк|собрал|собрали|yield|harvest)/i.test(normalized);
  const mentionsWarehouseMoves = /(движ|журнал|приход|ушл|расход|movement|ledger)/i.test(normalized);
  const mentionsWarehouseFollowup = /(по складу|по нему|по этому складу|а по складу)/i.test(normalized);

  if ((mentionsMaterials || mentionsOperations || mentionsHarvest) && fieldRef) {
    const suffix = `по полю ${fieldRef}`;
    return {
      routingMessage: `${raw} ${suffix}`.trim(),
      used: true,
      keysUsed: ["lastFieldLabel", "lastField", "lastFieldId"],
      resolvedEntitySource: cleanString(params.state.lastFieldLabel) || cleanString(params.state.lastField) || cleanString(params.state.lastFieldId)
        ? "session_memory"
        : "page_context",
    };
  }

  if ((mentionsWarehouseMoves || mentionsWarehouseFollowup) && warehouseRef) {
    const suffix = `по складу ${warehouseRef}`;
    return {
      routingMessage: `${raw} ${suffix}`.trim(),
      used: true,
      keysUsed: ["lastWarehouseLabel", "lastWarehouse", "lastWarehouseId"],
      resolvedEntitySource:
        cleanString(params.state.lastWarehouseLabel) ||
        cleanString(params.state.lastWarehouse) ||
        cleanString(params.state.lastWarehouseId)
          ? "session_memory"
          : "page_context",
    };
  }

  return {
    routingMessage: raw,
    used: false,
    keysUsed: [],
    resolvedEntitySource: "default",
  };
}

function formatInventoryRows(
  rows: Array<Record<string, unknown>>,
  intentParams?: AssistantIntent["parameters"]
): string {
  const warehouseAlias = cleanString(intentParams?.warehouse_alias) || cleanString(intentParams?.warehouse);
  const resolvedScopeLabel = warehouseAlias ? `По складу «${warehouseAlias}»` : "По всем активным складам";
  if (!rows.length) return `${resolvedScopeLabel.toLowerCase()} по текущему фильтру остатки не найдены.`;
  const byProduct = new Map<string, number>();
  const byWarehouse = new Map<string, number>();
  let total = 0;
  let hasNegative = false;

  rows.forEach((row) => {
    const product = safeText(row.product_name);
    const warehouse = safeText(row.warehouse_name);
    const qty = asNumber(row.quantity);
    total += qty;
    if (qty < 0) hasNegative = true;
    byProduct.set(product, (byProduct.get(product) || 0) + qty);
    byWarehouse.set(warehouse, (byWarehouse.get(warehouse) || 0) + qty);
  });

  const topProducts = Array.from(byProduct.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const majorWarehouse = Array.from(byWarehouse.entries()).sort((a, b) => b[1] - a[1])[0];
  const compactLines: string[] = [];
  compactLines.push(`${resolvedScopeLabel}: ${formatKgAndTons(total)}.`);
  if (majorWarehouse) {
    compactLines.push(`Основной объём: ${majorWarehouse[0]} — ${formatKgAndTons(majorWarehouse[1])}.`);
  }
  compactLines.push("Короткая разбивка:");
  topProducts.forEach(([product, qty]) => compactLines.push(`• ${product}: ${formatKgAndTons(qty)}`));
  if (rows.length > topProducts.length) {
    compactLines.push(`Показываю топ ${topProducts.length} из ${rows.length}.`);
  }
  if (hasNegative) {
    compactLines.push("⚠ Есть отрицательные остатки. Проверьте ledger и последние движения.");
  }
  return compactLines.join("\n");
}

function formatWarehouseCountRows(
  rows: Array<Record<string, unknown>>,
  outputType: AssistantOutputType
): string {
  if (!rows.length) return "Склады в компании не найдены.";

  const total = rows.length;
  const active = rows.filter((row) => {
    const archivedFlag = String(row.archived ?? row.is_archived ?? "").toLowerCase();
    return archivedFlag !== "true" && archivedFlag !== "1";
  }).length;
  const byType = new Map<string, number>();
  rows.forEach((row) => {
    const type = safeText(row.warehouse_type, "не указан");
    byType.set(type, (byType.get(type) || 0) + 1);
  });
  const typeBreakdown = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => `• ${type}: ${count}`);

  const header = [
    `Всего складов: ${total}.`,
    `Активных: ${active}.`,
    typeBreakdown.length ? "По типам:" : "",
    ...typeBreakdown,
  ]
    .filter(Boolean)
    .join("\n");

  if (outputType !== "list") {
    return header;
  }

  const listLines = rows
    .slice(0, 12)
    .map((row) => {
      const name = safeText((row as any).warehouse_name ?? (row as any).name);
      const type = safeText((row as any).warehouse_type, "не указан");
      const archived = String((row as any).archived ?? (row as any).is_archived ?? "").toLowerCase();
      const status = archived === "true" || archived === "1" ? "архив" : "активный";
      return `• ${name} (${type}) — ${status}`;
    });

  return [header, "", "Список складов:", ...listLines].join("\n");
}

function formatWarehouseMovementsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Последние движения по складам не найдены.";
  const lines = rows.slice(0, 12).map((row) => {
    return `• ${formatDateTime(row.date)} · ${mapDirectionLabel(row.direction)} · ${safeText(row.warehouse_name)} · ${safeText(
      row.product_name
    )} · ${formatKg(row.quantity)} (${mapBatchClassLabel(row.batch_class)})`;
  });
  return `Последние движения склада:\n\n${lines.join("\n")}`;
}

function formatFieldsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Поля по текущему фильтру не найдены.";
  const lines = rows
    .slice(0, 12)
    .map((row) => `• ${safeText(row.field_name)} — ${formatNumber(asNumber(row.area_ha), 2)} га`);
  return `Поля компании:\n\n${lines.join("\n")}`;
}

function formatFieldsSummaryRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Поля по компании не найдены.";

  const totalArea = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const fieldsCount = rows.length;
  const filledAreaCount = rows.reduce((acc, row) => acc + (asNumber(row.area_ha) > 0 ? 1 : 0), 0);
  const withoutAreaCount = Math.max(0, fieldsCount - filledAreaCount);

  return [
    `Всего земли в хозяйстве: ${formatNumber(totalArea, 2)} га`,
    `Полей: ${formatNumber(fieldsCount, 0)}`,
    `Заполнено по площади: ${formatNumber(filledAreaCount, 0)}, без площади: ${formatNumber(withoutAreaCount, 0)}`,
  ].join("\n");
}

function formatFieldTimelineRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "История поля не найдена.";
  const lines = rows.slice(0, 8).map((row) => {
    const date = formatDateTime(row.date);
    const eventType = safeText(row.event_type, "event");
    const title = safeText(row.title, "");
    const qty = Number.isFinite(Number(row.qty_kg)) ? ` · ${formatKg(row.qty_kg)}` : "";
    return `• ${date} · ${eventType}${title ? ` · ${title}` : ""}${qty}`;
  });
  return `История поля:\n\n${lines.join("\n")}`;
}

function formatFieldMaterialsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Материалы по полю не найдены.";
  const total = rows.reduce((acc, row) => acc + asNumber(row.qty_kg), 0);
  const lines = rows
    .slice(0, 8)
    .map((row) => `• ${safeText(row.product_name)} — ${formatNumber(asNumber(row.qty_kg), 3)} кг`);
  return [`Материалы по полю: ${formatNumber(total, 3)} кг`, "", ...lines].join("\n");
}

function formatCropStructureRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Структура посевов по текущему сезону не найдена.";
  const lines = rows.slice(0, 12).map((row) => {
    return `• ${safeText(row.field_name)}: ${safeText(row.crop_name)} / ${safeText(row.variety_name)} / ${safeText(
      row.reproduction_name
    )} — ${formatNumber(asNumber(row.area_ha), 2)} га (сезон ${safeText(row.season_year)})`;
  });
  return `Структура посевов:\n\n${lines.join("\n")}`;
}

function formatCropStructureSummaryRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Структура посевов по текущему сезону не найдена.";
  const totalArea = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const lines = rows.slice(0, 12).map((row) => {
    const fieldsCount = Number.isFinite(Number(row.fields_count)) ? Number(row.fields_count) : 0;
    const fieldsLabel = fieldsCount > 0 ? ` (${fieldsCount} полей)` : "";
    return `• ${safeText(row.crop_name)} — ${formatNumber(asNumber(row.area_ha), 2)} га${fieldsLabel}`;
  });
  return `Всего посевных площадей: ${formatNumber(totalArea, 2)} га\n\n${lines.join("\n")}`;
}

function formatCropStructureSummaryRowsV2(
  rows: Array<Record<string, unknown>>,
  outputType: AssistantOutputType,
  seasonLabel: string,
  intentParams: AssistantIntent["parameters"]
): string {
  if (!rows.length) return `По сезону ${seasonLabel} данных не найдено.`;
  const totalArea = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const cropsCount = rows.length;
  const fieldsTotal = rows.reduce((acc, row) => acc + asNumber(row.fields_count), 0);
  const topRowsLimit = outputType === "summary_total" ? 3 : 8;
  const requestedCrop =
    cleanString(intentParams.crop_alias) ||
    cleanString(intentParams.crop) ||
    null;
  const requestedCropLabel = displayCropLabel(requestedCrop);
  const inferredCropLabel = requestedCropLabel || (rows.length === 1 ? cleanString(rows[0]?.crop_name) : null);
  const hasFactArea = rows.some((row) => {
    const fact =
      asNumber((row as any).fact_area_ha) ||
      asNumber((row as any).actual_area_ha) ||
      asNumber((row as any).fact_ha);
    return fact > 0;
  });
  const topRows = rows.slice(0, topRowsLimit).map((row) => {
    const fieldsCount = Number.isFinite(Number(row.fields_count)) ? Number(row.fields_count) : 0;
    const fieldsLabel = fieldsCount > 0 ? ` (${fieldsCount} полей)` : "";
    return `• ${safeText(row.crop_name)} — ${formatNumber(asNumber(row.area_ha), 2)} га${fieldsLabel}`;
  });

  const keyLine = inferredCropLabel
    ? `По плану в структуре посевов ${seasonLabel}: ${inferredCropLabel} — ${formatNumber(totalArea, 2)} га.`
    : `По плану в структуре посевов ${seasonLabel}: всего ${formatNumber(totalArea, 2)} га.`;
  const factLine = hasFactArea
    ? `По факту выполнено: ${formatNumber(rows.reduce((acc, row) => acc + asNumber((row as any).fact_area_ha || (row as any).actual_area_ha || (row as any).fact_ha), 0), 2)} га.`
    : "Факта посева/операций пока не вижу.";
  const header = [
    keyLine,
    `Культур: ${cropsCount}`,
    fieldsTotal > 0 ? `Полей в разрезе структуры: ${fieldsTotal}` : "Заполнено/не заполнено: нет данных",
    factLine,
  ];

  if (outputType === "summary_total") {
    return [...header, "", ...topRows].join("\n");
  }
  return [...header, "", ...topRows].join("\n");
}

function formatTicketsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Талоны не найдены.";
  const lines = rows.slice(0, 10).map((row) => {
    return `• ${safeText(row.ticket_no)} · ${mapTicketStatusLabel(row.status)} · ${safeText(
      row.operation
    )} · брутто ${formatKg(row.gross_kg)}, тара ${formatKg(row.tare_kg)}, нетто ${formatKg(row.net_kg)} · ${formatDateTime(row.date)}`;
  });
  return `Талоны весовой:\n\n${lines.join("\n")}`;
}

function formatOperationsRows(
  rows: Array<Record<string, unknown>>,
  intentParams?: AssistantIntent["parameters"]
): string {
  const status = cleanString(intentParams?.status)?.toLowerCase();
  const title =
    status === "active"
      ? "Активные операции"
      : status === "waiting_materials"
        ? "Операции в ожидании материалов"
        : "Последние операции";

  if (!rows.length) return `${title} не найдены.`;
  const lines = rows
    .slice(0, 10)
    .map((row) => `• ${formatDateTime(row.date)} · ${safeText(row.operation_type)} · поле ${safeText(row.field_name)}`);
  return `${title}:\n\n${lines.join("\n")}`;
}

function formatFuelRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Движения ГСМ не найдены.";
  const lines = rows.slice(0, 14).map((row) => {
    const sourceFrom = cleanString(row.from_fuel_source_name);
    const sourceTo = cleanString(row.to_fuel_source_name);
    const sourceSingle = cleanString(row.fuel_source_name);
    const sourceLabel = sourceFrom && sourceTo ? `${sourceFrom} → ${sourceTo}` : sourceSingle || "—";
    return `• ${formatDateTime(row.date)} · ${mapFuelMovementType(row.type)} · ${sourceLabel} · ${formatNumber(
      asNumber(row.liters),
      0
    )} л`;
  });
  return `Движения ГСМ:\n\n${lines.join("\n")}`;
}

function formatFuelBalanceRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "По всем источникам ГСМ остатки не найдены.";
  const totalLiters = rows.reduce((sum, row) => sum + asNumber(row.balance_liters), 0);
  const lines = rows
    .slice(0, 10)
    .map((row) => `• ${safeText(row.fuel_source_name)} — ${formatNumber(asNumber(row.balance_liters), 0)} л`);
  return [`В наличии топлива: ${formatNumber(totalLiters, 0)} л`, "", ...lines].join("\n");
}

function formatCompanyContextRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Контекст компании не определён.";
  const row = rows[0];
  return [
    "Контекст компании:",
    "",
    `• Компания: ${safeText(row.company_name)}`,
    `• Сезон: ${safeText(row.season)}`,
  ].join("\n");
}

function formatWarehouseCountRowsV2(
  rows: Array<Record<string, unknown>>,
  outputType: AssistantOutputType
): string {
  if (!rows.length) return "Активные склады не найдены.";
  const total = rows.length;
  const active = rows.filter((row) => {
    const archivedFlag = String(row.archived ?? row.is_archived ?? "").toLowerCase();
    return archivedFlag !== "true" && archivedFlag !== "1";
  }).length;

  const byType = new Map<string, number>();
  rows.forEach((row) => {
    const type = safeText((row as any).warehouse_type, "не указан");
    byType.set(type, (byType.get(type) || 0) + 1);
  });
  const topTypes = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `• ${type}: ${count}`);

  if (outputType !== "list") {
    return [
      `Активных складов: ${active}.`,
      topTypes.length ? "По типам:" : "",
      ...topTypes,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const shown = rows.slice(0, 5).map((row) => {
    const name = safeText((row as any).warehouse_name ?? (row as any).name);
    const type = safeText((row as any).warehouse_type, "не указан");
    return `• ${name} (${type})`;
  });
  const tail = total > shown.length ? `Показываю ${shown.length} из ${total}.` : "";
  return [`Активных складов: ${active}.`, ...shown, tail].filter(Boolean).join("\n");
}

function formatWarehouseMovementsRowsV2(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Последние движения по складам не найдены.";
  const shown = rows.slice(0, 5);
  const lines = shown.map((row) =>
    `• ${formatShortDate(row.date)}: ${mapDirectionLabel(row.direction)} ${safeText(row.product_name)} (${formatKg(
      row.quantity
    )}) — ${safeText(row.warehouse_name)}`
  );
  const tail = rows.length > shown.length ? `Показываю последние ${shown.length} из ${rows.length}.` : "";
  return [`Последние движения:`, ...lines, tail].filter(Boolean).join("\n");
}

function formatFieldsRowsV2(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Поля по текущему фильтру не найдены.";
  const shown = rows.slice(0, 5);
  const lines = shown.map((row) => `• ${safeText(row.field_name)} — ${formatNumber(asNumber(row.area_ha), 2)} га`);
  const tail = rows.length > shown.length ? `Показываю ${shown.length} из ${rows.length}.` : "";
  return [`Поля:`, ...lines, tail].filter(Boolean).join("\n");
}

function formatFieldsSummaryRowsV2(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Поля компании не найдены.";
  const totalArea = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const fieldsCount = rows.length;
  const filledAreaCount = rows.reduce((acc, row) => acc + (asNumber(row.area_ha) > 0 ? 1 : 0), 0);
  const withoutAreaCount = Math.max(0, fieldsCount - filledAreaCount);
  return [
    `Общая площадь полей: ${formatNumber(totalArea, 2)} га.`,
    `Полей: ${formatNumber(fieldsCount, 0)}.`,
    `С площадью: ${formatNumber(filledAreaCount, 0)}, без площади: ${formatNumber(withoutAreaCount, 0)}.`,
  ].join("\n");
}

function formatFieldTimelineRowsV2(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "История поля не найдена.";
  const labelByType: Record<string, string> = {
    issue: "выдача материалов",
    weighbridge: "весовая",
    operation_fact: "факт операции",
    harvest: "уборка",
  };
  const shown = rows.slice(0, 4);
  const lines = shown.map((row) => {
    const eventType = safeText(row.event_type, "event").toLowerCase();
    const eventLabel = labelByType[eventType] || eventType;
    const title = cleanString(row.title);
    const qty = Number.isFinite(Number((row as any).qty_kg))
      ? `${formatNumber(asNumber((row as any).qty_kg), 2)} кг`
      : Number.isFinite(Number((row as any).net_kg))
        ? `${formatNumber(asNumber((row as any).net_kg), 2)} кг`
        : null;
    return `• ${formatShortDate(row.date)}: ${eventLabel}${title ? ` — ${title}` : ""}${qty ? `, ${qty}` : ""}`;
  });
  const tail = rows.length > shown.length ? `Показываю последние ${shown.length} из ${rows.length}.` : "";
  return [`Последние события по полю:`, ...lines, tail].filter(Boolean).join("\n");
}

function formatFieldMaterialsRowsV2(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Фактические материалы по полю не найдены.";
  const total = rows.reduce((acc, row) => acc + asNumber((row as any).qty_kg), 0);
  const shown = rows.slice(0, 3);
  const lines = shown.map(
    (row) => `• ${safeText((row as any).product_name)} — ${formatNumber(asNumber((row as any).qty_kg), 3)} кг`
  );
  const tail = rows.length > shown.length ? `Показываю топ ${shown.length} из ${rows.length}.` : "";
  return [`Материалы по полю: ${formatNumber(total, 3)} кг.`, ...lines, tail].filter(Boolean).join("\n");
}

function formatTicketsRowsV2(
  rows: Array<Record<string, unknown>>,
  intentParams?: AssistantIntent["parameters"]
): string {
  if (!rows.length) return "Талоны не найдены.";
  const queryText = `${cleanString(intentParams?.query) || ""} ${cleanString(intentParams?.entityQuery) || ""}`.toLowerCase();
  const showTare = /(тара|tare|закрыт|закрытие|взвешиван)/i.test(queryText);
  const showTicketNo = /(номер|ticket|талон\s*№|wb-)/i.test(queryText);
  const wantsSingle = /(последн(ий|его)?\s+талон|last ticket)/i.test(queryText);
  const shown = rows.slice(0, wantsSingle ? 1 : parseListLimit(intentParams, 3));
  const lines = shown.map((row, index) => {
    const vehicle = safeText((row as any).vehicle_label || (row as any).vehicle_name, "машина не указана");
    const driver = safeText((row as any).driver_name, "водитель не указан");
    const product = cleanString((row as any).product_name);
    const variety = cleanString((row as any).variety_name);
    const cropLabel = [product, variety && variety !== "-" ? variety : null].filter(Boolean).join(" ");
    const net = asNumber((row as any).net_kg);
    const gross = asNumber((row as any).gross_kg);
    const tare = asNumber((row as any).tare_kg);
    const status = safeText((row as any).status, "").toLowerCase();
    const isFinal = status === "finalized" || status === "closed";
    const weightPart = net > 0 && isFinal ? `Нетто ${formatNumber(net, 3)} кг` : `Брутто ${formatNumber(gross, 3)} кг`;
    const tarePart = showTare && tare > 0 ? `, тара ${formatNumber(tare, 3)} кг` : "";
    const statusPart = isFinal ? `, закрыт ${formatShortDate((row as any).date)}` : ", талон открыт";
    const no = showTicketNo ? `${safeText((row as any).ticket_no)}: ` : "";
    const prefix = shown.length === 1 ? "Последний талон" : `${index + 1})`;
    return `${prefix}: ${no}${vehicle}, ${driver}${cropLabel ? `, ${cropLabel}` : ""}. ${weightPart}${tarePart}${statusPart}.`;
  });
  const tail = rows.length > shown.length ? `Показываю последние ${shown.length} из ${rows.length}.` : "";
  return [...lines, tail].filter(Boolean).join("\n");
}

function formatFieldCardRowsV2(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Поле не найдено.";
  const row = rows[0];
  const area = formatNumber(asNumber((row as any).area_ha), 2);
  const cropList = Array.isArray((row as any).crops) ? ((row as any).crops as string[]).filter(Boolean) : [];
  const cropText = cropList.length ? cropList.slice(0, 3).join(", ") : "культура не указана";
  const activeOps = asNumber((row as any).active_operations_count);
  const issued = formatNumber(asNumber((row as any).material_issued_kg), 3);
  const harvest = formatNumber(asNumber((row as any).harvest_net_kg), 3);
  return [
    `${safeText((row as any).field_name)}: ${area} га.`,
    `По плану: ${cropText}.`,
    `Активные операции: ${activeOps}. Материалы факт: ${issued} кг, урожай факт: ${harvest} кг.`,
  ].join("\n");
}

function formatGroundedToolOutput(params: {
  toolName: AssistantToolName;
  intentName: AssistantIntentName;
  outputType: AssistantOutputType;
  intentParams: AssistantIntent["parameters"];
  output: AssistantToolOutput;
}): string | null {
  const { toolName, intentName, output, outputType, intentParams } = params;
  const rows = output.rows || [];
  const sourceSeason = cleanString(output.source.season);

  if (intentName === "warehouse_count" || toolName === "search_warehouses") {
    return formatWarehouseCountRowsV2(rows, outputType);
  }
  if (intentName === "inventory_balance" || toolName === "get_warehouse_balances" || toolName === "get_inventory") {
    return formatInventoryRows(rows, intentParams);
  }
  if (intentName === "warehouse_movements" || toolName === "get_warehouse_movements") {
    return formatWarehouseMovementsRowsV2(rows);
  }
  if (intentName === "field_total_area") {
    return formatFieldsSummaryRowsV2(rows);
  }
  if (
    intentName === "fields_overview" &&
    (toolName === "search_fields" || toolName === "get_fields" || toolName === "find_field")
  ) {
    return outputType === "summary_total" ? formatFieldsSummaryRowsV2(rows) : formatFieldsRowsV2(rows);
  }
  if (intentName === "rotation_history" || toolName === "get_field_timeline") {
    return formatFieldTimelineRowsV2(rows);
  }
  if (toolName === "get_field_materials") {
    return formatFieldMaterialsRowsV2(rows);
  }
  if (toolName === "get_field_card") {
    return formatFieldCardRowsV2(rows);
  }
  if (toolName === "get_crop_structure_summary") {
    if (!rows.length) {
      const queryText = cleanString(intentParams.query)?.toLowerCase() || "";
      const cropText = `${cleanString(intentParams.crop) || ""} ${cleanString(intentParams.crop_alias) || ""}`.toLowerCase();
      const potatoRequested = /картоф|potato|гала|gala|сорая|soraya|балтик|baltic|азилит|azilit/.test(
        `${cropText} ${queryText}`
      );
      if (potatoRequested) {
        return `В структуре ${sourceSeason || "2026"} картофель не найден.`;
      }
      return `По сезону ${sourceSeason || "2026"} данных не найдено.`;
    }
    return formatCropStructureSummaryRowsV2(rows, outputType, sourceSeason || "2026", intentParams);
  }
  if (intentName === "crop_structure_area") {
    if (toolName !== "get_crop_structure" && toolName !== "search_crops_by_group") {
      return null;
    }
    const hasAreaColumn = rows.some((row) => Object.prototype.hasOwnProperty.call(row, "area_ha"));
    const hasPositiveArea = rows.some((row) => asNumber((row as any).area_ha) > 0);
    if (!hasAreaColumn) return null;
    if (toolName === "search_crops_by_group" && !hasPositiveArea) return null;
    if (!rows.length) return `По сезону ${sourceSeason || "2026"} данных не найдено.`;
    return formatCropStructureSummaryRowsV2(rows, "summary_total", sourceSeason || "2026", intentParams);
  }
  if (intentName === "crop_structure_overview" || toolName === "get_crop_structure") {
    if (outputType !== "list") return null;
    if (!rows.length) {
      return `По сезону ${sourceSeason || "2026"} данных не найдено.`;
    }
    return formatCropStructureRows(rows);
  }
  if (intentName === "weighbridge_tickets") {
    if (
      toolName !== "get_weighbridge_tickets" &&
      toolName !== "get_ticket_details" &&
      toolName !== "get_active_tickets" &&
      toolName !== "get_recent_tickets"
    ) {
      return null;
    }
    return formatTicketsRowsV2(rows, intentParams);
  }
  if (intentName === "operations_recent" || toolName === "get_operations") {
    return formatOperationsRows(rows, intentParams);
  }
  if (intentName === "fuel_balance" || toolName === "get_fuel_balances") {
    return formatFuelBalanceRows(rows);
  }
  if (intentName === "fuel_movements" || toolName === "get_fuel_movements") {
    return formatFuelRows(rows);
  }
  if (intentName === "company_context" || toolName === "get_company_context" || toolName === "get_current_season") {
    return formatCompanyContextRows(rows);
  }
  if (toolName.startsWith("create_")) {
    const message = cleanString(rows[0]?.message);
    return (
      message ||
      "Черновик подготовлен. Проверьте обязательные поля и подтвердите выполнение вручную."
    );
  }

  return null;
}

function buildCapabilitiesAnswer(locale: "ru" | "en" | "kz"): string {
  if (locale === "en") {
    return [
      "I can help in Travkin Flow with:",
      "• Warehouse balances and identity-level stock.",
      "• Batch search and class split (commodity/seed/feed/waste).",
      "• Warehouse, ledger and fuel movement summaries.",
      "• Crop structure and field material usage context.",
      "• ERP navigation to the needed page/entity.",
      "• Action draft preparation with human confirmation.",
    ].join("\n");
  }

  if (locale === "kz") {
    return [
      "Travkin Flow бойынша көмектесе аламын:",
      "• Қойма қалдықтары мен identity бойынша бөлініс.",
      "• Партияларды және class бөлінісін көрсету.",
      "• Қойма/ledger/ГСМ қозғалыстарының қысқаша есебі.",
      "• Егіс құрылымы мен материал шығынын түсіндіру.",
      "• ERP ішінде керек бетке/объектіге өту.",
      "• Әрекет черновигін дайындау (міндетті растаумен).",
    ].join("\n");
  }

  return [
    "Я могу помочь в Travkin Flow с такими задачами:",
    "• Показать остатки по складам и identity-структуре.",
    "• Найти партии и разрез по классам (товарный/семенной/кормовой/отход).",
    "• Показать движения склада, ledger и ГСМ.",
    "• Объяснить структуру посевов и выдачу материалов по полям.",
    "• Открыть нужную страницу или объект в ERP.",
    "• Подготовить черновик действия с подтверждением человека.",
  ].join("\n");
}

function mapToolNamespace(tool: AssistantToolName): string {
  const map: Record<string, string> = {
    get_current_context: "context.getPageContext",
    get_routes: "navigation.getRoutes",
    get_company_context: "context.getCompanyContext",
    get_current_season: "context.getCurrentSeason",
    find_field: "field.search",
    search_fields: "field.search",
    get_field_card: "field.summary",
    get_field_timeline: "field.history",
    get_field_materials: "field.materials",
    find_warehouse: "inventory.resolveWarehouse",
    search_warehouses: "inventory.searchWarehouses",
    get_warehouse_count: "inventory.warehouseCount",
    get_warehouse_summary: "inventory.summary",
    get_warehouse_stock: "inventory.balance",
    get_warehouse_balances: "inventory.balance",
    get_warehouse_movements: "inventory.movements",
    find_operation: "operation.search",
    search_operations: "operation.search",
    get_operation_details: "operation.details",
    get_active_operations: "operation.active",
    get_operations: "operation.search",
    get_weighbridge_tickets: "weighbridge.tickets",
    get_active_tickets: "weighbridge.tickets",
    get_recent_tickets: "weighbridge.tickets",
    get_ticket_details: "weighbridge.ticketDetails",
    get_potato_material_report: "report.potato",
    get_crop_structure_summary: "crop.structure",
    get_crop_structure: "crop.structureRows",
    search_crops_by_group: "crop.group",
    get_fuel_balances: "fuel.balance",
    get_fuel_movements: "fuel.movements",
    navigate_to_page: "navigation.navigateToRoute",
    open_entity: "navigation.openEntity",
    apply_filter: "navigation.applyFilter",
  };
  return map[tool] || tool;
}

function buildToolActivityLogs(toolCalls: AssistantToolCallLog[]): string[] {
  return toolCalls.map((toolCall) => {
    const name = mapToolNamespace(toolCall.tool);
    if (toolCall.ok) {
      const rows = Number.isFinite(Number(toolCall.rows)) ? Number(toolCall.rows) : 0;
      return `${name}: ${rows} rows`;
    }
    return `${name}: error (${toolCall.error || "unknown error"})`;
  });
}

function buildSmartFollowUp(intent: AssistantIntent, locale: "ru" | "en" | "kz"): string {
  const ru = locale !== "en" && locale !== "kz";
  if (intent.name === "clarification_required") {
    const focus = cleanString(intent.parameters.focus)?.toLowerCase() || "";
    if (focus.includes("склад")) return ru ? "По какому складу показать данные?" : "Which warehouse should I open?";
    if (focus.includes("пол")) return ru ? "По какому полю нужен срез?" : "Which field do you want to inspect?";
    if (focus.includes("операц")) return ru ? "Нужны активные операции или история?" : "Do you need active operations or history?";
    if (focus.includes("весов") || focus.includes("талон")) return ru ? "Показать активные талоны или последние?" : "Show active tickets or recent ones?";
    if (focus.includes("отчет") || focus.includes("отч")) return ru ? "За какой период и по какой культуре?" : "Which period and crop?";
    if (focus.includes("картоф")) return ru ? "Все поля картофеля или конкретное поле?" : "All potato fields or one field?";
    return ru ? "Уточните объект: поле, склад, операция или период?" : "Specify object: field, warehouse, operation, or period.";
  }
  return "";
}

function getToolNamesForIntent(intent: AssistantIntent, settings: AssistantPlatformSettings): AssistantToolName[] {
  const byIntent: Record<AssistantIntentName, AssistantToolName[]> = {
    warehouse_count: ["get_warehouse_count"],
    inventory_balance: ["get_warehouse_stock"],
    warehouse_movements: ["get_warehouse_movements"],
    weighbridge_tickets: ["get_weighbridge_tickets"],
    crop_structure_area: ["get_crop_structure_summary"],
    field_total_area: ["get_fields", "get_crop_structure_summary"],
    rotation_history: ["get_field_timeline"],
    fields_overview: ["get_field_card", "search_fields", "get_fields"],
    crop_structure_overview: ["get_crop_structure_summary"],
    operations_recent: ["get_active_operations", "search_operations"],
    fuel_balance: ["get_fuel_balances"],
    fuel_movements: ["get_fuel_movements"],
    entity_resolution: [],
    company_context: ["get_company_context"],
    navigation_help: ["navigate_to_page"],
    create_draft: ["create_operation_draft"],
    clarification_required: [],
    general_question: [],
  };

  const action = cleanString(intent.parameters.action);
  const entityType = cleanString(intent.parameters.entityType);
  const queryText = cleanString(intent.parameters.query)?.toLowerCase() || "";
  const cropGroup = cleanString(intent.parameters.crop_group);
  const cropAlias = cleanString(intent.parameters.crop_alias) || cleanString(intent.parameters.crop);
  const status = cleanString(intent.parameters.status);
  const intentGroup = cleanString(intent.parameters.intent_group)?.toLowerCase() || "";
  const resolvedType = resolveOutputType(intent);
  const tools = [...(byIntent[intent.name] || [])];

  if (intent.name === "navigation_help" && action === "open_entity") {
    if (entityType === "warehouse") tools.unshift("resolve_warehouse_by_name");
    if (entityType === "field") tools.unshift("resolve_field_by_number");
    if (entityType === "fuel") tools.unshift("resolve_fuel_source_by_name");
    tools.push("open_entity");
  }

  if (intent.name === "navigation_help" && action === "apply_filter") {
    tools.push("apply_filter");
  }

  if (intent.name === "create_draft") {
    if (/(гсм|топлив|дизел|бензин|азс|fuel)/.test(queryText)) {
      tools[0] = "create_fuel_issue_draft";
    } else if (/(перемещ|transfer)/.test(queryText)) {
      tools[0] = "create_transfer_draft";
    } else if (/(талон|весов|ticket|weighbridge)/.test(queryText)) {
      tools[0] = "create_weighbridge_ticket_draft";
    } else if (/(поле|задач|task)/.test(queryText)) {
      tools[0] = "create_field_task_draft";
    }
  }

  if (intent.name === "fields_overview") {
    const fieldQuery = cleanString(intent.parameters.field) || cleanString(intent.parameters.entityQuery);
    const genericFieldListRequested =
      !fieldQuery &&
      (/(какие|список|все|сколько|count|list|all)/i.test(queryText) ||
        /(поля|поле|fields?|field)/i.test(queryText));
    if (resolvedType === "summary_total") {
      tools.splice(0, tools.length, "get_fields");
    } else if (genericFieldListRequested) {
      tools.splice(0, tools.length, "get_fields", "search_fields");
    } else if (queryText) {
      tools.splice(0, tools.length, "get_field_card");
      if (/(материал|удобр|сзр|семен)/i.test(queryText)) {
        tools.push("get_field_materials");
      }
      if (/(истори|севооборот|прошл|timeline)/i.test(queryText)) {
        tools.push("get_field_timeline");
      }
    }
  }

  if (intent.name === "rotation_history") {
    tools.unshift("get_field_timeline");
  }

  if (intent.name === "warehouse_count") {
    tools.unshift("get_warehouse_count");
  }

  if (
    intent.name === "weighbridge_tickets" &&
    /(\bwb-\d+\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.test(queryText)
  ) {
    tools.unshift("get_ticket_details");
  }

  if (intent.name === "weighbridge_tickets") {
    const wantsActive = status === "active" || /(активн|открыт|open)/i.test(queryText);
    const wantsRecent = Number(intent.parameters.limit || 0) > 0 || /(сегодня|последн|today|recent|last)/i.test(queryText);

    if (wantsActive) {
      tools.splice(0, tools.length, "get_active_tickets");
    } else if (wantsRecent) {
      tools.splice(0, tools.length, "get_recent_tickets");
    } else {
      tools.splice(0, tools.length, "get_weighbridge_tickets");
    }
  }

  if (intent.name === "operations_recent" && queryText) {
    tools.unshift("search_operations");
    if (/(\bop[-_\s]?\d+\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.test(queryText)) {
      tools.unshift("get_operation_details");
    }
  }

  if (intent.name === "operations_recent" && status === "active") {
    tools.unshift("get_active_operations");
  }

  if (intent.name === "operations_recent" && (intentGroup === "materials" || intentGroup === "potato" || /картоф|гала|сорая|диамм|удобр|сзр|семян/.test(queryText))) {
    tools.unshift("get_potato_material_report");
  }

  if (intent.name === "crop_structure_overview" && (cropGroup || cropAlias)) {
    tools.unshift("search_crops_by_group");
  }

  if (intent.name === "crop_structure_area" && /картоф|гала|сорая|балтик|азилит|коломбо|импала|potato|gala|soraya|baltic rose/.test(queryText)) {
    tools.unshift("get_potato_material_report");
  }

  if (intent.name === "crop_structure_overview" && /картоф|гала|сорая|балтик|азилит|коломбо|импала/.test(queryText)) {
    tools.unshift("get_potato_material_report");
  }

  if (intent.name === "inventory_balance" && /отрицатель|negative/.test(queryText)) {
    tools.unshift("get_warehouse_balances");
  }

  if (intent.name === "inventory_balance" && /движен|журнал|пришло|ушло/.test(queryText)) {
    tools.unshift("get_warehouse_movements");
  }

  if (intent.name === "crop_structure_overview" && resolvedType === "list") {
    tools.push("get_crop_structure");
  }

  if (intent.name === "crop_structure_area" && resolvedType === "list") {
    tools.push("get_crop_structure");
  }

  const allowedTools = new Set(settings.allowedTools || []);
  const normalizeCandidates = (settings.allowedTools || []).map((value) => String(value || "").trim());
  const allowByNamespaceFallback = (toolName: AssistantToolName) => {
    if (allowedTools.has(toolName)) return true;
    const namespaceName = mapToolNamespace(toolName);
    return normalizeCandidates.includes(namespaceName);
  };
  const requiredTools: AssistantToolName[] = [];
  if (intent.name === "navigation_help" && action === "open_entity") {
    if (entityType === "warehouse") requiredTools.push("resolve_warehouse_by_name");
    if (entityType === "field") requiredTools.push("resolve_field_by_number");
    if (entityType === "fuel") requiredTools.push("resolve_fuel_source_by_name");
  }
  if (intent.name === "crop_structure_area") {
    requiredTools.push("get_crop_structure_summary");
  }
  if (intent.name === "warehouse_count") {
    requiredTools.push("get_warehouse_count");
  }
  if (intent.name === "inventory_balance") {
    requiredTools.push("get_warehouse_stock");
  }
  if (intent.name === "weighbridge_tickets") {
    const requestedLimit = Number(intent.parameters.limit || 0);
    if (status === "active") {
      requiredTools.push("get_active_tickets");
    } else if (requestedLimit > 0) {
      requiredTools.push("get_recent_tickets");
    } else {
      requiredTools.push("get_weighbridge_tickets");
    }
  }
  if (intent.name === "fields_overview") {
    const fieldQuery = cleanString(intent.parameters.field) || cleanString(intent.parameters.entityQuery);
    if (resolvedType === "summary_total" || !fieldQuery) {
      requiredTools.push("get_fields");
    } else {
      requiredTools.push("get_field_card");
    }
  }
  if (intent.name === "operations_recent" && status === "active") {
    requiredTools.push("get_active_operations");
  }

  const filtered = Array.from(new Set(tools)).filter((toolName) => allowByNamespaceFallback(toolName));
  const forced = requiredTools.filter((toolName) => Boolean(getAssistantTool(toolName)));
  const merged = Array.from(new Set([...forced, ...filtered]));
  if (merged.length > 0) return merged;

  const staleSettingsFallback: Record<AssistantIntentName, AssistantToolName[]> = {
    warehouse_count: ["get_warehouse_count"],
    inventory_balance: ["get_warehouse_stock"],
    warehouse_movements: ["get_warehouse_movements"],
    weighbridge_tickets: ["get_active_tickets", "get_recent_tickets", "get_weighbridge_tickets"],
    crop_structure_area: ["get_crop_structure_summary", "search_crops_by_group"],
    field_total_area: ["get_fields", "get_crop_structure_summary"],
    rotation_history: ["get_field_timeline", "search_fields"],
    fields_overview: ["get_field_card", "search_fields", "get_fields"],
    crop_structure_overview: ["get_crop_structure_summary", "search_crops_by_group"],
    operations_recent: ["get_active_operations", "search_operations", "get_operations"],
    fuel_balance: ["get_fuel_balances"],
    fuel_movements: ["get_fuel_movements"],
    entity_resolution: [],
    company_context: ["get_company_context"],
    navigation_help: ["navigate_to_page"],
    create_draft: ["create_operation_draft"],
    clarification_required: [],
    general_question: [],
  };

  if (!filtered.length) {
    return (staleSettingsFallback[intent.name] || [])
      .filter((toolName) => Boolean(getAssistantTool(toolName))) as AssistantToolName[];
  }

  return filtered;
}

function getNavigationActions(params: {
  intent: AssistantIntent;
  outputs: AssistantToolOutput[];
}): AssistantNavigationAction[] {
  const { intent, outputs } = params;
  if (intent.name !== "navigation_help") return [];

  const route = cleanString(intent.parameters.route) || "/dashboard";
  const page = cleanString(intent.parameters.page) || "dashboard";
  const action = cleanString(intent.parameters.action) || "open_page";
  const entityType = cleanString(intent.parameters.entityType);
  const entityQuery = cleanString(intent.parameters.entityQuery);
  const filters = parseFiltersJson(intent.parameters.filters);

  const resolverOutput = outputs.find((output) => output.source.tableOrView.startsWith("resolve_"));
  const resolverRow = resolverOutput?.rows?.[0] || null;
  const resolvedId = cleanString(resolverRow?.entity_id);
  const resolvedName = cleanString(resolverRow?.entity_name);
  const resolvedRoute = cleanString(resolverRow?.route);
  const resolvedPage = cleanString(resolverRow?.page);
  const resolvedFilters =
    resolverRow?.filters && typeof resolverRow.filters === "object"
      ? (resolverRow.filters as Record<string, string>)
      : null;

  if (action === "open_entity" && entityType && ["warehouse", "field", "fuel"].includes(entityType)) {
    if (!resolvedId) return [];
    const nextFilters: Record<string, string> = {
      ...((resolvedFilters || filters || (entityQuery ? { search: entityQuery } : {})) as Record<string, string>),
    };
    if (!nextFilters.search && (resolvedName || entityQuery)) {
      nextFilters.search = resolvedName || entityQuery || "";
    }
    if (!nextFilters.entityId) nextFilters.entityId = resolvedId;
    if (!nextFilters.entityType) nextFilters.entityType = entityType;
    if (entityType === "warehouse" && !nextFilters.warehouseId) nextFilters.warehouseId = resolvedId;
    return [
      {
        type: "open_entity",
        page: resolvedPage || page,
        route: resolvedRoute || route,
        entityType: entityType as "warehouse" | "field" | "fuel",
        entityId: resolvedId,
        entityQuery: resolvedName || entityQuery,
        filters: nextFilters,
      },
    ];
  }

  if (action === "apply_filter" && filters) {
    return [{ type: "apply_filter", page, route, filters }];
  }

  if (filters && Object.keys(filters).length) {
    return [{ type: "open_page_with_filter", page, route, filters }];
  }

  return [{ type: "open_page", page, route }];
}

function buildNavigationAnswer(actions: AssistantNavigationAction[]): string {
  if (!actions.length) {
    return "Не удалось определить страницу для перехода. Уточните команду.";
  }

  const first = actions[0];
  if (first.type === "open_entity") {
    const noun =
      first.entityType === "warehouse"
        ? "склад"
        : first.entityType === "field"
          ? "поле"
          : "источник ГСМ";
    const label = first.entityQuery || first.entityId || noun;
    return `Открываю ${label}.`;
  }

  if (first.type === "open_page_with_filter" || first.type === "apply_filter") {
    return `Открываю страницу ${first.page} и применяю фильтр.`;
  }

  return `Открываю страницу ${first.page}.`;
}

function buildNavigationAnswerV2(actions: AssistantNavigationAction[], intent?: AssistantIntent): string {
  if (!actions.length) {
    const action = cleanString(intent?.parameters?.action);
    const entityType = cleanString(intent?.parameters?.entityType);
    if (action === "open_entity" && entityType === "warehouse") return "Склад не найден.";
    if (action === "open_entity" && entityType === "field") return "Поле не найдено.";
    if (action === "open_entity" && entityType === "fuel") return "Источник ГСМ не найден.";
    return "Не смог открыть: route не найден.";
  }
  const first = actions[0];
  if (first.type === "open_entity") {
    const label = first.entityQuery || first.entityId || first.page;
    return `Подготовил переход к объекту: ${label}.`;
  }
  if (first.type === "open_page_with_filter" || first.type === "apply_filter") {
    return `Подготовил переход на страницу ${first.page} с фильтром.`;
  }
  return `Подготовил переход на страницу ${first.page}.`;
}

function unavailableAssistantMessage(locale: "ru" | "en" | "kz"): string {
  if (locale === "en") return "AI Assistant is temporarily unavailable. Please try again later.";
  if (locale === "kz") return "AI Assistant уақытша қолжетімсіз. Кейінірек қайталап көріңіз.";
  return "AI Assistant временно недоступен. Попробуйте позже.";
}

async function generateGeneralAnswer(params: {
  message: string;
  locale: "ru" | "en" | "kz";
  settings: AssistantPlatformSettings;
  intentName: AssistantIntentName;
  systemPrompt: string;
  promptMeta: PromptMeta;
}): Promise<{ answer: string; actualModel: string | null; usage: UsageStats; llm: LlmDiagnostics; promptMeta: PromptMeta }> {
  const { message, locale, settings, intentName, systemPrompt, promptMeta } = params;
  const modelConfig = resolveAssistantModelConfig(settings, { intentName, message });
  const emptyUsage: UsageStats = { promptTokens: null, completionTokens: null, totalTokens: null };

  if (!process.env.OPENAI_API_KEY) {
    return {
      answer: unavailableAssistantMessage(locale),
      actualModel: null,
      usage: emptyUsage,
      llm: {
        status: "missing_api_key",
        httpStatus: null,
        errorCode: "OPENAI_API_KEY_MISSING",
        errorMessage: "OPENAI_API_KEY is not configured",
        missingEnv: ["OPENAI_API_KEY"],
      },
      promptMeta,
    };
  }

  const candidateModels = buildAssistantModelCandidateList(modelConfig.actualModel);

  let response: Response | null = null;
  let data: any = {};
  let usedModel = modelConfig.actualModel;

  for (const candidateModel of candidateModels) {
    const candidateResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: candidateModel,
        temperature: modelConfig.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      }),
    }).catch(() => null);

    if (!candidateResponse) continue;

    const candidateData = await candidateResponse.json().catch(() => ({}));
    response = candidateResponse;
    data = candidateData;
    usedModel = candidateModel;

    if (candidateResponse.ok) break;

    const errCode = cleanString(candidateData?.error?.code);
    const errType = cleanString(candidateData?.error?.type);
    const errMessage = cleanString(candidateData?.error?.message)?.toLowerCase() || "";
    const modelUnavailable =
      errCode === "model_not_found" ||
      errType === "invalid_request_error" ||
      errMessage.includes("does not exist") ||
      errMessage.includes("not found") ||
      errMessage.includes("not available") ||
      errMessage.includes("access") ||
      errMessage.includes("model");

    if (!modelUnavailable) break;
  }

  if (!response) {
    return {
      answer: unavailableAssistantMessage(locale),
      actualModel: usedModel,
      usage: emptyUsage,
      llm: {
        status: "network_error",
        httpStatus: null,
        errorCode: "OPENAI_NETWORK_ERROR",
        errorMessage: "Network request to OpenAI failed",
        missingEnv: [],
      },
      promptMeta,
    };
  }

  const usage: UsageStats = {
    promptTokens: Number.isFinite(Number(data?.usage?.prompt_tokens)) ? Number(data.usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(data?.usage?.completion_tokens))
      ? Number(data.usage.completion_tokens)
      : null,
    totalTokens: Number.isFinite(Number(data?.usage?.total_tokens)) ? Number(data.usage.total_tokens) : null,
  };

  if (!response.ok) {
    const errCode = cleanString(data?.error?.code);
    const errMessage = cleanString(data?.error?.message) || cleanString(data?.error?.type);
    return {
      answer: unavailableAssistantMessage(locale),
      actualModel: usedModel,
      usage,
      llm: {
        status: "http_error",
        httpStatus: response.status,
        errorCode: errCode,
        errorMessage: errMessage,
        missingEnv: [],
      },
      promptMeta,
    };
  }

  const content = cleanString(data?.choices?.[0]?.message?.content);
  if (content) {
    return {
      answer: content,
      actualModel: usedModel,
      usage,
      llm: {
        status: "ok",
        httpStatus: response.status,
        errorCode: null,
        errorMessage: null,
        missingEnv: [],
      },
      promptMeta,
    };
  }

  return {
    answer: unavailableAssistantMessage(locale),
    actualModel: usedModel,
    usage,
    llm: {
      status: "invalid_response",
      httpStatus: response.status,
      errorCode: "OPENAI_EMPTY_RESPONSE",
      errorMessage: "OpenAI response did not contain assistant message content",
      missingEnv: [],
    },
    promptMeta,
  };
}

export async function runAssistantEngine(params: {
  supabase: SupabaseClient;
  actor: ServerActorContext;
  companyId: string;
  settings: AssistantPlatformSettings;
  input: AssistantEngineInput;
}): Promise<AssistantEngineResult> {
  const { supabase, actor, companyId, settings, input } = params;
  const engineStartedAt = Date.now();
  let routerMs: number | null = null;
  let toolMs: number | null = null;
  let modelMs: number | null = null;
  const message = String(input.message || "").trim();
  const runtimeContext = normalizeAssistantUiContext(input.runtimeContext);
  const normalizedState = normalizeSessionState(input.sessionState);
  const initialSessionState: AssistantSessionState = {
    ...EMPTY_ASSISTANT_SESSION_STATE,
    ...normalizedState,
  };
  const memoryRouting = resolveRoutingMessageWithMemory({
    message,
    state: initialSessionState,
    runtimeContext,
  });
  const messageForRouting = applySemanticExpansions(memoryRouting.routingMessage);
  const assistantMode = resolveAssistantMode(messageForRouting);
  const promptBundle = resolveTravkinCorePrompt({
    settings,
    runtimeContext,
    actorRole: actor.role,
    locale: runtimeContext.locale || "ru",
  });
  const promptMeta: PromptMeta = {
    promptVersion: promptBundle.version || TRAVKIN_CORE_PROMPT_VERSION,
    promptSource: promptBundle.source,
    promptUpdatedAt: promptBundle.updatedAt || TRAVKIN_CORE_PROMPT_UPDATED_AT,
  };

  const modelConfig = resolveAssistantModelConfig(settings);
  const engineMode = resolveAssistantEngineMode();
  const strictNavigationPolicy = String(process.env.ASSISTANT_NAV_POLICY_STRICT || "1") !== "0";
  const enabledHybridDomains = resolveHybridDomains();
  let decisionSource: AssistantDecisionSource = "router";
  let explicitNavigationRequested = hasExplicitNavigationRequest(applySemanticExpansions(message));
  let navigationPolicy: "allowed" | "blocked" | "not_applicable" = "not_applicable";
  let plannerAttempted = false;
  let plannerSucceeded = false;
  let legacyFallbackUsed = false;

  const emptyPerformance: AssistantEngineResult["performance"] = {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    routerMs: null,
    toolMs: null,
    modelMs: null,
    totalMs: null,
  };
  const buildPerformance = (
    overrides?: Partial<AssistantEngineResult["performance"]>
  ): AssistantEngineResult["performance"] => ({
    ...emptyPerformance,
    routerMs,
    toolMs,
    modelMs,
    totalMs: Date.now() - engineStartedAt,
    ...(overrides || {}),
  });
  const modelLlmNotCalled = llmNotCalled();
  const buildDiagnostics = (
    overrides?: Partial<AssistantAnswerDiagnostics>
  ): AssistantAnswerDiagnostics => ({
    expectedAnswerType: null,
    selectedSource: null,
    selectedTool: null,
    fallbackSource: null,
    previousRelatedMemory: null,
    consistencyCheck: "skipped",
    contradictionDetected: false,
    correctionApplied: false,
    ...(overrides || {}),
  });

  if (!settings.enabled) {
    return {
      answer: "Ассистент отключён в глобальных настройках.",
      sessionState: initialSessionState,
      intent: { name: "general_question", confidence: 1, needsData: false, parameters: {} },
      outputType: "filtered_summary",
      mode: assistantMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "disabled",
      grounded: false,
      decisionSource,
      explicitNavigationRequested,
      navigationPolicy,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: engineMode,
        llm: modelLlmNotCalled,
      },
      diagnostics: buildDiagnostics(),
      performance: buildPerformance(),
    };
  }

  if (!isRoleAllowed(settings, actor.role)) {
    return {
      answer: "Для вашей роли ассистент недоступен.",
      sessionState: initialSessionState,
      intent: { name: "general_question", confidence: 1, needsData: false, parameters: {} },
      outputType: "filtered_summary",
      mode: assistantMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "access_denied",
      grounded: false,
      decisionSource,
      explicitNavigationRequested,
      navigationPolicy,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: engineMode,
        llm: modelLlmNotCalled,
      },
      diagnostics: buildDiagnostics(),
      performance: buildPerformance(),
    };
  }

  const routerStartedAt = Date.now();
  const intent = await classifyAssistantIntent({
    message: memoryRouting.routingMessage,
    runtimeContext,
    sessionState: initialSessionState,
    settings,
  });
  routerMs = Date.now() - routerStartedAt;
  if (memoryRouting.used) {
    decisionSource = "memory_followup";
  }
  const resolvedMode: AssistantEngineResult["mode"] =
    intent.name === "navigation_help" ? "navigation" : assistantMode;
  const resolvedOutputType = resolveOutputType(intent);
  const expectedAnswerType = getExpectedAnswerType(intent.name);
  const selectedSource = getSelectedSource(intent.name);
  const effectiveSelectedSource = memoryRouting.used ? "session_memory" : selectedSource;
  const previousRelatedMemory = summarizeMemoryForIntent(initialSessionState, intent.name);
  const intentDomain = mapIntentToDomain(intent);
  const hybridDomainEnabled =
    enabledHybridDomains.has("all") || enabledHybridDomains.has(intentDomain) || enabledHybridDomains.has("general");
  const fastPathEnabled = engineMode === "hybrid" && hybridDomainEnabled && shouldUseFastPath({
    message: messageForRouting,
    intent,
    engineMode,
  });
  if (fastPathEnabled) decisionSource = "fast_path";
  const forceDeterministicNavigation = intent.name === "navigation_help" && explicitNavigationRequested;
  if (forceDeterministicNavigation) decisionSource = "fast_path";

  const shouldUsePlanner =
    !forceDeterministicNavigation &&
    (engineMode === "model_first" || (engineMode === "hybrid" && hybridDomainEnabled && !fastPathEnabled));

  if (shouldUsePlanner) {
    plannerAttempted = true;
    decisionSource = "model";
    const locale = runtimeContext.locale || "ru";
    let llmPromptBundle = promptBundle;
    let llmPromptMeta = promptMeta;
    try {
      const semanticMemory = await buildSemanticMemoryContext({
        message,
        mode: resolvedMode,
        intentName: intent.name,
        runtimeContext,
      });
      llmPromptBundle = resolveTravkinCorePrompt({
        settings,
        runtimeContext,
        actorRole: actor.role,
        locale,
        semanticMemoryContext: semanticMemory.contextText,
      });
      llmPromptMeta = {
        promptVersion: llmPromptBundle.version || TRAVKIN_CORE_PROMPT_VERSION,
        promptSource: llmPromptBundle.source,
        promptUpdatedAt: llmPromptBundle.updatedAt || TRAVKIN_CORE_PROMPT_UPDATED_AT,
      };
    } catch {
      llmPromptBundle = promptBundle;
      llmPromptMeta = promptMeta;
    }

    const modelStartedAt = Date.now();
    const planner = await runModelOrchestrator({
      message: memoryRouting.routingMessage,
      locale,
      settings,
      runtimeContext,
      sessionState: initialSessionState,
      intent,
      systemPrompt: llmPromptBundle.text,
      promptMeta: llmPromptMeta,
      supabase,
      actor,
      companyId,
    });
    modelMs = Date.now() - modelStartedAt;

    if (planner.ok) {
      plannerSucceeded = true;
      const navigationResult = applyNavigationPolicy({
        message: messageForRouting,
        actions: planner.navigationActions,
        strict: strictNavigationPolicy,
      });
      explicitNavigationRequested = navigationResult.explicitNavigationRequested;
      navigationPolicy = navigationResult.policy;

      const validation = validateGroundedAnswer({
        answer: planner.answer,
        outputs: planner.outputs,
        groundedRequired: looksLikeErpDataQuestion(messageForRouting),
      });
      let answer =
        planner.outputs.length === 0 && looksLikeErpDataQuestion(messageForRouting)
          ? noDataGroundedMessage()
          : validation.normalizedAnswer;
      if (
        navigationResult.policy === "blocked" &&
        /(открыл|открываю|перехожу|показываю страницу|i opened|opening)/i.test(String(answer).toLowerCase())
      ) {
        answer = "Данные показал. Если нужно, открою страницу по явной команде.";
      }

      return {
        answer,
        sessionState: { ...planner.sessionState, lastIntent: intent.name },
        intent,
        outputType: resolvedOutputType,
        mode: resolvedMode,
        toolCalls: planner.toolCalls,
        toolActivity: planner.toolActivity,
        navigationActions: navigationResult.actions,
        sourceHints: uniqueStrings(planner.sourceHints),
        answerSource: "model_grounded",
        grounded: validation.pass,
        decisionSource,
        explicitNavigationRequested,
        navigationPolicy,
        model: {
          configuredModel: modelConfig.configuredModel,
          actualModel: planner.actualModel,
          settingsSource: modelConfig.settingsSource,
          promptVersion: llmPromptMeta.promptVersion,
          promptSource: llmPromptMeta.promptSource,
          promptUpdatedAt: llmPromptMeta.promptUpdatedAt,
          requestMode: engineMode,
          llm: planner.llm,
        },
        diagnostics: buildDiagnostics({
          expectedAnswerType,
          selectedSource: effectiveSelectedSource,
          selectedTool: planner.toolCalls[0]?.tool || null,
          previousRelatedMemory,
          consistencyCheck: validation.pass ? "pass" : "fail",
          contradictionDetected: false,
          correctionApplied: !validation.pass,
        }),
        performance: buildPerformance({
          promptTokens: planner.usage.promptTokens,
          completionTokens: planner.usage.completionTokens,
          totalTokens: planner.usage.totalTokens,
          modelMs,
        }),
      };
    }

    legacyFallbackUsed = true;
  }

  if (isContradictionQuestion(messageForRouting)) {
    const correction = buildContradictionExplanation(initialSessionState);
    if (correction) {
      return {
        answer: correction,
        sessionState: { ...initialSessionState, lastIntent: intent.name },
        intent,
        outputType: resolvedOutputType,
        mode: resolvedMode,
        toolCalls: [],
        toolActivity: [],
        navigationActions: [],
        sourceHints: [],
        answerSource: "tools",
        grounded: true,
        decisionSource,
        explicitNavigationRequested,
        navigationPolicy,
        model: {
          configuredModel: modelConfig.configuredModel,
          actualModel: null,
          settingsSource: modelConfig.settingsSource,
          promptVersion: promptMeta.promptVersion,
          promptSource: promptMeta.promptSource,
          promptUpdatedAt: promptMeta.promptUpdatedAt,
          requestMode: engineMode,
          llm: modelLlmNotCalled,
        },
        diagnostics: buildDiagnostics({
          expectedAnswerType,
          selectedSource: "session_memory",
          selectedTool: "session_memory",
          previousRelatedMemory,
          consistencyCheck: "pass",
          contradictionDetected: true,
          correctionApplied: true,
        }),
        performance: buildPerformance(),
      };
    }
  }

  if (intent.name === "clarification_required") {
    const smartFollowup = buildSmartFollowUp(intent, runtimeContext.locale || "ru");
    return {
      answer: smartFollowup || "Уточните объект запроса.",
      sessionState: { ...initialSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "no_data",
      grounded: false,
      decisionSource,
      explicitNavigationRequested,
      navigationPolicy,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: engineMode,
        llm: modelLlmNotCalled,
      },
      diagnostics: buildDiagnostics({
        expectedAnswerType,
        selectedSource: effectiveSelectedSource,
        previousRelatedMemory,
      }),
      performance: buildPerformance(),
    };
  }

  if (isCapabilitiesQuestion(messageForRouting)) {
    return {
      answer: buildCapabilitiesAnswer(runtimeContext.locale || "ru"),
      sessionState: { ...initialSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "llm_fallback",
      grounded: false,
      decisionSource,
      explicitNavigationRequested,
      navigationPolicy,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: engineMode,
        llm: modelLlmNotCalled,
      },
      diagnostics: buildDiagnostics({
        expectedAnswerType,
        selectedSource: effectiveSelectedSource,
        previousRelatedMemory,
      }),
      performance: buildPerformance(),
    };
  }

  const toolNames = getToolNamesForIntent(intent, settings).slice(
    0,
    settings.limits.maxToolCallsPerQuery || 6
  );
  const toolCalls: AssistantToolCallLog[] = [];
  const outputs: AssistantToolOutput[] = [];
  const answerBlocks: string[] = [];
  const sourceHints: string[] = [];
  let nextSessionState = initialSessionState;

  const toolsStartedAt = Date.now();
  if (toolNames.length) {
    for (const toolName of toolNames) {
      const tool = getAssistantTool(toolName);
      if (!tool) {
        toolCalls.push({
          tool: toolName,
          params: intent.parameters || {},
          ok: false,
          error: "Tool not found",
        });
        continue;
      }

      try {
        const output = await tool.run({
          supabase,
          actor,
          companyId,
          settings,
          runtimeContext,
          sessionState: nextSessionState,
          intent,
        });

        outputs.push(output);
        const formatted = formatGroundedToolOutput({
          toolName: tool.name,
          intentName: intent.name,
          outputType: resolvedOutputType,
          intentParams: intent.parameters,
          output,
        });
        if (formatted) answerBlocks.push(formatted);

        sourceHints.push(
          `${output.source.module} • ${output.source.tableOrView} • ${output.source.season || "-"} • ${output.source.fetchedAt}`
        );
        nextSessionState = updateSessionStateFromToolOutput({
          previous: nextSessionState,
          intent,
          output,
          seasonFromContext: runtimeContext.season,
        });

        toolCalls.push({
          tool: tool.name,
          params: intent.parameters || {},
          ok: true,
          rows: output.rows.length,
        });
      } catch (error) {
        toolCalls.push({
          tool: tool.name,
          params: intent.parameters || {},
          ok: false,
          error: error instanceof Error ? error.message : "Tool execution failed",
        });
      }
    }
  }
  toolMs = Date.now() - toolsStartedAt;

  const navigationActions = getNavigationActions({ intent, outputs });
  const navigationResult = applyNavigationPolicy({
    message: messageForRouting,
    actions: navigationActions,
    strict: strictNavigationPolicy,
  });
  explicitNavigationRequested = navigationResult.explicitNavigationRequested;
  navigationPolicy = navigationResult.policy;
  const allowedNavigationActions = navigationResult.actions;
  if (intent.name === "navigation_help") {
    answerBlocks.unshift(buildNavigationAnswerV2(allowedNavigationActions, intent));
  }

  const toolActivity = buildToolActivityLogs(toolCalls);
  const hasToolsAnswer = answerBlocks.length > 0;
  if (hasToolsAnswer) {
    const answerTypeValid = validateExpectedAnswerType({
      intent,
      expected: expectedAnswerType,
      outputs,
    });
    const consistency = validateAnswerDataByIntent({
      intent,
      outputs,
      nextState: nextSessionState,
    });

    const answerParts = dedupeAnswerBlocks([...answerBlocks]);
    if (!answerTypeValid) {
      answerParts.unshift("Уточняю результат по корректному источнику данных: предыдущий инструмент вернул неполный формат ответа.");
    }
    if (consistency.correctionText) {
      answerParts.unshift(consistency.correctionText);
    }
    if (consistency.inconsistencyText) {
      answerParts.push(consistency.inconsistencyText);
    }

    const updatedState: AssistantSessionState = {
      ...nextSessionState,
      lastIntent: intent.name,
      lastDetectedInconsistency: consistency.inconsistencyText || (consistency.contradictionDetected ? consistency.correctionText : null) || nextSessionState.lastDetectedInconsistency,
      lastInconsistencyAt:
        (consistency.inconsistencyText || consistency.contradictionDetected)
          ? new Date().toISOString()
          : nextSessionState.lastInconsistencyAt,
    };

    return {
      answer: answerParts.join("\n\n"),
      sessionState: updatedState,
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls,
      toolActivity,
      navigationActions: allowedNavigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: legacyFallbackUsed
        ? "legacy_fallback"
        : fastPathEnabled
          ? "fast_path_template"
          : "tools",
      grounded: true,
      decisionSource,
      explicitNavigationRequested,
      navigationPolicy,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: engineMode,
        llm: modelLlmNotCalled,
      },
      diagnostics: buildDiagnostics({
        expectedAnswerType,
        selectedSource: effectiveSelectedSource,
        selectedTool: outputs[0]?.source.tableOrView || null,
        previousRelatedMemory,
        consistencyCheck: consistency.pass && answerTypeValid ? "pass" : "fail",
        contradictionDetected: consistency.contradictionDetected,
        correctionApplied: consistency.correctionApplied || !answerTypeValid,
      }),
      performance: buildPerformance(),
    };
  }

  const firstToolError = toolCalls.find((call) => !call.ok);
  if (firstToolError) {
    const fallbackByIntent: Partial<Record<AssistantIntentName, string>> = {
      warehouse_count: "Не смог получить список складов. Ошибка в инструменте.",
      inventory_balance: "Не смог получить остатки со складов. Ошибка в инструменте.",
      warehouse_movements: "Не смог получить движения склада. Ошибка в инструменте.",
      weighbridge_tickets: "Не смог получить данные весовой. Ошибка в инструменте.",
      fields_overview: "Не смог получить данные по полям. Ошибка в инструменте.",
      crop_structure_overview: "Не смог получить структуру посевов. Ошибка в инструменте.",
      operations_recent: "Не смог получить операции. Ошибка в инструменте.",
      fuel_movements: "Не смог получить данные по ГСМ. Ошибка в инструменте.",
      entity_resolution: "Не смог найти объект. Ошибка в инструменте.",
      company_context: "Не смог получить контекст компании. Ошибка в инструменте.",
      navigation_help: "Не смог выполнить навигацию. Ошибка в инструменте.",
      create_draft: "Не смог подготовить черновик. Ошибка в инструменте.",
      clarification_required: "Не смог обработать запрос. Ошибка в инструменте.",
      general_question: "Не смог обработать запрос. Ошибка в инструменте.",
    };
    return {
      answer: fallbackByIntent[intent.name] || "Не смог получить данные. Ошибка в инструменте.",
      sessionState: { ...nextSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls,
      toolActivity,
      navigationActions: allowedNavigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: legacyFallbackUsed ? "legacy_fallback" : "tool_error",
      grounded: false,
      decisionSource,
      explicitNavigationRequested,
      navigationPolicy,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: engineMode,
        llm: modelLlmNotCalled,
      },
      diagnostics: buildDiagnostics({
        expectedAnswerType,
        selectedSource: effectiveSelectedSource,
        selectedTool: toolCalls[0]?.tool || null,
        previousRelatedMemory,
        fallbackSource: "tool_error",
        consistencyCheck: "skipped",
      }),
      performance: buildPerformance(),
    };
  }

  if (looksLikeErpDataQuestion(messageForRouting) && settings.groundingRules.blockUngroundedDataAnswers) {
    const followup = buildSmartFollowUp(
      { ...intent, name: "clarification_required", parameters: { ...intent.parameters, focus: cleanString(intent.parameters.query) || "данные" } },
      runtimeContext.locale || "ru"
    );
    return {
      answer: followup || "Уточните объект запроса: склад, поле или период.",
      sessionState: { ...nextSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls,
      toolActivity,
      navigationActions: allowedNavigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: "policy_block",
      grounded: false,
      decisionSource,
      explicitNavigationRequested,
      navigationPolicy,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: engineMode,
        llm: modelLlmNotCalled,
      },
      diagnostics: buildDiagnostics({
        expectedAnswerType,
        selectedSource: effectiveSelectedSource,
        selectedTool: null,
        previousRelatedMemory,
        fallbackSource: "policy_block",
        consistencyCheck: "skipped",
      }),
      performance: buildPerformance(),
    };
  }

  const locale = runtimeContext.locale || "ru";
  let llmPromptBundle = promptBundle;
  let llmPromptMeta = promptMeta;
  try {
      const semanticMemory = await buildSemanticMemoryContext({
        message: memoryRouting.routingMessage,
        mode: resolvedMode,
        intentName: intent.name,
        runtimeContext,
    });
    llmPromptBundle = resolveTravkinCorePrompt({
      settings,
      runtimeContext,
      actorRole: actor.role,
      locale,
      semanticMemoryContext: semanticMemory.contextText,
    });
    llmPromptMeta = {
      promptVersion: llmPromptBundle.version || TRAVKIN_CORE_PROMPT_VERSION,
      promptSource: llmPromptBundle.source,
      promptUpdatedAt: llmPromptBundle.updatedAt || TRAVKIN_CORE_PROMPT_UPDATED_AT,
    };
  } catch {
    llmPromptBundle = promptBundle;
    llmPromptMeta = promptMeta;
  }
  const modelStartedAt = Date.now();
  const fallback = await generateGeneralAnswer({
    message: memoryRouting.routingMessage,
    locale,
    settings,
    intentName: intent.name,
    systemPrompt: llmPromptBundle.text,
    promptMeta: llmPromptMeta,
  });
  modelMs = Date.now() - modelStartedAt;
  return {
    answer: fallback.answer,
    sessionState: { ...nextSessionState, lastIntent: intent.name },
    intent,
    outputType: resolvedOutputType,
    mode:
      intent.name === "navigation_help"
        ? "navigation"
        : isAgroKnowledgeQuestion(messageForRouting)
          ? "agro_knowledge"
          : assistantMode,
    toolCalls,
    toolActivity,
    navigationActions: allowedNavigationActions,
    sourceHints: uniqueStrings(sourceHints),
    answerSource: legacyFallbackUsed ? "legacy_fallback" : "llm_fallback",
    grounded: false,
    decisionSource: legacyFallbackUsed ? "model" : decisionSource,
    explicitNavigationRequested,
    navigationPolicy,
    model: {
      configuredModel: modelConfig.configuredModel,
      actualModel: fallback.actualModel,
      settingsSource: modelConfig.settingsSource,
      promptVersion: fallback.promptMeta.promptVersion,
      promptSource: fallback.promptMeta.promptSource,
      promptUpdatedAt: fallback.promptMeta.promptUpdatedAt,
      requestMode: engineMode,
      llm: fallback.llm,
    },
    diagnostics: buildDiagnostics({
      expectedAnswerType,
      selectedSource: effectiveSelectedSource,
      selectedTool: toolCalls[0]?.tool || null,
      previousRelatedMemory,
      fallbackSource: "llm_fallback",
      consistencyCheck: "skipped",
    }),
    performance: buildPerformance({
      promptTokens: fallback.usage.promptTokens,
      completionTokens: fallback.usage.completionTokens,
      totalTokens: fallback.usage.totalTokens,
      modelMs,
    }),
  };
}
