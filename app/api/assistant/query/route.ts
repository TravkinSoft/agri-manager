import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedServerClient } from "@/lib/supabase/server-user";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { runReadOnlyAssistantV1 } from "@/lib/assistant/v1/engine";
import {
  buildAssistantLongTermMemoryContext,
  extractMemoryDeleteIntent,
  hasExplicitMemoryIntent,
  isAssistantMemoryV2RuntimeEnabled,
  listForgottenUserGlobalMemoryContext,
  type AssistantMemoryContext,
  type AssistantMemoryWriteResult,
} from "@/lib/assistant/memory-store";
import { processAssistantMemoryPolicyV2 } from "@/lib/assistant/v2/memory-policy";
import {
  appendAssistantThreadMessage,
  getAssistantThreadById,
  updateAssistantThreadTitle,
} from "@/lib/assistant/threads-store";
import {
  containsPotentialConversationSecret,
  deriveUnresolvedQuestionV1,
  loadServerConversationV2,
  verifyAssistantUiContextV2,
} from "@/lib/assistant/v2/server-conversation";
import { resolveAssistantRuntimeMode } from "@/lib/assistant/v2/runtime-mode";
import { RECENT_MESSAGES_LIMIT } from "@/lib/assistant/v2/context-limits";
import { enforceAssistantGreetingPolicy } from "@/lib/assistant/v2/greeting-policy";
import {
  A107RuntimeGuardError,
  A107_ALLOWED_BRANCH_REF,
  assertA107RuntimeGuard,
} from "@/lib/assistant/v1/a107-runtime-guard";
import type { AssistantDebugMetadata, AssistantDebugSettingsSource } from "@/lib/assistant/debug-types";
import type { AssistantEngineResult, AssistantNavigationAction } from "@/lib/assistant/engine/types";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

class AssistantRouteRuntimeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AssistantRouteRuntimeError";
    this.code = code;
    this.status = status;
  }
}

function applyExplicitLocalQaModelOverride(settings: AssistantPlatformSettings): AssistantPlatformSettings {
  const override = asString(process.env.ASSISTANT_LOCAL_QA_MODEL_OVERRIDE);
  const reasoningOverride = asString(process.env.REASONING_EFFORT);
  const localA107Runtime = process.env.A107_BRANCH_REF === A107_ALLOWED_BRANCH_REF;
  if (!localA107Runtime) return settings;
  return {
    ...settings,
    ...(override ? { model: override } : {}),
    ...(reasoningOverride === "low" || reasoningOverride === "medium" || reasoningOverride === "high"
      ? { reasoningEffort: reasoningOverride }
      : {}),
  };
}

function asString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

const INTERNAL_ANSWER_LINE_PATTERNS = [
  /PLAN\/FACT control/i,
  /Source of Truth contract/i,
  /Source of Truth mismatch/i,
  /Working Memory rule/i,
  /Router fallback/i,
  /crop_structure is PLAN/i,
  /Do not merge them without labels/i,
  /Do not choose one conflicting figure silently/i,
  /Detected area mismatch/i,
];

function stripInternalAssistantLines(content: string): string {
  const cleaned = String(content || "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_ANSWER_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || "Данных недостаточно, чтобы подтвердить ответ.";
}

function sanitizeAssistantAnswer(content: string): string {
  const cleaned = stripInternalAssistantLines(content);
  if (!hasQaDataMarker(cleaned)) return cleaned;
  return "Ответ скрыт: в истории или источнике обнаружены тестовые QA-данные. Повторите запрос, и я проверю только производственные данные.";
}

function filterProductionActions(actions: AssistantActionButton[]): AssistantActionButton[] {
  return actions.filter((action) => !hasQaDataMarker(JSON.stringify(action)));
}

function filterProductionToolActivity(activity: string[]): string[] {
  return activity.filter((line) => !hasQaDataMarker(line));
}

function isUuidLike(value: string | null): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function looksLikeErpDataQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(остат|склад|парт|движен|провод|журнал|ledger|inventory|warehouse|batch|stock|balance|талон|весов|топлив|гсм|поле|посев|операц|урожа)/.test(
    text
  );
}

function isDebugAllowed(role: string): boolean {
  if (role === "global_admin" || role === "company_admin") return true;
  return process.env.NEXT_PUBLIC_ASSISTANT_DEBUG === "1" || process.env.ASSISTANT_DEBUG === "1";
}

function countActiveFilters(filters: unknown): number {
  if (!filters || typeof filters !== "object") return 0;
  return Object.values(filters as Record<string, unknown>).reduce((acc: number, value) => {
    if (Array.isArray(value)) {
      return acc + (value.filter((item) => asString(item)).length ? 1 : 0);
    }
    return acc + (asString(value) ? 1 : 0);
  }, 0);
}

function entityLabel(entity: unknown): string | null {
  if (!entity || typeof entity !== "object") return null;
  const value = entity as Record<string, unknown>;
  const label = asString(value.label);
  if (label) return label;
  const type = asString(value.type);
  const id = asString(value.id);
  if (type && id) return `${type}:${id}`;
  return null;
}

