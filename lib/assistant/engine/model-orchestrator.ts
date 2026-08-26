import { getAssistantTool } from "@/lib/assistant/engine/tools";
import type {
  AssistantIntent,
  AssistantNavigationAction,
  AssistantSessionState,
  AssistantToolCallLog,
  AssistantToolName,
  AssistantToolOutput,
  AssistantUiContext,
} from "@/lib/assistant/engine/types";
import {
  buildOpenAiChatCompletionBody,
  buildAssistantModelCandidateList,
  resolveAssistantModelConfig,
} from "@/lib/assistant/openai";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerActorContext } from "@/lib/auth/server-session";
import {
  buildPlannerIntent,
  getPlannerToolSchemas,
  resolvePlannerToolCall,
} from "@/lib/assistant/engine/tool-schema";
import { updateSessionStateFromToolOutput } from "@/lib/assistant/engine/session-state";

type UsageStats = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type LlmDiagnostics = {
  status: "not_called" | "ok" | "missing_api_key" | "network_error" | "http_error" | "invalid_response";
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  missingEnv: string[];
};

type PromptMeta = {
  promptVersion: string;
  promptSource: "code_default" | "db_override" | "env_override";
  promptUpdatedAt: string;
};

export type ModelOrchestratorResult = {
  ok: boolean;
  answer: string;
  intent: AssistantIntent;
  toolCalls: AssistantToolCallLog[];
  outputs: AssistantToolOutput[];
  sourceHints: string[];
  toolActivity: string[];
  sessionState: AssistantSessionState;
  configuredModel: string;
  actualModel: string | null;
  settingsSource: "db" | "env" | "default";
  usage: UsageStats;
  llm: LlmDiagnostics;
  navigationActions: AssistantNavigationAction[];
  performance: {
    plannerMs: number | null;
    modelMs: number | null;
    toolMs: number | null;
  };
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function isLargestFieldQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  const mentionsField = /(\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field|fields|РїРѕР»Рµ|РїРѕР»СЏ)/i.test(text);
  const asksLargest =
    /(\u0441\u0430\u043c\w*\s+\u0431\u043e\u043b\u044c\u0448|\u043d\u0430\u0438\u0431\u043e\u043b\u044c\u0448|\u043a\u0440\u0443\u043f\u043d|\u043c\u0430\u043a\u0441|\u0431\u043e\u043b\u044c\u0448\u0435\s+\u0432\u0441\u0435\u0433\u043e|largest|biggest|max(?:imum)?|СЃР°Рј\w*\s+Р±РѕР»СЊС€|РЅР°РёР±РѕР»СЊС€|РєСЂСѓРїРЅ|РјР°РєСЃ|Р±РѕР»СЊС€Рµ\s+РІСЃРµРіРѕ)/i.test(
      text
    );
  return mentionsField && asksLargest;
}

function isFieldLandBankAggregateQuery(value: unknown): boolean {
  const text = String(value || "").toLowerCase();
  const landBankTerms =
    /(\u0437\u0435\u043c\u0435\u043b\u044c\u043d\w*\s+\u0431\u0430\u043d\u043a|\u043f\u043b\u043e\u0449\u0430\u0434\w*\s+\u0445\u043e\u0437\u044f\u0439\u0441\u0442\u0432|\u043e\u0431\u0449\u0430\w*\s+\u043f\u043b\u043e\u0449\u0430\u0434|\u0432\u0441\u0435\u0433\u043e\s+\u0433\u0435\u043a\u0442|\u0432\u0441\u0435\u0433\u043e\s+\u0433\u0430\b|\u0432\u0441\u0435\u0433\u043e\s+\u043f\u043e\u043b\u0435\u0439|\u0441\u043a\u043e\u043b\u044c\u043a\u043e\s+\u0432\u0441\u0435\u0433\u043e\s+\u0433\u0435\u043a\u0442|\u0441\u043a\u043e\u043b\u044c\u043a\u043e\s+\u0432\u0441\u0435\u0433\u043e\s+\u043f\u043e\u043b\u0435\u0439|total\s+hectares|total\s+fields|land\s+bank|farm\s+area|company\s+field\s+area)/i;
  return landBankTerms.test(text);
}

function isCropStructureAggregateQuery(value: unknown): boolean {
  const text = String(value || "").toLowerCase();
  const cropTerms =
    /(\u043a\u0430\u0440\u0442\u043e\u0444|\u043f\u0448\u0435\u043d|\u044f\u0447\u043c\u0435\u043d|\u043a\u0443\u043a\u0443\u0440\u0443\u0437|\u0440\u0430\u043f\u0441|\u0441\u043e\u044f|\u043e\u0432\u0435\u0441|\u043b\u0435\u043d|\u043b\u0451\u043d|\u043c\u043e\u0440\u043a\u043e\u0432|\u043b\u0443\u043a|potato|wheat|barley|corn|rapeseed|soy|oats|carrot|onion)/i;
  const aggregateTerms =
    /(\u0441\u043a\u043e\u043b\u044c\u043a\u043e|\u043f\u043b\u043e\u0449\u0430\u0434|\u0433\u0435\u043a\u0442|\u0433\u0430\b|\u043f\u043e\u0441\u0435\u044f|\u043f\u043e\u0441\u0430\u0436|how\s+much|area|hectares)/i;
  return cropTerms.test(text) && aggregateTerms.test(text);
}

