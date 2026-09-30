import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import {
  assistantModelSupportsCustomTemperature,
  buildAssistantModelCandidateList,
  buildOpenAiChatCompletionBody,
  resolveAssistantModelConfig,
} from "@/lib/assistant/openai";
import { resolveTravkinCorePrompt } from "@/lib/assistant/prompts/travkin-core-prompt";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export const runtime = "nodejs";

function requireGlobalAdmin(role: string | null | undefined) {
  if (role !== "global_admin") {
    throw new SessionAuthError("Assistant settings are available only for global_admin", 403);
  }
}

function extractOpenAiError(payload: any, status: number | null): string {
  const message = String(payload?.error?.message || payload?.error?.type || "").trim();
  if (message) return message;
  return status ? `HTTP ${status}` : "Unknown OpenAI error";
}

function isModelUnavailableError(payload: any): boolean {
  const errorCode = String(payload?.error?.code || "").trim().toLowerCase();
  const errorMessage = String(payload?.error?.message || "").trim().toLowerCase();
  return (
    errorCode === "model_not_found" ||
    errorMessage.includes("does not exist") ||
    errorMessage.includes("not found") ||
    errorMessage.includes("not available") ||
    errorMessage.includes("do not have access") ||
    errorMessage.includes("not have access") ||
    errorMessage.includes("model not found")
  );
}

type ModelCatalogResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
  models: string[];
};

async function fetchOpenAiModels(apiKey: string | null): Promise<ModelCatalogResult> {
  if (!apiKey) {
    return {
      ok: false,
      status: null,
      error: "OPENAI_API_KEY is not configured",
      models: [],
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: extractOpenAiError(payload, response.status),
        models: [],
      };
    }

    const models = Array.isArray((payload as any)?.data)
      ? (payload as any).data
          .map((entry: any) => String(entry?.id || "").trim())
          .filter((id: string) => Boolean(id))
      : [];

    return {
      ok: true,
      status: response.status,
      error: null,
      models,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Network error while fetching model list",
      models: [],
    };
  }
}

type ModelPingResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
  actualModel: string | null;
  attemptedModel: string | null;
  fallbackModel: string | null;
  fallbackReason: string | null;
};

