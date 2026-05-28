import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { runAssistantEngine } from "@/lib/assistant/engine/query";
import { writeAssistantAuditLog } from "@/lib/assistant/audit-log";
import {
  appendAssistantThreadMessage,
  getAssistantThreadById,
  updateAssistantThreadTitle,
} from "@/lib/assistant/threads-store";
import type { AssistantDebugMetadata, AssistantDebugSettingsSource } from "@/lib/assistant/debug-types";
import type { AssistantEngineResult, AssistantNavigationAction } from "@/lib/assistant/engine/types";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
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

function detectModelSettingsSource(settingsModel: string | null): AssistantDebugSettingsSource {
  const configured = asString(settingsModel);
  const envModel = asString(process.env.OPENAI_ASSISTANT_MODEL);
  if (configured && envModel && configured === envModel) return "env";
  if (!configured || configured === "gpt-5.4-mini") return "default";
  return "db";
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
    get_routes: "navigation.getRoutes",
    get_company_context: "context.getCompanyContext",
    get_current_season: "context.getCurrentSeason",
    find_field: "fields.searchFields",
    search_fields: "fields.searchFields",
    get_field_card: "fields.getFieldCard",
    get_field_timeline: "fields.getFieldTimeline",
    get_field_materials: "fields.getFieldMaterials",
    find_warehouse: "warehouses.searchWarehouses",
    search_warehouses: "warehouses.searchWarehouses",
    get_warehouse_summary: "warehouses.getWarehouseSummary",
    get_warehouse_stock: "warehouses.getWarehouseStock",
    get_warehouse_balances: "warehouses.getWarehouseStock",
    get_warehouse_movements: "warehouses.getWarehouseMovements",
    find_operation: "operations.searchOperations",
    search_operations: "operations.searchOperations",
    get_operation_details: "operations.getOperationDetails",
    get_active_operations: "operations.getActiveOperations",
    get_operations: "operations.getOperations",
    get_active_tickets: "weighbridge.getActiveTickets",
    get_recent_tickets: "weighbridge.getRecentTickets",
    get_ticket_details: "weighbridge.getTicketDetails",
    get_weighbridge_tickets: "weighbridge.getRecentTickets",
    get_potato_material_report: "reports.getPotatoMaterialReport",
    get_crop_structure_summary: "reports.getCropStructureSummary",
    get_crop_structure: "reports.getCropStructure",
    search_crops_by_group: "agro.searchCropsByGroup",
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
};