function isInventorySpecificQuery(value: unknown): boolean {
  const text = String(value || "").toLowerCase();
  return /(\u043e\u0441\u0442\u0430\u0442|\u043d\u0430\u043b\u0438\u0447|\u0441\u043a\u043b\u0430\u0434|\u043f\u0430\u0440\u0442|\u0434\u0432\u0438\u0436\u0435\u043d|\u0436\u0443\u0440\u043d\u0430\u043b|ledger|inventory|warehouse|stock|balance|batch)/i.test(text);
}

function hasExplicitDataOrActionSignal(value: unknown): boolean {
  const text = String(value || "").toLowerCase();
  return /(\u043e\u0441\u0442\u0430\u0442|\u043d\u0430\u043b\u0438\u0447|\u0441\u043a\u043b\u0430\u0434|\u043f\u0430\u0440\u0442|\u0434\u0432\u0438\u0436\u0435\u043d|\u0436\u0443\u0440\u043d\u0430\u043b|\u0441\u043a\u043e\u043b\u044c\u043a\u043e|\u043f\u043e\u043a\u0430\u0436|\u043d\u0430\u0437\u043e\u0432|\u0441\u043f\u0438\u0441\u043e\u043a|\u043a\u0430\u043a\u0438\u0435|\u043a\u0430\u043a\u043e\u0439|\u043e\u0442\u043a\u0440\u043e\u0439|\u043f\u0435\u0440\u0435\u0439\u0434|\u0441\u043e\u0437\u0434\u0430|\u0434\u043e\u0431\u0430\u0432|\u0438\u0437\u043c\u0435\u043d|\u0443\u0434\u0430\u043b|\u0432\u044b\u0434\u0430|\u043f\u0440\u0438\u043d\u044f\u0442|\u0437\u0430\u043a\u0440\u043e|\u0437\u0430\u0440\u0435\u0433|\u043f\u043e\u043b\u0435|\u0433\u0435\u043a\u0442|\u0433\u0430\b|\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b|\u043e\u043f\u0435\u0440\u0430\u0446|\u0442\u0430\u043b\u043e\u043d|\u0432\u0435\u0441\u043e\u0432|\u0443\u0440\u043e\u0436|\u0432\u043e\u0437\u0432\u0440\u0430\u0442|ledger|inventory|warehouse|stock|balance|batch|how\s+many|show|open|create|add|delete|update|ticket|field|operation)/i.test(
    text
  );
}

function isAmbiguousBareUserText(value: unknown): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const normalized = raw
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 1 || tokens.length > 3) return false;
  if (raw.length < 3 || raw.length > 80) return false;
  if (!/^[\p{L}\p{N}\s+_.-]+$/u.test(raw)) return false;
  if (/\b\d{1,3}(?:-\d{1,3}){0,2}\b/.test(normalized)) return false;
  return !hasExplicitDataOrActionSignal(normalized);
}

function isLikelyGreetingTypo(value: unknown): boolean {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  return /^(?:\u043f\u0440[ие][вб]\w{1,5}|\u0437\u0434\u0440\u0430\w*|\u0441\u0430\u043b\u0430\u043c|hello|hi|hey)$/.test(text);
}

function buildAmbiguousBareQueryAnswer(message: string): string {
  const label = clean(message) || "это";
  if (isLikelyGreetingTypo(label)) {
    return `Привет! Я на связи. Если вы имели в виду «${label}» как продукт или объект системы, напишите, что именно проверить: остаток, применение, поле или операцию.`;
  }
  return [
    `Уточните, что вы имели в виду: «${label}» как обычное сообщение или как название продукта/объекта в системе?`,
    "",
    `Если нужен склад, напишите: «остаток ${label}».`,
    `Если нужна справка, напишите: «что такое ${label}».`,
  ].join("\n");
}