async function runModelPing(params: {
  requestedModel: string;
  candidateModels: string[];
  temperature: number;
  apiKey: string | null;
}): Promise<ModelPingResult> {
  const { requestedModel, candidateModels, temperature, apiKey } = params;
  if (!apiKey) {
    return {
      ok: false,
      status: null,
      error: "OPENAI_API_KEY is not configured",
      actualModel: null,
      attemptedModel: null,
      fallbackModel: null,
      fallbackReason: null,
    };
  }

  let lastError: string | null = null;

  for (const candidateModel of candidateModels) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          buildOpenAiChatCompletionBody({
            model: candidateModel,
            temperature,
            maxCompletionTokens: 8,
            messages: [
              { role: "system", content: "You are a health-check assistant." },
              { role: "user", content: "ping" },
            ],
          })
        ),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorText = extractOpenAiError(payload, response.status);
        lastError = errorText;

        if (isModelUnavailableError(payload)) {
          continue;
        }

        return {
          ok: false,
          status: response.status,
          error: errorText,
          actualModel: null,
          attemptedModel: candidateModel,
          fallbackModel: null,
          fallbackReason: null,
        };
      }

      const actualModel = String((payload as any)?.model || "").trim() || candidateModel;
      const usedFallback = candidateModel !== requestedModel;

      return {
        ok: true,
        status: response.status,
        error: null,
        actualModel,
        attemptedModel: candidateModel,
        fallbackModel: usedFallback ? candidateModel : null,
        fallbackReason: usedFallback
          ? lastError || `Requested model '${requestedModel}' is unavailable for this account.`
          : null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Network error while pinging OpenAI";
    }
  }

  return {
    ok: false,
    status: null,
    error: lastError || "Model ping failed for all candidate models",
    actualModel: null,
    attemptedModel: null,
    fallbackModel: null,
    fallbackReason: null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    requireGlobalAdmin(actor.role);

    const supabase = getServiceClient();
    const settings = await getAssistantPlatformSettings(supabase, actor.id);
    const modelConfig = resolveAssistantModelConfig(settings, { intentName: "general_question", message: "health check" });
    const promptBundle = resolveTravkinCorePrompt({
      settings,
      runtimeContext: {
        currentPage: "assistant-settings",
        currentRoute: "/platform/assistant/settings",
        season: "2026",
      },
      actorRole: actor.role,
      locale: "ru",
    });

    const apiKey = process.env.OPENAI_API_KEY || null;
    const modelCatalog = await fetchOpenAiModels(apiKey);
    const candidateModels = buildAssistantModelCandidateList(modelConfig.actualModel);
    const ping = await runModelPing({
      requestedModel: modelConfig.actualModel,
      candidateModels,
      temperature: modelConfig.temperature,
      apiKey,
    });

    const requestedModel = modelConfig.configuredModel;
    const actualModelUsed = ping.actualModel || ping.fallbackModel || null;
    const requestedAvailable =
      modelCatalog.ok && requestedModel
        ? modelCatalog.models.includes(requestedModel)
        : null;

    const configSource = modelConfig.settingsSource;
    const configWarnings: string[] = [];
    if (configSource !== "db") {
      configWarnings.push("Some runtime parameters are using ENV/default fallback. Save settings in DB to control them from UI.");
    }
    if (!apiKey) {
      configWarnings.push("OPENAI_API_KEY is missing in backend environment.");
    }
    if (!ping.ok) {
      configWarnings.push("Model ping failed.");
    }
    if (requestedAvailable === false) {
      configWarnings.push(`Requested model '${requestedModel}' is not in the accessible model list for this API key.`);
    }
    if (ping.fallbackModel) {
      configWarnings.push(`Fallback model was used: ${ping.fallbackModel}.`);
    }

    return NextResponse.json({
      runtime: {
        provider: "openai",
        model: requestedModel,
        actualModel: actualModelUsed,
        modelCandidates: candidateModels,
        fallbackModel: ping.fallbackModel,
        fallbackReason: ping.fallbackReason,
        temperature: modelConfig.temperature,
        temperatureApplied: assistantModelSupportsCustomTemperature(actualModelUsed || modelConfig.actualModel),
        reasoningEffort: modelConfig.reasoningEffort,
        enabledTools: settings.allowedTools || [],
      },
      model: {
        requested_model: requestedModel,
        actual_model_used: actualModelUsed,
        fallback_model: ping.fallbackModel,
        fallback_reason: ping.fallbackReason,
        requested_model_accessible: requestedAvailable,
        config_source: configSource,
        prompt_version: promptBundle.version,
        prompt_source: promptBundle.source,
        prompt_updated_at: promptBundle.updatedAt,
        temperature_used: modelConfig.temperature,
        temperature_applied: assistantModelSupportsCustomTemperature(actualModelUsed || modelConfig.actualModel),
        reasoning_effort: modelConfig.reasoningEffort,
        route_tier: modelConfig.routeTier,
      },
      checks: {
        openai_api_key_present: Boolean(apiKey),
        backend_key_visible: Boolean(apiKey),
        database_settings_ok: true,
        tools_enabled_count: (settings.allowedTools || []).length,
        model_list_ok: modelCatalog.ok,
        model_list_status: modelCatalog.status,
        model_list_error: modelCatalog.error,
        model_ping_ok: ping.ok,
        model_ping_status: ping.status,
        model_ping_error: ping.error,
      },
      binding: {
        provider: "used",
        model: "used",
        temperature: assistantModelSupportsCustomTemperature(actualModelUsed || modelConfig.actualModel) ? "used" : "omitted_default_only",
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
          ? "reasoningEffort is applied in runtime."
          : "reasoningEffort is stored and reserved for future model wiring.",
      ],
      debug: {
        requested_model: requestedModel,
        candidate_models: candidateModels,
        model_catalog_count: modelCatalog.models.length,
        matched_account_models: modelCatalog.models.filter((model) => model.startsWith("gpt-5.")),
        ping_attempted_model: ping.attemptedModel,
      },
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