function resolveCompanyContextSource(role: string, actor: { contextCompanyId: string | null; homeCompanyId: string | null }): string {
  if (role === "global_admin") return "switcher";
  if (actor.homeCompanyId) return "profile";
  if (actor.contextCompanyId) return "context";
  return "unknown";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildDebugTrustScore(params: {
  requestMessage: string;
  result: AssistantEngineResult;
  navigationActions: AssistantNavigationAction[];
}): AssistantDebugMetadata["trust"] {
  const { requestMessage, result, navigationActions } = params;
  const notes: string[] = [];
  const toolCount = result.toolCalls.length;
  const hasToolError = result.toolCalls.some((tool) => !tool.ok);
  const isKnowledge = result.mode === "agro_knowledge" || result.intent.name === "general_question";
  const isErpQuestion = looksLikeErpDataQuestion(requestMessage);
  const isFollowUp =
    requestMessage.trim().split(/\s+/).filter(Boolean).length <= 4 &&
    Boolean(
      result.sessionState.lastIntent ||
        result.sessionState.lastField ||
        result.sessionState.lastWarehouse ||
        result.sessionState.lastOperation ||
        result.sessionState.lastTicket ||
        result.sessionState.lastCropStructureSection ||
        result.sessionState.focusEntityLabel
    );
  const isAnalytics = /(risk|risks|analysis|analytics|analyze|concern|problem|подозр|риск|анализ|опасен|вопрос)/i.test(
    requestMessage
  );

  let sourceOfTruth = 90;
  if (result.diagnostics.consistencyCheck === "fail" || result.diagnostics.contradictionDetected) {
    sourceOfTruth = 55;
    notes.push("source_of_truth_check_failed");
  } else if (isErpQuestion && toolCount === 0) {
    sourceOfTruth = 45;
    notes.push("erp_question_without_tools");
  } else if (toolCount > 0 && result.grounded) {
    sourceOfTruth = 100;
  } else if (isKnowledge && toolCount === 0) {
    sourceOfTruth = 100;
  }
  if (hasToolError) {
    sourceOfTruth -= 20;
    notes.push("tool_error_present");
  }

  const contextMemory =
    result.sessionState.focusEntityLabel || result.sessionState.pendingActionType
      ? 100
      : result.sessionState.lastIntent || result.sessionState.lastEntity
        ? 95
        : 80;
  const followUp = isFollowUp ? (result.sessionState.lastIntent || result.sessionState.focusEntityLabel ? 100 : 60) : 90;

  let navigation = 100;
  if (result.explicitNavigationRequested || navigationActions.length > 0 || result.intent.name === "navigation_help") {
    if (result.navigationPolicy === "blocked") {
      navigation = 70;
      notes.push("navigation_blocked_or_unconfirmed");
    } else if (navigationActions.length > 0) {
      navigation = 90;
      notes.push("navigation_prepared_client_must_confirm");
    } else {
      navigation = 75;
      notes.push("navigation_requested_without_action");
    }
  }

  const knowledge = isKnowledge ? (toolCount === 0 ? 100 : 70) : 90;
  const analytics = isAnalytics ? (toolCount > 0 ? 85 : 60) : 90;
  if (isAnalytics && toolCount === 0) notes.push("analytics_without_erp_tools");

  const parts = [
    clampScore(sourceOfTruth),
    clampScore(contextMemory),
    clampScore(followUp),
    clampScore(navigation),
    clampScore(knowledge),
    clampScore(analytics),
  ];
  const score = clampScore(parts.reduce((sum, value) => sum + value, 0) / parts.length);

  return {
    score,
    sourceOfTruth: parts[0],
    contextMemory: parts[1],
    followUp: parts[2],
    navigation: parts[3],
    knowledge: parts[4],
    analytics: parts[5],
    notes,
  };
}

function buildDebugPerformanceScore(result: AssistantEngineResult, latencyMs: number): number {
  const totalMs = Math.max(0, Number(result.performance.totalMs ?? latencyMs ?? 0));
  const isKnowledge = result.mode === "agro_knowledge" || result.intent.name === "general_question";
  const targetMs = isKnowledge ? 3000 : 5000;
  if (totalMs <= targetMs) return 100;
  if (totalMs >= targetMs * 3) return 40;
  return clampScore(100 - ((totalMs - targetMs) / (targetMs * 2)) * 60);
}

function generateThreadTitle(message: string): string {
  const cleaned = String(message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Новый чат";
  const words = cleaned.split(" ").slice(0, 8).join(" ");
  return words.length > 80 ? `${words.slice(0, 77)}...` : words;
}

function mapToolNamespace(tool: string): string {
  const map: Record<string, string> = {
    get_current_context: "context.getPageContext",
    resolve_entity: "context.resolveEntity",
    get_quick_insights: "context.quickInsights",
    get_morning_report: "report.morning",
    get_operation_insights: "operation.insights",
    get_warehouse_insights: "warehouse.insights",
    get_weighbridge_insights: "weighbridge.insights",
    get_routes: "navigation.getRoutes",
    get_company_context: "context.getCompanyContext",
    get_current_season: "context.getCurrentSeason",
    get_field_land_bank_summary: "field.landBankSummary",
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
    get_active_operations_summary: "operation.activeSummary",
    get_operations: "operation.search",
    get_active_tickets: "weighbridge.tickets",
    get_recent_tickets: "weighbridge.tickets",
    get_ticket_details: "weighbridge.ticketDetails",
    get_weighbridge_tickets: "weighbridge.tickets",
    get_potato_material_report: "report.potato",
    get_crop_structure_summary: "crop.structure",
    get_crop_structure: "crop.structureRows",
    search_crops_by_group: "crop.group",
    create_operation_draft: "draft.operation",
    create_field_draft: "draft.field",
    create_meal_order_draft: "draft.mealOrder",
    create_warehouse_draft: "draft.warehouse",
    create_weighbridge_ticket_draft: "draft.weighbridgeTicket",
    create_transfer_draft: "draft.transfer",
    create_fuel_issue_draft: "draft.fuelIssue",
    create_field_task_draft: "draft.fieldTask",
    create_material_issue_draft: "draft.materialIssue",
    navigate_to_page: "navigation.navigateToRoute",
    open_entity: "navigation.openEntity",
    apply_filter: "navigation.applyFilter",
  };
  return map[tool] || tool;
}

type AssistantActionButton = {
  id: string;
  label: string;
  kind: "navigate" | "prompt";
  route?: string;
  filters?: Record<string, string>;
  prompt?: string;
  actionType?: "navigate" | "open_module" | "continue_draft" | "prepare_draft" | string;
  targetRoute?: string | null;
  requiresConfirmation?: boolean;
  payload?: Record<string, unknown>;
};

function parseActionPayload(value: unknown): Record<string, unknown> {
  const text = asString(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function routeForDraftKind(kind: string | null): string | null {
  switch (kind) {
    case "operation":
    case "field_task":
    case "material_issue":
      return "/operations";
    case "weighbridge_ticket":
      return "/weighbridge";
    case "warehouse":
    case "transfer":
      return "/warehouses";
    case "field":
      return "/fields";
    case "meal_order":
      return "/meal-thermoses";
    case "fuel_issue":
      return "/fuel";
    default:
      return null;
  }
}

function shouldAttachPendingDraftUi(params: {
  requestMessage: string;
  result: AssistantEngineResult;
  previousSessionState?: Partial<AssistantEngineResult["sessionState"]> | null;
}): boolean {
  const pendingType = asString(params.result.sessionState.pendingActionType);
  if (pendingType !== "create_draft") return false;
  if (params.result.intent.name === "create_draft") return true;

  const requestText = params.requestMessage.toLowerCase();
  if (/(\u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a|draft|continue|resume|\u043f\u0440\u043e\u0434\u043e\u043b\u0436)/i.test(requestText)) {
    return true;
  }

  const previousUpdatedAt = asString(params.previousSessionState?.pendingActionUpdatedAt);
  const currentUpdatedAt = asString(params.result.sessionState.pendingActionUpdatedAt);
  return Boolean(currentUpdatedAt && currentUpdatedAt !== previousUpdatedAt);
}

function buildActionButtons(params: {
  intentName: string | null;
  requestMessage: string;
  navigationActions: AssistantNavigationAction[];
  sessionState?: AssistantEngineResult["sessionState"] | null;
}): AssistantActionButton[] {
  const { navigationActions, sessionState } = params;
  const actions: AssistantActionButton[] = [];
  const add = (action: AssistantActionButton) => {
    if (!actions.some((item) => item.id === action.id)) actions.push(action);
  };

  if (navigationActions.length) {
    const first = navigationActions[0];
    if (first.type === "open_page") {
      add({
        id: "open_page",
        label: "Открыть страницу",
        kind: "navigate",
        route: first.route,
        targetRoute: first.route,
        actionType: "navigate",
        requiresConfirmation: false,
        payload: { page: first.page, navigationType: first.type },
      });
    }
    if (first.type === "open_page_with_filter" || first.type === "apply_filter" || first.type === "open_entity") {
      add({
        id: "open_filtered",
        label: first.type === "open_entity" ? "Открыть объект" : "Открыть с фильтром",
        kind: "navigate",
        route: first.route,
        filters: first.filters || {},
        targetRoute: first.route,
        actionType: "navigate",
        requiresConfirmation: false,
        payload: {
          page: first.page,
          navigationType: first.type,
          entityType: first.type === "open_entity" ? first.entityType : null,
          entityId: first.type === "open_entity" ? first.entityId : null,
        },
      });
    }
  }

  if (sessionState?.pendingActionType === "create_draft") {
    const payload = parseActionPayload(sessionState.pendingActionPayloadJson);
    const draftKind = asString(payload.draftKind) || "operation";
    const missingFields = Array.isArray(payload.missingFields)
      ? payload.missingFields
          .map((item) => (item && typeof item === "object" ? asString((item as Record<string, unknown>).label) : null))
          .filter(Boolean)
      : [];
    const missingText = missingFields.length ? ` Нужно уточнить: ${missingFields.join(", ")}.` : "";
    add({
      id: "continue_pending_draft",
      label: "Продолжить черновик",
      kind: "prompt",
      prompt: `Продолжим черновик.${missingText}`,
      actionType: "continue_draft",
      requiresConfirmation: false,
      payload: {
        draftKind,
        missingFields,
        pendingActionType: sessionState.pendingActionType,
      },
    });

    const route = routeForDraftKind(draftKind);
    if (route) {
      add({
        id: "open_pending_draft_module",
        label: "Открыть модуль",
        kind: "navigate",
        route,
        targetRoute: route,
        actionType: "open_module",
        requiresConfirmation: false,
        payload: {
          page: route.replace(/^\//, "") || "dashboard",
          draftKind,
          pendingActionType: sessionState.pendingActionType,
        },
      });
    }
  }

  return actions.slice(0, 3);
}

function buildDebugMetadata(params: {
  role: string;
  actorId: string;
  authUserId: string;
  companyId: string;
  companyName: string | null;
  settings: {
    provider?: string;
    model?: string;
    temperature?: number;
    reasoningEffort?: string;
  };
  runtimeContext: unknown;
  requestMessage: string;
  sessionId: string | null;
  threadId: string | null;
  result: AssistantEngineResult & {
    runtimeDiagnostics?: {
      effectiveTemperature?: number | null;
      effectiveReasoning?: string;
      requestedReasoning?: string;
      historyMessageCount?: number;
      availableTools?: string[];
    };
  };
  navigationActions: AssistantNavigationAction[];
  latencyMs: number;
  actor: {
    contextCompanyId: string | null;
    homeCompanyId: string | null;
  };
  threadPersistenceError: string | null;
  longTermMemory: AssistantMemoryContext;
  memoryWrite: AssistantMemoryWriteResult;
  memoryReadMs: number | null;
  memoryWriteMs: number | null;
}): AssistantDebugMetadata {
  const {
    role,
    actorId,
    authUserId,
    companyId,
    companyName,
    settings,
    runtimeContext,
    requestMessage,
    sessionId,
    threadId,
    result,
    navigationActions,
    latencyMs,
    actor,
    threadPersistenceError,
    longTermMemory,
    memoryWrite,
    memoryReadMs,
    memoryWriteMs,
  } = params;

  const runtime = (runtimeContext || {}) as Record<string, unknown>;
  const runtimeFilters = runtime.filters;
  const runtimeSelectedRows = Array.isArray(runtime.selectedRows) ? runtime.selectedRows : [];
  const lastToolError = result.toolCalls.find((tool) => !tool.ok && tool.error)?.error || null;
  const warnings: string[] = [];

  const isKnowledgeAnswer = result.mode === "agro_knowledge" || result.intent.name === "general_question";
  if (!isKnowledgeAnswer && looksLikeErpDataQuestion(requestMessage) && result.answerSource === "llm_fallback") {
    warnings.push("Ответ по ERP-данным был без tool grounding.");
  }
  if (threadPersistenceError) {
    warnings.push(`Ошибка сохранения истории: ${threadPersistenceError}`);
  }
  if (result.runtimeDiagnostics?.effectiveReasoning === "unsupported") {
    warnings.push(`Reasoning setting ${result.runtimeDiagnostics.requestedReasoning || "unknown"} is unsupported in A101 Chat Completions runtime.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    model: {
      provider: asString(settings.provider),
      configuredModel: asString(result.model.configuredModel || settings.model),
      actualModel: asString(result.model.actualModel),
      settingsSource: result.model.settingsSource as AssistantDebugSettingsSource,
      promptVersion: asString(result.model.promptVersion),
      promptSource: result.model.promptSource,
      promptUpdatedAt: asString(result.model.promptUpdatedAt),
      temperature:
        Number.isFinite(Number(result.runtimeDiagnostics?.effectiveTemperature))
          ? Number(result.runtimeDiagnostics?.effectiveTemperature)
          : null,
      reasoningEffort: asString(result.runtimeDiagnostics?.effectiveReasoning) || "unsupported",
      requestMode: result.model.requestMode,
      llmStatus: result.model.llm.status,
      llmHttpStatus: result.model.llm.httpStatus,
      llmErrorCode: result.model.llm.errorCode,
      llmErrorMessage: result.model.llm.errorMessage,
      llmMissingEnv: result.model.llm.missingEnv || [],
    },
    access: {
      role: asString(role),
      authUserId: asString(authUserId),
      profileId: asString(actorId),
      companyId: asString(companyId),
      companyName: asString(companyName),
      companyContextSource: resolveCompanyContextSource(role, actor),
      authStatus: authUserId ? "ok" : "error",
    },
    runtime: {
      currentPage: asString(runtime.currentPage),
      currentRoute: asString(runtime.currentRoute),
      currentEntity: entityLabel(runtime.entity),
      currentModule: asString(runtime.currentModule),
      selectedFieldId: asString(runtime.selectedFieldId),
      selectedFieldLabel: asString(runtime.selectedFieldLabel),
      selectedWarehouseId: asString(runtime.selectedWarehouseId),
      selectedWarehouseLabel: asString(runtime.selectedWarehouseLabel),
      selectedCropStructureSectionId: asString(runtime.selectedCropStructureSectionId),
      selectedCropStructureSectionLabel: asString(runtime.selectedCropStructureSectionLabel),
      selectedOperationId: asString(runtime.selectedOperationId),
      selectedOperationLabel: asString(runtime.selectedOperationLabel),
      selectedTicketId: asString(runtime.selectedTicketId),
      selectedTicketLabel: asString(runtime.selectedTicketLabel),
      selectedBatchId: asString(runtime.selectedBatchId),
      selectedBatchLabel: asString(runtime.selectedBatchLabel),
      selectedRowsCount: runtimeSelectedRows.length,
      activeFiltersCount: countActiveFilters(runtimeFilters),
      season: asString(runtime.season),
      locale: asString(runtime.locale),
    },
    engine: {
      endpoint: "/api/assistant/query",
      engineVersion: "assistant-a101-read-only-v1",
      intent: asString(result.intent.name),
      expectedAnswerType: asString(result.diagnostics.expectedAnswerType),
      selectedSource: asString(result.diagnostics.selectedSource),
      selectedTool: asString(result.diagnostics.selectedTool),
      fallbackSource: asString(result.diagnostics.fallbackSource),
      mode: asString(result.mode),
      grounded: result.grounded,
      answerSource: result.answerSource,
      decisionSource: result.decisionSource || null,
      explicitNavigationRequested:
        typeof result.explicitNavigationRequested === "boolean"
          ? result.explicitNavigationRequested
          : undefined,
      navigationPolicy: result.navigationPolicy || null,
      consistencyCheck: result.diagnostics.consistencyCheck,
      contradictionDetected: result.diagnostics.contradictionDetected,
      correctionApplied: result.diagnostics.correctionApplied,
      previousRelatedMemory: asString(result.diagnostics.previousRelatedMemory),
      navigationIntentDetected: result.intent.name === "navigation_help",
      navigationActionCreated: navigationActions.length > 0,
      navigationActionExecuted: null,
      navigationActionType: navigationActions[0]?.type || null,
      navigationEntityType:
        navigationActions[0]?.type === "open_entity" ? navigationActions[0].entityType : null,
      navigationEntityId:
        navigationActions[0]?.type === "open_entity" ? navigationActions[0].entityId : null,
      navigationFilters:
        navigationActions[0] && "filters" in navigationActions[0]
          ? ((navigationActions[0] as any).filters || null)
          : null,
      targetRoute: navigationActions[0]?.route || null,
      routerError: null,
      toolCount: result.toolCalls.length,
      usedTools: result.toolCalls.map((toolCall) => ({
        tool: mapToolNamespace(toolCall.tool),
        ok: toolCall.ok,
        rows: Number.isFinite(Number(toolCall.rows)) ? Number(toolCall.rows) : 0,
        error: asString(toolCall.error),
        args:
          toolCall.params && typeof toolCall.params === "object"
            ? (toolCall.params as Record<string, unknown>)
            : null,
        resolvedSeason: asString(runtime.season) || asString((toolCall.params as any)?.season) || "2026",
        companyId: asString(companyId),
      })),
      lastToolError: asString(lastToolError),
    },
    memory: {
      sessionId: asString(sessionId) || asString(threadId),
      lastCrop: asString(result.sessionState.lastCrop),
      lastVariety: asString(result.sessionState.lastVariety),
      lastWarehouse: asString(result.sessionState.lastWarehouse),
      lastField: asString(result.sessionState.lastField),
      lastOperation: asString(result.sessionState.lastOperation),
      lastTicket: asString(result.sessionState.lastTicket),
      lastCropStructureSection: asString(result.sessionState.lastCropStructureSection),
      lastBatch: asString(result.sessionState.lastBatch),
      lastIntent: asString(result.sessionState.lastIntent),
      focusEntityType: asString(result.sessionState.focusEntityType),
      focusEntityId: asString(result.sessionState.focusEntityId),
      focusEntityLabel: asString(result.sessionState.focusEntityLabel),
      focusModule: asString(result.sessionState.focusModule),
      focusRoute: asString(result.sessionState.focusRoute),
      focusSource: asString(result.sessionState.focusSource),
      pendingActionType: asString(result.sessionState.pendingActionType),
      pendingActionSummary: asString(result.sessionState.pendingActionSummary),
      pendingActionRoute: asString(result.sessionState.pendingActionRoute),
      lastActionType: asString(result.sessionState.lastActionType),
      lastActionSummary: asString(result.sessionState.lastActionSummary),
      longTermMemoryCount: longTermMemory.count,
      longTermMemoryLatestAt: asString(longTermMemory.latestUpdatedAt),
      longTermMemoryWarning: asString(longTermMemory.warning),
      memorySavedCount: memoryWrite.savedCount,
      memoryWriteSkippedReason: asString(memoryWrite.skippedReason),
      memoryWriteWarning: asString(memoryWrite.warning),
      followUpActive: Boolean(
        result.sessionState.lastResultContext ||
          result.sessionState.lastEntity ||
          result.sessionState.focusEntityLabel ||
          result.sessionState.lastOperation ||
          result.sessionState.lastTicket ||
          result.sessionState.lastCropStructureSection ||
          result.sessionState.lastBatch
      ),
    },
    performance: {
      score: buildDebugPerformanceScore(result, latencyMs),
      latencyMs: Math.max(0, Math.round(latencyMs)),
      routerMs: result.performance.routerMs,
      plannerMs: result.performance.plannerMs,
      toolMs: result.performance.toolMs,
      validatorMs: result.performance.validatorMs,
      modelMs: result.performance.modelMs,
      responseRenderMs: result.performance.responseRenderMs,
      memoryReadMs,
      memoryWriteMs,
      totalMs: result.performance.totalMs ?? Math.max(0, Math.round(latencyMs)),
      promptTokens: result.performance.promptTokens,
      completionTokens: result.performance.completionTokens,
      totalTokens: result.performance.totalTokens,
    },
    trust: buildDebugTrustScore({ requestMessage, result, navigationActions }),
    warnings,
  };
}

function mapSessionErrorCode(error: SessionAuthError): string {
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("missing authorization")) return "AUTH_MISSING";
  if (msg.includes("invalid or expired")) return "AUTH_INVALID";
  if (msg.includes("profile not found")) return "PROFILE_NOT_FOUND";
  if (msg.includes("unknown user role")) return "ROLE_UNKNOWN";
  if (msg.includes("inactive user profile")) return "PROFILE_INACTIVE";
  if (msg.includes("not available for current role")) return "ROLE_FORBIDDEN";
  if (msg.includes("legacy role alias")) return "ROLE_LEGACY_ALIAS";
  if (msg.includes("company context is not selected")) return "COMPANY_CONTEXT_REQUIRED";
  if (msg.includes("company context is not configured")) return "COMPANY_CONTEXT_MISSING";
  if (msg.includes("invalid company id")) return "COMPANY_CONTEXT_INVALID";
  if (msg.includes("company mismatch")) return "COMPANY_CONTEXT_MISMATCH";
  return "SESSION_AUTH_ERROR";
}

export async function POST(request: NextRequest) {
  let actorId = "";
  let authUserId = "";
  let companyId = "";
  let companyName: string | null = null;
  let role = "";
  let chatId: string | null = null;
  let threadId: string | null = null;
  let sessionId: string | null = null;
  let requestMessage: string | null = null;
  let threadPersistenceError: string | null = null;
  let persistedAssistantMessageId: string | null = null;
  const startedAt = Date.now();

  try {
    assertA107RuntimeGuard();
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    role = actor.role;
    actorId = actor.id;
    authUserId = actor.authUserId;

    const payload = await request.json().catch(() => ({}));
    requestMessage = asString(payload?.message);
    if (!requestMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (containsPotentialConversationSecret(requestMessage)) {
      return NextResponse.json(
        { error: "Potential secret detected in message", code: "MESSAGE_SECRET_REJECTED", memorySaved: false },
        { status: 400 }
      );
    }

    const requestedCompanyId = asString(payload?.companyId) || asString((payload as any)?.runtimeContext?.companyId);
    companyId = resolveCompanyForActor(actor, requestedCompanyId);
    chatId = asString(payload?.chatId);
    threadId = asString(payload?.threadId) || chatId;
    sessionId = threadId;
    if (!threadId) {
      return NextResponse.json({ error: "Thread is required", code: "THREAD_REQUIRED" }, { status: 400 });
    }

    const supabase = getAuthenticatedServerClient(request);
    const toolSupabase = supabase;
    let longTermMemory: AssistantMemoryContext = {
      count: 0,
      contextText: null,
      latestUpdatedAt: null,
      warning: null,
      ids: [],
      categories: [],
    };
    let memoryReadMs: number | null = 0;
    const companyPromise = supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
    const settingsPromise = getAssistantPlatformSettings(supabase, actor.id);
    const threadPromise = getAssistantThreadById({
      supabase,
      companyId,
      userId: actor.id,
      threadId,
    });

    const [companyRes, storedSettings, thread] = await Promise.all([companyPromise, settingsPromise, threadPromise]);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found in current company scope", code: "THREAD_DENIED" }, { status: 404 });
    }
    companyName = asString(companyRes.data?.name) || null;
    const settings = applyExplicitLocalQaModelOverride(storedSettings);
    longTermMemory = {
      count: 0,
      contextText: null,
      latestUpdatedAt: null,
      warning: null,
      ids: [],
      categories: [],
    };
    const runtimeMode = resolveAssistantRuntimeMode();
    const runtimeContextPayload = await verifyAssistantUiContextV2({
      supabase: toolSupabase,
      raw:
        payload?.runtimeContext && typeof payload.runtimeContext === "object"
          ? payload.runtimeContext as Record<string, unknown>
          : null,
      companyId,
      companyName,
      userId: actor.id,
      userRole: actor.role,
    });

    let persistedUserMessage;
    try {
      persistedUserMessage = await appendAssistantThreadMessage({
        supabase,
        companyId,
        userId: actor.id,
        threadId,
        role: "user",
        content: requestMessage,
        metadata: {
          runtime_context_server: runtimeContextPayload,
          context_source: "server_verified_ui",
          assistant_runtime_mode: runtimeMode,
          assistant_panel: true,
        },
      });
    } catch (error) {
      throw new AssistantRouteRuntimeError(
        "USER_MESSAGE_PERSISTENCE_FAILED",
        error instanceof Error ? error.message : "User message persistence failed",
        500
      );
    }

    let memoryWrite: AssistantMemoryWriteResult = {
      savedCount: 0,
      deletedCount: 0,
      skippedReason: "memory_runtime_disabled",
      warning: null,
      action: "noop",
      provenance: null,
      ids: [],
    };
    const explicitMemoryIntent = hasExplicitMemoryIntent(requestMessage);
    const deleteMemoryIntent = Boolean(extractMemoryDeleteIntent(requestMessage));
    let memoryWriteMs: number | null = 0;
    if (isAssistantMemoryV2RuntimeEnabled()) {
      const memoryWriteStartedAt = Date.now();
      try {
        memoryWrite = await processAssistantMemoryPolicyV2({
          supabase,
          message: requestMessage,
          sourceMessageId: persistedUserMessage.id,
          actor: { companyId, userId: actor.id },
          settings,
        });
      } catch (error) {
        memoryWrite = {
          savedCount: 0,
          deletedCount: 0,
          skippedReason: "memory_policy_rejected",
          warning: error instanceof Error ? error.message : "Memory Policy V2 failed closed.",
          action: "noop",
          provenance: null,
          ids: [],
        };
      }
      memoryWriteMs = Date.now() - memoryWriteStartedAt;

      const memoryStartedAt = Date.now();
      longTermMemory = await buildAssistantLongTermMemoryContext({
        supabase,
        companyId,
        userId: actor.id,
        query: requestMessage,
        limit: 12,
      });
      memoryReadMs = Date.now() - memoryStartedAt;
    }

    const forgottenMemoryContext = isAssistantMemoryV2RuntimeEnabled()
      ? await listForgottenUserGlobalMemoryContext({ supabase, userId: actor.id })
      : { memoryIds: [], sourceMessageIds: [], terms: [], warning: null };
    const serverConversation = await loadServerConversationV2({
      supabase,
      companyId,
      userId: actor.id,
      threadId,
      currentUserMessageId: persistedUserMessage.id,
      verifiedUiContext: runtimeContextPayload,
      forgottenMemoryIds: forgottenMemoryContext.memoryIds,
      forgottenSourceMessageIds: forgottenMemoryContext.sourceMessageIds,
      forgottenTerms: forgottenMemoryContext.terms,
    });
    const result = await runReadOnlyAssistantV1({
      supabase: toolSupabase,
      actor,
      companyId,
      companyName,
      settings,
      input: {
        message: requestMessage,
        locale: runtimeContextPayload.locale || "ru",
        threadId,
        historyThreadId: threadId,
        history: serverConversation.history,
        runtimeContext: runtimeContextPayload,
        threadState: serverConversation.state,
        historyTruncated: serverConversation.historyTruncated,
        meaningfulHistoryCount: serverConversation.meaningfulMessageCount,
        summaryContext: serverConversation.summaryContext,
        unresolvedQuestionContext: serverConversation.unresolvedQuestionContext,
        approvedMemoryContext: longTermMemory.contextText,
      },
      dependencies: { runtimeMode },
    });

    if (result.model.llm.status !== "ok" && result.model.llm.status !== "not_called") {
      const errorCode = result.model.llm.errorCode || "ASSISTANT_MODEL_RUNTIME_FAILED";
      const status = result.model.llm.httpStatus === 429
        ? 429
        : errorCode === "OPENAI_TIMEOUT"
          ? 504
          : result.model.llm.status === "missing_api_key"
            ? 503
            : 502;
      throw new AssistantRouteRuntimeError(
        errorCode,
        result.model.llm.errorMessage || "Assistant model runtime failed",
        status
      );
    }
    let safeAnswer = sanitizeAssistantAnswer(result.answer);
    if (explicitMemoryIntent) {
      const confirmedWrite = memoryWrite.action === "save" &&
        memoryWrite.savedCount > 0 &&
        (memoryWrite.ids?.length || 0) === memoryWrite.savedCount;
      safeAnswer = confirmedWrite
        ? "Запомнил. Сведения сохранены в личную память и будут доступны во всех ваших чатах."
        : "Не удалось сохранить это в память.";
    } else if (deleteMemoryIntent) {
      safeAnswer = memoryWrite.action === "delete" && (memoryWrite.deletedCount || 0) > 0
        ? "Удалил указанные сведения из памяти."
        : "Не удалось удалить это из памяти.";
    }
    const greetingPolicyResult = enforceAssistantGreetingPolicy({
      answer: safeAnswer,
      currentUserMessage: requestMessage,
      priorMessageCount: serverConversation.meaningfulMessageCount,
    });
    safeAnswer = greetingPolicyResult.answer;
    const responseActions: AssistantActionButton[] = [];
    const responseDraftCards: never[] = [];
    const responseNavigationActions: AssistantNavigationAction[] = [];
    const unresolvedQuestion = deriveUnresolvedQuestionV1({
      threadId,
      previous: serverConversation.unresolvedQuestion,
      nextQuestion: result.threadState.unresolvedQuestion,
      userMessage: requestMessage,
      state: result.threadState,
    });

    try {
      const assistantThreadMessage = await appendAssistantThreadMessage({
        supabase,
        companyId,
        userId: actor.id,
        threadId,
        role: "assistant",
        content: safeAnswer,
        metadata: {
          intent: result.intent?.name || null,
          mode: result.mode || null,
          output_type: result.outputType || null,
          source_hints: result.sourceHints || [],
          tool_activity: filterProductionToolActivity(result.toolActivity || []),
          actions: responseActions,
          draft_cards: responseDraftCards,
          tool_calls: result.toolCalls || [],
          navigation_actions: responseNavigationActions,
          answer_source: result.answerSource,
          grounded: result.grounded,
          llm: result.model.llm,
          prompt_version: result.model.promptVersion,
          prompt_source: result.model.promptSource,
          prompt_updated_at: result.model.promptUpdatedAt,
          read_only_thread_state: result.threadState,
          read_only_runtime: result.runtimeDiagnostics,
          read_only_performance: result.performance,
          server_conversation_v2: {
            recent_messages_limit: RECENT_MESSAGES_LIMIT,
            recent_previous_messages_count: serverConversation.history.length,
            current_user_message_included: true,
            history_truncated: serverConversation.historyTruncated,
            meaningful_message_count: serverConversation.meaningfulMessageCount,
            excluded_message_count: serverConversation.excludedMessageCount,
            summary: serverConversation.summary,
            greeting_policy: {
              prior_message_count: greetingPolicyResult.policy.priorMessageCount,
              current_message_is_greeting: greetingPolicyResult.policy.currentMessageIsGreeting,
              greeting_allowed: greetingPolicyResult.policy.greetingAllowed,
              repeated_greeting_removed: greetingPolicyResult.greetingRemoved,
            },
          },
          conversation_summary_v1: serverConversation.summary,
          unresolved_question_v1: unresolvedQuestion,
          session_id: threadId,
          assistant_runtime_mode: runtimeMode,
          assistant_memory_policy_v2: {
            action: memoryWrite.action || "noop",
            saved_count: memoryWrite.savedCount,
            deleted_count: memoryWrite.deletedCount || 0,
            provenance: memoryWrite.provenance || null,
            memory_ids: memoryWrite.ids || [],
            skipped_reason: memoryWrite.skippedReason,
            warning: memoryWrite.warning,
          },
          assistant_panel: true,
        },
      });
      persistedAssistantMessageId = assistantThreadMessage.id;
    } catch (error) {
      throw new AssistantRouteRuntimeError(
        "ASSISTANT_MESSAGE_PERSISTENCE_FAILED",
        error instanceof Error ? error.message : "Assistant message persistence failed",
        500
      );
    }

    if ((thread.title || "").trim() === "Новый чат") {
      try {
        await updateAssistantThreadTitle({
          supabase,
          companyId,
          userId: actor.id,
          threadId,
          title: generateThreadTitle(requestMessage),
        });
      } catch {
        // The assistant message is already durable; title refresh is non-critical.
      }
    }

    const debugAllowed = isDebugAllowed(actor.role);
    const visibleToolActivity = debugAllowed ? filterProductionToolActivity(result.toolActivity || []) : [];
    const debug = debugAllowed
      ? buildDebugMetadata({
          role: actor.role,
          actorId: actor.id,
          authUserId: actor.authUserId,
          companyId,
          companyName,
          settings,
          runtimeContext: runtimeContextPayload,
          requestMessage: requestMessage || "",
          sessionId,
          threadId,
          result,
          navigationActions: responseNavigationActions,
          latencyMs: Date.now() - startedAt,
          actor: {
            contextCompanyId: actor.contextCompanyId,
            homeCompanyId: actor.homeCompanyId,
          },
          threadPersistenceError,
          longTermMemory,
          memoryWrite,
          memoryReadMs,
          memoryWriteMs,
        })
      : undefined;

    return NextResponse.json({
      response: safeAnswer,
      sessionState: result.sessionState,
      threadState: result.threadState,
      threadId,
      messageIds: {
        assistant: persistedAssistantMessageId,
      },
      navigationActions: responseNavigationActions,
      actions: responseActions,
      draftCards: responseDraftCards,
      toolActivity: visibleToolActivity,
      meta: {
        intent: result.intent,
        mode: result.mode,
        outputType: result.outputType,
        answerSource: result.answerSource,
        decisionSource: result.decisionSource || null,
        explicitNavigationRequested: result.explicitNavigationRequested ?? null,
        navigationPolicy: result.navigationPolicy || null,
        sourceHints: result.sourceHints,
        performance: result.performance,
        llm: result.model.llm,
        readOnlyRuntime: result.runtimeDiagnostics,
        runtimeMode,
        historyTruncated: serverConversation.historyTruncated,
        greetingPolicy: {
          priorMessageCount: greetingPolicyResult.policy.priorMessageCount,
          currentMessageIsGreeting: greetingPolicyResult.policy.currentMessageIsGreeting,
          greetingAllowed: greetingPolicyResult.policy.greetingAllowed,
          repeatedGreetingRemoved: greetingPolicyResult.greetingRemoved,
        },
        summary: {
          active: Boolean(serverConversation.summary),
          coveredMessageCount: serverConversation.summary?.coveredMessageCount || 0,
        },
        memory: {
          count: longTermMemory.count,
          categories: longTermMemory.categories,
          ids: longTermMemory.ids,
        },
        memoryWrite: {
          action: memoryWrite.action || "noop",
          savedCount: memoryWrite.savedCount,
          deletedCount: memoryWrite.deletedCount || 0,
          provenance: memoryWrite.provenance || null,
          ids: memoryWrite.ids || [],
          skippedReason: memoryWrite.skippedReason,
          warning: memoryWrite.warning,
        },
        conversationMemorySaved: Boolean(persistedAssistantMessageId),
        prompt: {
          version: result.model.promptVersion,
          source: result.model.promptSource,
          updated_at: result.model.promptUpdatedAt,
        },
      },
      ...(debug ? { debug } : {}),
    });
  } catch (error) {
    if (error instanceof A107RuntimeGuardError) {
      return NextResponse.json(
        { error: error.message, code: error.code, memorySaved: false },
        { status: 503 }
      );
    }
    if (error instanceof AssistantRouteRuntimeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          memorySaved: false,
        },
        { status: error.status }
      );
    }
    if (error instanceof SessionAuthError) {
      return NextResponse.json(
        {
          error: error.message,
          code: mapSessionErrorCode(error),
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Assistant query failed",
        code: "ASSISTANT_QUERY_FAILED",
        memorySaved: false,
      },
      { status: 500 }
    );
  }
}