const ERP_TOOL_NAMES = new Set<AssistantToolName>([
  "get_current_context",
  "get_company_context",
  "get_current_season",
  "get_field_land_bank_summary",
  "search_fields",
  "get_field_card",
  "get_field_timeline",
  "get_field_materials",
  "find_field",
  "search_warehouses",
  "get_warehouse_count",
  "get_warehouse_stock",
  "find_warehouse",
  "search_operations",
  "get_operation_details",
  "find_operation",
  "get_active_operations",
  "get_active_operations_summary",
  "get_active_tickets",
  "get_recent_tickets",
  "get_ticket_details",
  "get_potato_material_report",
  "get_crop_structure_summary",
  "search_crops_by_group",
  "get_warehouse_summary",
  "get_fields",
  "get_crop_structure",
  "get_inventory",
  "get_batches",
  "get_warehouse_balances",
  "get_warehouse_movements",
  "get_weighbridge_tickets",
  "get_operations",
  "get_fuel_sources",
  "get_fuel_balances",
  "get_fuel_movements",
  "resolve_warehouse_by_name",
  "resolve_field_by_number",
  "resolve_fuel_source_by_name",
  "resolve_entity",
  "resolve_page_or_module",
  "resolve_crop_variety",
  "resolve_vehicle_or_equipment",
  "resolve_operation_type",
  "get_quick_insights",
  "get_morning_report",
  "get_operation_insights",
  "get_warehouse_insights",
  "get_weighbridge_insights",
]);

function isActiveOperationsQuery(value: unknown): boolean {
  const text = String(value || "").toLowerCase();
  return (
    /(active|current|in\s+work|operations?\s+in\s+work)/i.test(text) ||
    /(\u0430\u043a\u0442\u0438\u0432|\u0441\u0435\u0439\u0447\u0430\u0441|\u0442\u0435\u043a\u0443\u0449|\u0432\s+\u0440\u0430\u0431\u043e\u0442\u0435)/i.test(text)
  ) && /(operation|\u043e\u043f\u0435\u0440\u0430\u0446|\u0440\u0430\u0431\u043e\u0442)/i.test(text);
}

function extractFieldReferenceFromPlannerArgs(args: Record<string, unknown>, message: string): string | null {
  const joined = [clean(args.field), clean(args.field_alias), clean(args.query), clean(args.entity), message]
    .filter(Boolean)
    .join(" ");
  const afterLabel = joined.match(/(?:\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field)\s*([0-9]{1,3}(?:-[0-9]{1,3}){0,2})/i);
  if (afterLabel?.[1]) return afterLabel[1];
  const beforeLabel = joined.match(/([0-9]{1,3}(?:-[0-9]{1,3}){0,2})\s*(?:\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field)/i);
  if (beforeLabel?.[1]) return beforeLabel[1];
  const fieldArg = clean(args.field) || clean(args.field_alias);
  if (fieldArg && /^[0-9]{1,3}(?:-[0-9]{1,3}){0,2}$/.test(fieldArg)) return fieldArg;
  return null;
}

function isFieldScopedOperationsQuery(args: Record<string, unknown>, message: string): boolean {
  const fieldRef = extractFieldReferenceFromPlannerArgs(args, message);
  if (!fieldRef) return false;
  const text = [clean(args.query), clean(args.intent), clean(args.topic), message].filter(Boolean).join(" ").toLowerCase();
  return /(\u043e\u043f\u0435\u0440\u0430\u0446|\u0440\u0430\u0431\u043e\u0442|\u0438\u0441\u0442\u043e\u0440|\u0443\u0440\u043e\u0436|\u0443\u0431\u043e\u0440\u043a|operation|task|timeline|history|harvest)/i.test(
    text
  );
}

function hasOutputSource(outputs: AssistantToolOutput[], marker: string): boolean {
  const needle = marker.toLowerCase();
  return outputs.some((output) => String(output.source.tableOrView || "").toLowerCase().includes(needle));
}

function coerceToolForSourceOfTruth(params: {
  requestedTool: AssistantToolName;
  args: Record<string, unknown>;
  message: string;
}): AssistantToolName {
  const query = clean(params.args.query) || params.message;
  if (
    (params.requestedTool === "get_operations" ||
      params.requestedTool === "search_operations" ||
      params.requestedTool === "get_active_operations_summary") &&
    isFieldScopedOperationsQuery(params.args, params.message)
  ) {
    return "get_field_timeline";
  }
  if (
    (params.requestedTool === "search_fields" || params.requestedTool === "get_fields") &&
    isFieldLandBankAggregateQuery(query)
  ) {
    return "get_field_land_bank_summary";
  }
  if (
    (params.requestedTool === "get_operations" || params.requestedTool === "search_operations") &&
    isActiveOperationsQuery(query)
  ) {
    return "get_active_operations_summary";
  }
  if (
    (params.requestedTool === "get_warehouse_stock" ||
      params.requestedTool === "get_warehouse_balances" ||
      params.requestedTool === "get_inventory") &&
    isCropStructureAggregateQuery(query) &&
    !isInventorySpecificQuery(query)
  ) {
    return "get_crop_structure_summary";
  }
  return params.requestedTool;
}

