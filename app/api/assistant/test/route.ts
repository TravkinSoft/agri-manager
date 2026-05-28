import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { runAssistantEngine } from "@/lib/assistant/engine/query";
import { resolveAssistantModelConfig } from "@/lib/assistant/openai";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { AssistantEngineResult } from "@/lib/assistant/engine/types";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

type TestResponse = {
  answer: string;
  session_state: AssistantEngineResult["sessionState"];
  metadata: {
    requested_model: string;
    actual_model_used: string | null;
    config_source: "db" | "env" | "default";
    prompt_version: string;
    prompt_source: "code_default" | "db_override" | "env_override";
    prompt_updated_at: string;
    temperature_used: number;
    reasoning_effort: "low" | "medium" | "high";
    tools_enabled_count: number;
    tools_allowed: string[];
    mode: "erp_data" | "agro_knowledge" | "mixed" | "navigation";
    latency_ms: number;
    token_usage: {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
    };
    intent: string | null;
    answer_source: string;
    llm: {
      status: string;
      http_status: number | null;
      error_code: string | null;
      error_message: string | null;
      missing_env: string[];
    };
    test_mode: "read_only";
    navigation_disabled: boolean;
  };
  tool_activity: string[];
  tool_calls: AssistantEngineResult["toolCalls"];
  debug?: {
    status_code: number;
    error_source: string;
    error_message: string;
    requested_model: string | null;
    config_source: "db" | "env" | "default" | "fallback";
  };
};

function asText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function requireGlobalAdmin(role: string | null | undefined) {
  if (role !== "global_admin") {
    throw new SessionAuthError("Assistant test is available only for global_admin", 403);
  }
}

function toReadOnlyTestSettings(settings: AssistantPlatformSettings): AssistantPlatformSettings {
  const blockedTools = new Set(["navigate_to_page", "open_entity", "apply_filter"]);
  const safeTools = (settings.allowedTools || []).filter(
    (tool) => !blockedTools.has(tool) && !tool.startsWith("create_")
  );

  return {
    ...settings,
    // Keep assistant enabled in test panel even if production toggle is off,
    // so admin can diagnose model/config issues from this page.
    enabled: true,
    allowedTools: safeTools,
  };
}

function buildDisabledNavigationAnswer(): string {
  return "Навигация отключена в тестовом режиме. Команда распознана, но переходы по страницам и действия в системе здесь не выполняются.";
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const actor = await getServerActorFromSession(request);
    requireGlobalAdmin(actor.role);

    const payload = await request.json().catch(() => ({}));
    const message = asText(payload?.message);
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const companyId = resolveCompanyForActor(actor, asText(payload?.companyId));
    const supabase = getServiceClient();
    const settings = await getAssistantPlatformSettings(supabase, actor.id);
    const testSettings = toReadOnlyTestSettings(settings);

    const modelConfig = resolveAssistantModelConfig(testSettings, { message, intentName: null });
    const result = await runAssistantEngine({
      supabase,
      actor,
      companyId,
      settings: testSettings,
      input: {
        message,
        locale: payload?.locale === "en" || payload?.locale === "kz" ? payload.locale : "ru",
        runtimeContext: {
          currentPage: "assistant-settings-test",
          currentRoute: "/platform/assistant/settings",
          ...(payload?.runtimeContext && typeof payload.runtimeContext === "object" ? payload.runtimeContext : {}),
        },
        sessionState: payload?.sessionState || null,
        chatHistory: Array.isArray(payload?.chatHistory) ? payload.chatHistory : [],
      },
    });

    const latencyMs = Date.now() - startedAt;
    const navigationIntent = result.intent?.name === "navigation_help";
    const answer = navigationIntent ? buildDisabledNavigationAnswer() : result.answer;

    const response: TestResponse = {
      answer,
      session_state: result.sessionState,
      metadata: {
        requested_model: modelConfig.configuredModel,
        actual_model_used: result.model.actualModel,
        config_source: result.model.settingsSource,
        prompt_version: result.model.promptVersion,
        prompt_source: result.model.promptSource,
        prompt_updated_at: result.model.promptUpdatedAt,
        temperature_used: modelConfig.temperature,
        reasoning_effort: modelConfig.reasoningEffort,
        tools_enabled_count: testSettings.allowedTools.length,
        tools_allowed: testSettings.allowedTools,
        mode: result.mode,
        latency_ms: latencyMs,
        token_usage: {
          prompt_tokens: result.performance.promptTokens,
          completion_tokens: result.performance.completionTokens,
          total_tokens: result.performance.totalTokens,
        },
        intent: result.intent?.name || null,
        answer_source: result.answerSource,
        llm: {
          status: result.model.llm.status,
          http_status: result.model.llm.httpStatus,
          error_code: result.model.llm.errorCode,
          error_message: result.model.llm.errorMessage,
          missing_env: result.model.llm.missingEnv || [],
        },
        test_mode: "read_only",
        navigation_disabled: true,
      },
      tool_activity: result.toolActivity,
      tool_calls: result.toolCalls,
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json(
        {
          error: error.message,
          debug: {
            status_code: error.status,
            error_source: "auth",
            error_message: error.message,
            requested_model: null,
            config_source: "fallback",
          },
        },
        { status: error.status }
      );
    }

    const message = error instanceof Error ? error.message : "Failed to run assistant test";
    return NextResponse.json(
      {
        error: message,
        debug: {
          status_code: 500,
          error_source: "server",
          error_message: message,
          requested_model: null,
          config_source: "fallback",
        },
      },
      { status: 500 }
    );
  }
}
