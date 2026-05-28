import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { resolveAssistantModelConfig } from "@/lib/assistant/openai";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export const runtime = "nodejs";

function requireGlobalAdmin(role: string | null | undefined) {
  if (role !== "global_admin") {
    throw new SessionAuthError("Assistant settings are available only for global_admin", 403);
  }
}

async function runModelPing(params: {
  model: string;
  temperature: number;
  apiKey: string | null;
}): Promise<{ ok: boolean; status: number | null; error: string | null; actualModel: string | null }> {
  const { model, temperature, apiKey } = params;
  if (!apiKey) {
    return {
      ok: false,
      status: null,
      error: "OPENAI_API_KEY is not configured",
      actualModel: null,
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 8,
        messages: [
          { role: "system", content: "You are a health-check assistant." },
          { role: "user", content: "ping" },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorText =
        String((data as any)?.error?.message || (data as any)?.error?.type || "").trim() ||
        `HTTP ${response.status}`;
      return {
        ok: false,
        status: response.status,
        error: errorText,
        actualModel: null,
      };
    }

    return {
      ok: true,
      status: response.status,
      error: null,
      actualModel: String((data as any)?.model || "").trim() || model,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Network error while pinging OpenAI",
      actualModel: null,
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    requireGlobalAdmin(actor.role);

    const supabase = getServiceClient();
    const settings = await getAssistantPlatformSettings(supabase, actor.id);
    const modelConfig = resolveAssistantModelConfig(settings, { intentName: "general_question", message: "health check" });

    const apiKey = process.env.OPENAI_API_KEY || null;
    const ping = await runModelPing({
      model: modelConfig.actualModel,
      temperature: modelConfig.temperature,
      apiKey,
    });

    const configSource = modelConfig.settingsSource;
    const configWarnings: string[] = [];
    if (configSource !== "db") {
      configWarnings.push("Часть runtime параметров берётся из ENV/fallback. Для изменения через UI сохраните настройки в БД.");
    }
    if (!apiKey) {
      configWarnings.push("OPENAI_API_KEY не найден в backend ENV.");
    }
    if (!ping.ok) {
      configWarnings.push("Проверка model ping не прошла.");
    }

    return NextResponse.json({
      runtime: {
        provider: "openai",
        model: modelConfig.configuredModel,
        actualModel: ping.actualModel || modelConfig.actualModel,
        temperature: modelConfig.temperature,
        reasoningEffort: modelConfig.reasoningEffort,
        enabledTools: settings.allowedTools || [],
      },
      model: {
        requested_model: modelConfig.configuredModel,
        actual_model_used: ping.actualModel || null,
        config_source: configSource,
        temperature_used: modelConfig.temperature,
        reasoning_effort: modelConfig.reasoningEffort,
        route_tier: modelConfig.routeTier,
      },
      checks: {
        openai_api_key_present: Boolean(apiKey),
        backend_key_visible: Boolean(apiKey),
        database_settings_ok: true,
        tools_enabled_count: (settings.allowedTools || []).length,
        model_ping_ok: ping.ok,
        model_ping_status: ping.status,
        model_ping_error: ping.error,
      },
      binding: {
        provider: "used",
        model: "used",
        temperature: "used",
        reasoningEffort: modelConfig.reasoningApplied ? "used" : "reserved",
        allowedRoles: "used",
        allowedTools: "used",
        forbiddenActions: "reserved",
        companyDataAccess: "reserved",
        actionConfirmation: "reserved",
      },
      notes: [
        ...configWarnings,
        modelConfig.reasoningApplied
          ? "reasoningEffort применяется runtime."
          : "reasoningEffort сохранён и зарезервирован для следующей версии model wiring.",
      ],
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to validate assistant settings" },
      { status: 500 }
    );
  }
}