function usageFrom(data: any): UsageStats {
  return {
    promptTokens: Number.isFinite(Number(data?.usage?.prompt_tokens)) ? Number(data.usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(data?.usage?.completion_tokens))
      ? Number(data.usage.completion_tokens)
      : null,
    totalTokens: Number.isFinite(Number(data?.usage?.total_tokens)) ? Number(data.usage.total_tokens) : null,
  };
}

function mergeUsage(base: UsageStats, next: UsageStats): UsageStats {
  const add = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return Number(a || 0) + Number(b || 0);
  };
  return {
    promptTokens: add(base.promptTokens, next.promptTokens),
    completionTokens: add(base.completionTokens, next.completionTokens),
    totalTokens: add(base.totalTokens, next.totalTokens),
  };
}

function safeJsonParse(value: unknown): Record<string, unknown> {
  const text = clean(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

function buildToolActivity(toolCalls: AssistantToolCallLog[]): string[] {
  return toolCalls.map((item) =>
    item.ok
      ? `${item.tool}: ${item.rows || 0} rows${typeof item.durationMs === "number" ? ` in ${item.durationMs}ms` : ""}`
      : `${item.tool}: error (${item.error || "unknown"})`
  );
}

function toToolContent(output: AssistantToolOutput): string {
  const rows = output.rows.slice(0, 30);
  return JSON.stringify(
    {
      title: output.title,
      rows,
      source: output.source,
      summary: output.summary || null,
    },
    null,
    2
  );
}

function llmMissingKey(): LlmDiagnostics {
  return {
    status: "missing_api_key",
    httpStatus: null,
    errorCode: "OPENAI_API_KEY_MISSING",
    errorMessage: "OPENAI_API_KEY is not configured",
    missingEnv: ["OPENAI_API_KEY"],
  };
}

function toIntentContext(intent: AssistantIntent): string {
  return JSON.stringify(
    {
      intent: intent.name,
      confidence: intent.confidence,
      parameters: intent.parameters,
    },
    null,
    2
  );
}

function toRuntimeContext(runtimeContext: AssistantUiContext): string {
  return JSON.stringify(
    {
      company: runtimeContext.companyName || runtimeContext.companyId,
      role: runtimeContext.userRole,
      current_module: runtimeContext.currentModule,
      current_page: runtimeContext.currentPage,
      current_route: runtimeContext.currentRoute,
      selected_season: runtimeContext.season,
      selected_field_id: runtimeContext.selectedFieldId,
      selected_field_label: runtimeContext.selectedFieldLabel,
      selected_warehouse_id: runtimeContext.selectedWarehouseId,
      selected_warehouse_label: runtimeContext.selectedWarehouseLabel,
      selected_crop_structure_section_id: runtimeContext.selectedCropStructureSectionId,
      selected_crop_structure_section_label: runtimeContext.selectedCropStructureSectionLabel,
      selected_operation_id: runtimeContext.selectedOperationId,
      selected_operation_label: runtimeContext.selectedOperationLabel,
      selected_ticket_id: runtimeContext.selectedTicketId,
      selected_ticket_label: runtimeContext.selectedTicketLabel,
      selected_batch_id: runtimeContext.selectedBatchId,
      selected_batch_label: runtimeContext.selectedBatchLabel,
      selected_crop: runtimeContext.selectedCrop,
      selected_entity_type: runtimeContext.entity?.type,
      selected_entity_id: runtimeContext.entity?.id,
      filters: runtimeContext.filters,
    },
    null,
    2
  );
}

function toSessionSummary(sessionState: AssistantSessionState): string {
  return JSON.stringify(
    {
      last_intent: sessionState.lastIntent || null,
      last_crop: sessionState.lastCrop || null,
      last_variety: sessionState.lastVariety || null,
      last_field: sessionState.lastField || null,
      last_field_id: sessionState.lastFieldId || null,
      last_field_label: sessionState.lastFieldLabel || null,
      last_warehouse: sessionState.lastWarehouse || null,
      last_warehouse_id: sessionState.lastWarehouseId || null,
      last_warehouse_label: sessionState.lastWarehouseLabel || null,
      last_operation: sessionState.lastOperation || null,
      last_operation_id: sessionState.lastOperationId || null,
      last_operation_label: sessionState.lastOperationLabel || null,
      last_ticket: sessionState.lastTicket || null,
      last_ticket_id: sessionState.lastTicketId || null,
      last_ticket_label: sessionState.lastTicketLabel || null,
      last_crop_structure_section: sessionState.lastCropStructureSection || null,
      last_crop_structure_section_id: sessionState.lastCropStructureSectionId || null,
      last_crop_structure_section_label: sessionState.lastCropStructureSectionLabel || null,
      last_batch: sessionState.lastBatch || null,
      last_batch_id: sessionState.lastBatchId || null,
      last_batch_label: sessionState.lastBatchLabel || null,
      last_entity: sessionState.lastEntity || null,
      last_module: sessionState.lastModule || null,
      last_tool_source: sessionState.lastToolSource || null,
      last_answer_type: sessionState.lastAnswerType || null,
      last_result_context: sessionState.lastResultContext || null,
      last_warehouse_count: sessionState.lastWarehouseCount ?? null,
      last_inventory_kg: sessionState.lastInventoryTotalKg ?? null,
      last_crop_structure_area_ha: sessionState.lastCropStructureAreaHa ?? null,
      last_fields_area_ha: sessionState.lastFieldsAreaHa ?? null,
      last_inconsistency: sessionState.lastDetectedInconsistency || null,
      last_inconsistency_at: sessionState.lastInconsistencyAt || null,
      focus_entity_type: sessionState.focusEntityType || null,
      focus_entity_id: sessionState.focusEntityId || null,
      focus_entity_label: sessionState.focusEntityLabel || null,
      focus_module: sessionState.focusModule || null,
      focus_route: sessionState.focusRoute || null,
      focus_source: sessionState.focusSource || null,
      pending_action_type: sessionState.pendingActionType || null,
      pending_action_summary: sessionState.pendingActionSummary || null,
      pending_action_route: sessionState.pendingActionRoute || null,
      pending_action_payload: safeJsonParse(sessionState.pendingActionPayloadJson),
      last_action_type: sessionState.lastActionType || null,
      last_action_summary: sessionState.lastActionSummary || null,
    },
    null,
    2
  );
}

function toPendingActionInstruction(sessionState: AssistantSessionState): string {
  if (!sessionState.pendingActionType) return "";
  const payload = safeJsonParse(sessionState.pendingActionPayloadJson);
  const missingFields = Array.isArray(payload.missingFields)
    ? payload.missingFields
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const value = item as Record<string, unknown>;
          return clean(value.label) || clean(value.field);
        })
        .filter(Boolean)
    : [];
  const missingText = missingFields.length ? ` Missing required fields: ${missingFields.join(", ")}.` : "";
  return `Pending action instruction: continue ${sessionState.pendingActionSummary || sessionState.pendingActionType}.${missingText} Ask one compact follow-up question if required data is missing. Do not claim the action is created or executed until an execution result confirms it.`;
}

