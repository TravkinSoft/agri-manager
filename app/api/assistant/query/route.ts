import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { runAssistantEngine } from "@/lib/assistant/engine/query";
import { writeAssistantAuditLog } from "@/lib/assistant/audit-log";
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
  if (role === "global_admin") return true;
  return process.env.NEXT_PUBLIC_ASSISTANT_DEBUG === "1" || process.env.ASSISTANT_DEBUG === "1";
}

function detectModelSettingsSource(settingsModel: string | null): AssistantDebugSettingsSource {
  const configured = asString(settingsModel);
  const envModel = asString(process.env.OPENAI_ASSISTANT_MODEL);
  if (configured && envModel && configured === envModel) return "env";
  if (!configured || configured === "gpt-4.1-mini") return "default";
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
  result: AssistantEngineResult;
  navigationActions: AssistantNavigationAction[];
  latencyMs: number;
  actor: {
    contextCompanyId: string | null;
    homeCompanyId: string | null;
  };
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
    result,
    navigationActions,
    latencyMs,
    actor,
  } =
    params;
  const runtime = (runtimeContext || {}) as Record<string, unknown>;
  const runtimeFilters = runtime.filters;
  const runtimeSelectedRows = Array.isArray(runtime.selectedRows) ? runtime.selectedRows : [];
  const lastToolError = result.toolCalls.find((tool) => !tool.ok && tool.error)?.error || null;
  const warnings: string[] = [];
  if (looksLikeErpDataQuestion(requestMessage) && result.answerSource === "llm_fallback") {
    warnings.push("Внимание: ответ по ERP-данным был без tool grounding.");
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
    },
    access: {
      role: asString(role),
      authUserId: asString(authUserId),
      profileId: asString(actorId),
      companyId: asString(companyId),
      companyName: asString(companyName),
      companyContextSource: resolveCompanyContextSource(role, actor),
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
      grounded: result.grounded,
      answerSource: result.answerSource,
      navigationIntentDetected: result.intent.name === "navigation_help",
      navigationActionCreated: navigationActions.length > 0,
      navigationActionExecuted: null,
      targetRoute: navigationActions[0]?.route || null,
      routerError: null,
      toolCount: result.toolCalls.length,
      usedTools: result.toolCalls.map((toolCall) => ({
        tool: toolCall.tool,
        ok: toolCall.ok,
        rows: Number.isFinite(Number(toolCall.rows)) ? Number(toolCall.rows) : 0,
        error: asString(toolCall.error),
      })),
      lastToolError: asString(lastToolError),
    },
    memory: {
      sessionId: asString(sessionId),
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
  let sessionId: string | null = null;
  let requestMessage: string | null = null;
  let shouldWriteAuditLog = true;
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
        chatId,
        chatHistory: Array.isArray(payload?.chatHistory) ? payload.chatHistory : [],
        runtimeContext: payload?.runtimeContext || null,
        sessionState: payload?.sessionState || null,
      },
    });

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
          result,
          navigationActions: result.navigationActions || [],
          latencyMs: Date.now() - startedAt,
          actor: {
            contextCompanyId: actor.contextCompanyId,
            homeCompanyId: actor.homeCompanyId,
          },
        })
      : undefined;

    if (shouldWriteAuditLog) {
      await writeAssistantAuditLog(supabase, {
        actor_user_id: actor.id,
        company_id: companyId,
        role: actor.role,
        chat_id: chatId,
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
        error_text: null,
      });
    }

    return NextResponse.json({
      response: result.answer,
      sessionState: result.sessionState,
      navigationActions: result.navigationActions || [],
      meta: {
        intent: result.intent,
        sourceHints: result.sourceHints,
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
        chat_id: chatId,
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