function buildActionButtons(params: {
  intentName: string | null;
  requestMessage: string;
  navigationActions: AssistantNavigationAction[];
}): AssistantActionButton[] {
  const { intentName, requestMessage, navigationActions } = params;
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
      });
    }
    if (first.type === "open_page_with_filter" || first.type === "apply_filter" || first.type === "open_entity") {
      add({
        id: "open_filtered",
        label: first.type === "open_entity" ? "Открыть объект" : "Открыть с фильтром",
        kind: "navigate",
        route: first.route,
        filters: first.filters || {},
      });
    }
  }

  const lower = String(requestMessage || "").toLowerCase();
  if (intentName === "fields_overview" || lower.includes("пол")) {
    add({ id: "goto_fields", label: "Открыть поле", kind: "navigate", route: "/fields" });
    add({ id: "prompt_field_timeline", label: "История поля", kind: "prompt", prompt: "Покажи timeline поля" });
    add({ id: "prompt_field_materials", label: "Материалы поля", kind: "prompt", prompt: "Покажи материалы по полю" });
  } else if (intentName === "inventory_balance" || lower.includes("склад")) {
    add({ id: "goto_warehouses", label: "Открыть склады", kind: "navigate", route: "/warehouses" });
    add({ id: "prompt_negative_stock", label: "Отрицательные остатки", kind: "prompt", prompt: "Покажи отрицательные остатки" });
    add({ id: "prompt_warehouse_moves", label: "Последние движения", kind: "prompt", prompt: "Покажи последние движения склада" });
  } else if (intentName === "operations_recent" || lower.includes("операц")) {
    add({ id: "goto_operations", label: "Открыть операции", kind: "navigate", route: "/operations" });
    add({ id: "prompt_active_ops", label: "Активные операции", kind: "prompt", prompt: "Покажи активные операции" });
  } else if (intentName === "weighbridge_tickets" || lower.includes("весов")) {
    add({ id: "goto_weighbridge", label: "Открыть весовую", kind: "navigate", route: "/weighbridge" });
    add({ id: "prompt_active_tickets", label: "Активные талоны", kind: "prompt", prompt: "Покажи активные талоны" });
  } else if (lower.includes("картоф")) {
    add({
      id: "goto_potato_report",
      label: "Отчёт по картофелю",
      kind: "navigate",
      route: "/analytics",
      filters: { report: "potato-material-consumption" },
    });
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
  result: AssistantEngineResult;
  navigationActions: AssistantNavigationAction[];
  latencyMs: number;
  actor: {
    contextCompanyId: string | null;
    homeCompanyId: string | null;
  };
  threadPersistenceError: string | null;
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
  } = params;

  const runtime = (runtimeContext || {}) as Record<string, unknown>;
  const runtimeFilters = runtime.filters;
  const runtimeSelectedRows = Array.isArray(runtime.selectedRows) ? runtime.selectedRows : [];
  const lastToolError = result.toolCalls.find((tool) => !tool.ok && tool.error)?.error || null;
  const warnings: string[] = [];

  if (looksLikeErpDataQuestion(requestMessage) && result.answerSource === "llm_fallback") {
    warnings.push("Ответ по ERP-данным был без tool grounding.");
  }
  if (threadPersistenceError) {
    warnings.push(`Ошибка сохранения истории: ${threadPersistenceError}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    model: {
      provider: asString(settings.provider),
      configuredModel: asString(settings.model),
      actualModel: asString(result.model.actualModel),
      settingsSource: detectModelSettingsSource(settings.model || null),
      temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : null,
      reasoningEffort: asString(settings.reasoningEffort),
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
      selectedRowsCount: runtimeSelectedRows.length,
      activeFiltersCount: countActiveFilters(runtimeFilters),
      season: asString(runtime.season),
      locale: asString(runtime.locale),
    },
    engine: {
      endpoint: "/api/assistant/query",
      engineVersion: "assistant-engine-v2",
      intent: asString(result.intent.name),
      mode: asString(result.mode),
      grounded: result.grounded,
      answerSource: result.answerSource,
      navigationIntentDetected: result.intent.name === "navigation_help",
      navigationActionCreated: navigationActions.length > 0,
      navigationActionExecuted: null,
      targetRoute: navigationActions[0]?.route || null,
      routerError: null,
      toolCount: result.toolCalls.length,
      usedTools: result.toolCalls.map((toolCall) => ({
        tool: mapToolNamespace(toolCall.tool),
        ok: toolCall.ok,
        rows: Number.isFinite(Number(toolCall.rows)) ? Number(toolCall.rows) : 0,
        error: asString(toolCall.error),
      })),
      lastToolError: asString(lastToolError),
    },
    memory: {
      sessionId: asString(sessionId) || asString(threadId),
      lastCrop: asString(result.sessionState.lastCrop),
      lastVariety: asString(result.sessionState.lastVariety),
      lastWarehouse: asString(result.sessionState.lastWarehouse),
      lastField: asString(result.sessionState.lastField),
      lastIntent: asString(result.sessionState.lastIntent),
      followUpActive: Boolean(result.sessionState.lastResultContext || result.sessionState.lastEntity),
    },
    performance: {
      latencyMs: Math.max(0, Math.round(latencyMs)),
      promptTokens: result.performance.promptTokens,
      completionTokens: result.performance.completionTokens,
      totalTokens: result.performance.totalTokens,
    },
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
  let shouldWriteAuditLog = true;
  let threadPersistenceError: string | null = null;
  const startedAt = Date.now();

  try {
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

    companyId = resolveCompanyForActor(actor, asString(payload?.companyId));
    chatId = asString(payload?.chatId);
    threadId = asString(payload?.threadId) || chatId;
    sessionId = asString(payload?.sessionId);

    const supabase = getServiceClient();
    const companyRes = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
    companyName = asString(companyRes.data?.name) || null;
    const settings = await getAssistantPlatformSettings(supabase, actor.id);
    shouldWriteAuditLog = !!settings.logging?.enabled;

    const result = await runAssistantEngine({
      supabase,
      actor,
      companyId,
      settings,
      input: {
        message: requestMessage,
        locale: payload?.locale || "ru",
        chatId: threadId,
        chatHistory: Array.isArray(payload?.chatHistory) ? payload.chatHistory : [],
        runtimeContext: payload?.runtimeContext || null,
        sessionState: payload?.sessionState || null,
      },
    });

    if (threadId) {
      try {
        const thread = await getAssistantThreadById({
          supabase,
          companyId,
          userId: actor.id,
          threadId,
        });
        if (thread) {
          await appendAssistantThreadMessage({
            supabase,
            companyId,
            userId: actor.id,
            threadId,
            role: "user",
            content: requestMessage,
            metadata: {
              runtime_context: payload?.runtimeContext || null,
              session_id: sessionId,
              assistant_panel: true,
            },
          });
          await appendAssistantThreadMessage({
            supabase,
            companyId,
            userId: actor.id,
            threadId,
            role: "assistant",
            content: result.answer,
            metadata: {
              intent: result.intent?.name || null,
              mode: result.mode || null,
              source_hints: result.sourceHints || [],
              tool_activity: result.toolActivity || [],
              actions: buildActionButtons({
                intentName: result.intent?.name || null,
                requestMessage: requestMessage || "",
                navigationActions: result.navigationActions || [],
              }),
              tool_calls: result.toolCalls || [],
              navigation_actions: result.navigationActions || [],
              answer_source: result.answerSource,
              grounded: result.grounded,
              llm: result.model.llm,
              session_id: sessionId,
              assistant_panel: true,
            },
          });
          if ((thread.title || "").trim() === "Новый чат") {
            await updateAssistantThreadTitle({
              supabase,
              companyId,
              userId: actor.id,
              threadId,
              title: generateThreadTitle(requestMessage),
            });
          }
        }
      } catch (error) {
        threadPersistenceError = error instanceof Error ? error.message : "Thread persistence failed";
      }
    }

    const debugAllowed = isDebugAllowed(actor.role);
    const debug = debugAllowed
      ? buildDebugMetadata({
          role: actor.role,
          actorId: actor.id,
          authUserId: actor.authUserId,
          companyId,
          companyName,
          settings,
          runtimeContext: payload?.runtimeContext || null,
          requestMessage: requestMessage || "",
          sessionId,
          threadId,
          result,
          navigationActions: result.navigationActions || [],
          latencyMs: Date.now() - startedAt,
          actor: {
            contextCompanyId: actor.contextCompanyId,
            homeCompanyId: actor.homeCompanyId,
          },
          threadPersistenceError,
        })
      : undefined;

    if (shouldWriteAuditLog) {
      await writeAssistantAuditLog(supabase, {
        actor_user_id: actor.id,
        company_id: companyId,
        role: actor.role,
        chat_id: threadId || chatId,
        session_id: sessionId,
        intent: result.intent.name,
        tool_calls: result.toolCalls.map((toolCall) => ({
          tool: toolCall.tool,
          ok: toolCall.ok,
          rows: toolCall.rows || 0,
          error: toolCall.error || null,
        })),
        runtime_context: payload?.runtimeContext || {},
        request_excerpt: requestMessage,
        response_excerpt: result.answer,
        error_text: threadPersistenceError,
      });
    }

    return NextResponse.json({
      response: result.answer,
      sessionState: result.sessionState,
      threadId,
      navigationActions: result.navigationActions || [],
      actions: buildActionButtons({
        intentName: result.intent?.name || null,
        requestMessage: requestMessage || "",
        navigationActions: result.navigationActions || [],
      }),
      toolActivity: result.toolActivity || [],
      meta: {
        intent: result.intent,
        mode: result.mode,
        sourceHints: result.sourceHints,
        llm: result.model.llm,
      },
      ...(debug ? { debug } : {}),
    });
  } catch (error) {
    const supabase = getServiceClient();
    if (actorId && companyId && shouldWriteAuditLog) {
      await writeAssistantAuditLog(supabase, {
        actor_user_id: actorId,
        company_id: companyId,
        role,
        chat_id: threadId || chatId,
        session_id: sessionId,
        intent: "error",
        tool_calls: [],
        runtime_context: {},
        request_excerpt: requestMessage,
        response_excerpt: null,
        error_text: error instanceof Error ? error.message : "Assistant query failed",
      });
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
      },
      { status: 500 }
    );
  }
}