function normalizeNavigationActions(actions: AssistantNavigationAction[]): AssistantNavigationAction[] {
  return actions.filter(Boolean);
}

export async function runModelOrchestrator(params: {
  message: string;
  locale: "ru" | "en" | "kz";
  settings: AssistantPlatformSettings;
  runtimeContext: AssistantUiContext;
  sessionState: AssistantSessionState;
  intent: AssistantIntent;
  systemPrompt: string;
  promptMeta: PromptMeta;
  supabase: SupabaseClient;
  actor: ServerActorContext;
  companyId: string;
  forceHeavyModel?: boolean;
}): Promise<ModelOrchestratorResult> {
  const orchestratorStartedAt = Date.now();
  let modelMs = 0;
  let toolMs = 0;
  const buildPerformance = () => ({
    plannerMs: Date.now() - orchestratorStartedAt,
    modelMs,
    toolMs,
  });
  const modelConfig = resolveAssistantModelConfig(params.settings, {
    intentName: params.intent.name,
    message: params.message,
    forceHeavyModel: Boolean(params.forceHeavyModel),
  });
  const toolCalls: AssistantToolCallLog[] = [];
  const outputs: AssistantToolOutput[] = [];
  const sourceHints: string[] = [];
  let nextSessionState = params.sessionState;
  let plannerIntentForResult = params.intent;

  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      answer: "Модель ассистента не настроена: отсутствует OPENAI_API_KEY. Локальные tools и навигационный fallback могут продолжить работу.",
      intent: plannerIntentForResult,
      toolCalls,
      outputs,
      sourceHints,
      toolActivity: [],
      sessionState: nextSessionState,
      configuredModel: modelConfig.configuredModel,
      actualModel: null,
      settingsSource: modelConfig.settingsSource,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      llm: llmMissingKey(),
      navigationActions: [],
      performance: buildPerformance(),
    };
  }

  const candidateModels = buildAssistantModelCandidateList(modelConfig.actualModel);
  const plannerTools = getPlannerToolSchemas();

  let usedModel = modelConfig.actualModel;
  let llm: LlmDiagnostics = {
    status: "not_called",
    httpStatus: null,
    errorCode: null,
    errorMessage: null,
    missingEnv: [],
  };
  let totalUsage: UsageStats = {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  };

  for (const candidateModel of candidateModels) {
    usedModel = candidateModel;
    let messages: any[] = [
      { role: "system", content: params.systemPrompt },
      {
        role: "system",
        content: [
          "Вы — planner Travkin Copilot.",
          "Вы первый уровень принятия решений. Сначала мысленно выберите ровно один тип запроса: CHAT, QUESTION, DATA, ACTION.",
          "CHAT: приветствие, благодарность, small talk, вопрос 'что умеешь'. Tools запрещены.",
          "QUESTION: знания, определения, процессы, консультации и вопросы 'как работает/объясни/что такое'. Tools запрещены, отвечайте сами.",
          "DATA: фактические данные компании, поля, склада, талонов, операций. Только для DATA можно выбрать read-only tools.",
          "ACTION: пользователь просит открыть страницу или подготовить создание/изменение. Только для ACTION можно выбрать navigation/draft tools.",
          "Никогда не вызывайте tools для CHAT или QUESTION.",
          "Примеры Knowledge без tools: 'Что такое фитофтора?', 'Как работает весовая?', 'Объясни процесс на весовой', 'Как организовать выдачу термосов?'.",
          "Примеры Data Retrieval с tools: 'Что на поле 28?', 'А материалы?', 'А операции?', 'А урожай?', 'Остатки по овощному складу', 'А последние движения?'.",
          "Неоднозначные короткие сообщения без явного запроса данных/action НЕ являются DATA. Примеры: 'привент', 'превет', 'селетра', 'Ревус топп'. Сначала поймите как человек: это может быть опечатка, приветствие или название продукта. Tools не вызывайте; задайте один короткий уточняющий вопрос.",
          "Голое название продукта без слов 'остаток', 'наличие', 'сколько осталось', 'на складе', 'движения', 'выдать' — не повод искать ERP. Уточните, что именно проверить.",
          "Для 'Остатки по овощному/семенному/зерновому складу' передайте склад в аргумент warehouse.",
          "Follow-up 'А последние движения?' после складов/остатков означает складской ledger, используйте get_warehouse_movements, а не операции.",
          "ERP-данные и цифры берите только из tools.",
          "Если tool вернул пусто — скажите: 'По системе сейчас данных по этому запросу не найдено' и предложите следующий проверочный шаг.",
          "Отвечайте коротко: короткий вывод, 2-5 фактов, следующий шаг.",
          "Не добавляйте навигационные действия без явной команды пользователя.",
          "Не пишите 'открыто/создано/выполнено/удалено/сохранено', пока действие не подтверждено интерфейсом. Для навигационного tool пишите только 'Подготовил переход'.",
          "Для команд создания используйте draft tools. Если данных не хватает, спросите недостающие поля вместо создания.",
          "Если пользователь указывает на ошибку или источники расходятся, используйте прямую самокоррекцию: 'Да, ошибся.', 'Вижу расхождение.', 'Источник противоречит другому источнику.', 'Данных недостаточно.', 'Не могу подтвердить.'.",
        ].join("\n"),
      },
      {
        role: "system",
        content:
          "Source of Truth contract: total fields, total hectares, land bank, and overall farm area MUST use get_field_land_bank_summary. Never derive totals from list_fields/search_fields. Crop/sown area MUST use get_crop_structure_summary. Simple crop aggregate questions like 'Сколько картофеля?', 'Сколько моркови?', 'площадь картофеля', or crop hectares MUST use get_crop_structure_summary unless the user explicitly says остатки/склад/наличие/stock/warehouse/inventory. For factual Weighbridge questions about trips, tickets, field harvest, gross/tare/net/accepted weight, moisture, vehicle, driver, operator, route, correction, void or processing, MUST use weighbridge read-only tools; never infer these facts from chat context. Explanations of how the Weighbridge process works remain QUESTION without tools. Mixed questions must call all relevant aggregate tools.",
      },
      { role: "system", content: `Router fallback hint only. Ignore it if the user asks a knowledge/process question:\n${toIntentContext(params.intent)}` },
      { role: "system", content: `Runtime context:\n${toRuntimeContext(params.runtimeContext)}` },
      { role: "system", content: `Session summary:\n${toSessionSummary(params.sessionState)}` },
      {
        role: "system",
        content:
          [
            "Working Memory rule: resolve short follow-ups like 'this field', 'there', 'same warehouse', 'continue it' from focus_entity_* first. If pending_action_* exists, continue that action by asking only for missing required data. Do not ask which object if focus_entity_label is enough.",
            toPendingActionInstruction(params.sessionState),
          ]
            .filter(Boolean)
            .join("\n"),
      },
      { role: "user", content: params.message },
    ];

    let finalAnswer = "";
    const navigationActions: AssistantNavigationAction[] = [];
    let hardFailure = false;

    for (let turn = 0; turn < 3; turn += 1) {
      const completionStartedAt = Date.now();
      const completionRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(
          buildOpenAiChatCompletionBody({
            model: candidateModel,
            temperature: modelConfig.temperature,
            messages,
            tools: plannerTools,
            toolChoice: "auto",
          })
        ),
      }).catch(() => null);
      modelMs += Date.now() - completionStartedAt;

      if (!completionRes) {
        llm = {
          status: "network_error",
          httpStatus: null,
          errorCode: "OPENAI_NETWORK_ERROR",
          errorMessage: "Network request to OpenAI failed",
          missingEnv: [],
        };
        hardFailure = true;
        break;
      }

      const completionData = await completionRes.json().catch(() => ({}));
      totalUsage = mergeUsage(totalUsage, usageFrom(completionData));

      if (!completionRes.ok) {
        const errCode = clean(completionData?.error?.code);
        const errMessage = clean(completionData?.error?.message) || clean(completionData?.error?.type) || "";
        const lower = errMessage.toLowerCase();
        const modelUnavailable =
          errCode === "model_not_found" ||
          lower.includes("does not exist") ||
          lower.includes("not available") ||
          lower.includes("do not have access") ||
          lower.includes("not have access") ||
          lower.includes("model not found");
        llm = {
          status: "http_error",
          httpStatus: completionRes.status,
          errorCode: errCode,
          errorMessage: errMessage,
          missingEnv: [],
        };
        if (modelUnavailable) {
          hardFailure = true;
          break;
        }
        hardFailure = true;
        break;
      }

      const choice = completionData?.choices?.[0]?.message || {};
      const toolCallsRaw = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
      const answerChunk = clean(choice?.content);

      if (toolCallsRaw.length && isAmbiguousBareUserText(params.message)) {
        const attemptedErpTool = toolCallsRaw.some((call: any) => {
          const fnName = clean(call?.function?.name) || "";
          const args = safeJsonParse(call?.function?.arguments);
          const mapping = resolvePlannerToolCall(fnName);
          if (!mapping) return false;
          const executionToolName = coerceToolForSourceOfTruth({
            requestedTool: mapping.assistantTool,
            args,
            message: params.message,
          });
          return ERP_TOOL_NAMES.has(executionToolName);
        });

        if (attemptedErpTool) {
          finalAnswer = buildAmbiguousBareQueryAnswer(params.message);
          plannerIntentForResult = {
            name: "clarification_required",
            confidence: 0.99,
            needsData: false,
            parameters: {
              query: params.message,
              focus: params.message,
              request_type: "CHAT",
              output_type: "filtered_summary",
            },
          };
          llm = {
            status: "ok",
            httpStatus: completionRes.status,
            errorCode: null,
            errorMessage: null,
            missingEnv: [],
          };
          break;
        }
      }

      if (!toolCallsRaw.length) {
        const requiresLandBankSummary = isFieldLandBankAggregateQuery(params.message);
        const requiresCropSummary = isCropStructureAggregateQuery(params.message) && !isInventorySpecificQuery(params.message);
        const hasLandBankSummary = hasOutputSource(outputs, "land_bank_summary");
        const hasCropSummary = hasOutputSource(outputs, "crop_structure");
        if (
          (requiresLandBankSummary && !hasLandBankSummary) ||
          (requiresCropSummary && !hasCropSummary)
        ) {
          llm = {
            status: "invalid_response",
            httpStatus: completionRes.status,
            errorCode: "SOURCE_OF_TRUTH_TOOL_REQUIRED",
            errorMessage:
              requiresLandBankSummary && requiresCropSummary
                ? "Mixed land bank and crop aggregate requires get_field_land_bank_summary and get_crop_structure_summary."
                : requiresCropSummary
                  ? "Crop aggregate requires get_crop_structure_summary."
                  : "Field land bank aggregate requires get_field_land_bank_summary.",
            missingEnv: [],
          };
          hardFailure = true;
          break;
        }
        finalAnswer = answerChunk || "";
        llm = {
          status: "ok",
          httpStatus: completionRes.status,
          errorCode: null,
          errorMessage: null,
          missingEnv: [],
        };
        break;
      }

      messages.push({
        role: "assistant",
        content: answerChunk || "",
        tool_calls: toolCallsRaw,
      });

      for (const call of toolCallsRaw) {
        const fnName = clean(call?.function?.name) || "";
        const args = safeJsonParse(call?.function?.arguments);
        const mapping = resolvePlannerToolCall(fnName);
        if (!mapping) {
          toolCalls.push({
            tool: "get_current_context",
            params: args,
            ok: false,
            error: `Tool not implemented: ${fnName}`,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `tool_not_implemented:${fnName}` }),
          });
          continue;
        }

        const requestedTool = mapping.assistantTool;
        const executionToolName = coerceToolForSourceOfTruth({
          requestedTool,
          args,
          message: params.message,
        });
        const tool = getAssistantTool(executionToolName);
        if (!tool) {
          toolCalls.push({
            tool: executionToolName,
            params: args,
            ok: false,
            error: "Tool definition missing",
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "tool_definition_missing" }),
          });
          continue;
        }

        const plannerIntentRaw = buildPlannerIntent({
          mapping,
          args,
          message: params.message,
          runtimeContext: params.runtimeContext,
        });
        const plannerIntentBase =
          executionToolName === "get_field_land_bank_summary"
            ? {
                ...plannerIntentRaw,
                name: "field_total_area" as const,
                confidence: Math.max(plannerIntentRaw.confidence, 0.99),
                needsData: true,
                parameters: {
                  ...plannerIntentRaw.parameters,
                  query: clean(args.query) || params.message,
                  output_type: "summary_total",
                  source_of_truth: "fields",
                },
              }
            : executionToolName === "get_crop_structure_summary"
              ? {
                  ...plannerIntentRaw,
                  name: "crop_structure_area" as const,
                  confidence: Math.max(plannerIntentRaw.confidence, 0.99),
                  needsData: true,
                  parameters: {
                    ...plannerIntentRaw.parameters,
                    query: clean(args.query) || params.message,
                    crop_alias: clean(args.crop) || clean(args.product) || clean(plannerIntentRaw.parameters.crop_alias),
                    crop_group: clean(args.crop_group) || clean(plannerIntentRaw.parameters.crop_group),
                    season:
                      clean(args.season) ||
                      clean(plannerIntentRaw.parameters.season) ||
                      params.runtimeContext.season ||
                      params.runtimeContext.defaultSeason ||
                      "2026",
                    output_type: clean(args.crop) || clean(args.product) || clean(plannerIntentRaw.parameters.crop_alias)
                      ? "filtered_summary"
                      : "summary_total",
                    source_of_truth: "crop_structure",
                  },
                }
            : plannerIntentRaw;
        const plannerIntent =
          isLargestFieldQuestion(params.message) && (executionToolName === "get_fields" || executionToolName === "search_fields")
            ? {
                ...plannerIntentBase,
                name: "fields_overview" as const,
                confidence: Math.max(plannerIntentBase.confidence, 0.99),
                needsData: true,
                parameters: {
                  ...plannerIntentBase.parameters,
                  query: clean(plannerIntentBase.parameters.query) || params.message,
                  output_type: "list",
                  source_of_truth: "fields",
                },
              }
            : plannerIntentBase;
        plannerIntentForResult = plannerIntent;

        const toolStartedAt = Date.now();
        try {
          const output = await tool.run({
            supabase: params.supabase,
            actor: params.actor,
            companyId: params.companyId,
            settings: params.settings,
            runtimeContext: params.runtimeContext,
            sessionState: nextSessionState,
            intent: plannerIntent,
          });
          const toolDuration = Date.now() - toolStartedAt;
          toolMs += toolDuration;
          outputs.push(output);
          sourceHints.push(
            `${output.source.module} • ${output.source.tableOrView} • ${output.source.season || "-"} • ${output.source.fetchedAt}`
          );
          nextSessionState = updateSessionStateFromToolOutput({
            previous: nextSessionState,
            intent: plannerIntent,
            output,
            seasonFromContext: params.runtimeContext.season,
          });
          toolCalls.push({
            tool: executionToolName,
            params: args,
            ok: true,
            rows: output.rows.length,
            durationMs: toolDuration,
          });
          if (executionToolName === requestedTool && mapping.buildNavigation) {
            const actions = mapping.buildNavigation(args, output.rows);
            navigationActions.push(...actions);
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: toToolContent(output),
          });
        } catch (error) {
          const toolDuration = Date.now() - toolStartedAt;
          toolMs += toolDuration;
          toolCalls.push({
            tool: executionToolName,
            params: args,
            ok: false,
            error: error instanceof Error ? error.message : "Tool execution failed",
            durationMs: toolDuration,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: error instanceof Error ? error.message : "tool_error" }),
          });
        }
      }
    }

    if (!hardFailure && llm.status === "ok") {
      return {
        ok: true,
        answer: finalAnswer || "Не смог сформировать ответ по данным инструментов.",
        intent: plannerIntentForResult,
        toolCalls,
        outputs,
        sourceHints,
        toolActivity: buildToolActivity(toolCalls),
        sessionState: nextSessionState,
        configuredModel: modelConfig.configuredModel,
        actualModel: usedModel,
        settingsSource: modelConfig.settingsSource,
        usage: totalUsage,
        llm,
        navigationActions: normalizeNavigationActions(navigationActions),
        performance: buildPerformance(),
      };
    }
  }

  return {
    ok: false,
    answer: "Не смог получить ответ от planner-модели. Переключаюсь на резервный путь.",
    intent: plannerIntentForResult,
    toolCalls,
    outputs,
    sourceHints,
    toolActivity: buildToolActivity(toolCalls),
    sessionState: nextSessionState,
    configuredModel: modelConfig.configuredModel,
    actualModel: usedModel,
    settingsSource: modelConfig.settingsSource,
    usage: totalUsage,
    llm,
    navigationActions: [],
    performance: buildPerformance(),
  };
}
