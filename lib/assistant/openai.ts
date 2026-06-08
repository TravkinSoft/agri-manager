import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { AssistantIntentName } from "@/lib/assistant/engine/types";
import { isAgroKnowledgeQuestion } from "@/lib/assistant/agro-taxonomy";

export type AssistantSettingsSource = "db" | "env" | "default";
export const ASSISTANT_DEFAULT_MODEL = "gpt-5.4-mini";
export const ASSISTANT_HEAVY_MODEL = "gpt-5.5";
export const ASSISTANT_RUNTIME_FALLBACK_MODELS = [ASSISTANT_DEFAULT_MODEL, ASSISTANT_HEAVY_MODEL] as const;

export type AssistantResolvedModelConfig = {
  provider: "openai";
  configuredModel: string;
  actualModel: string;
  settingsSource: AssistantSettingsSource;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high";
  reasoningApplied: boolean;
  routeTier: "default" | "fast" | "heavy";
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asTemperature(value: unknown, fallback = 0.2): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => asText(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function assistantModelSupportsCustomTemperature(model: string | null | undefined): boolean {
  const normalized = asText(model).toLowerCase();
  if (!normalized) return true;
  return !normalized.startsWith("gpt-5.5");
}

export function buildOpenAiChatCompletionBody(params: {
  model: string;
  temperature: number;
  messages: unknown[];
  tools?: unknown[];
  toolChoice?: "auto" | "none";
  maxCompletionTokens?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  };
  if (assistantModelSupportsCustomTemperature(params.model)) {
    body.temperature = params.temperature;
  }
  if (params.tools?.length) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice || "auto";
  }
  if (typeof params.maxCompletionTokens === "number") {
    body.max_completion_tokens = params.maxCompletionTokens;
  }
  return body;
}

function shouldUseHeavyModel(params: {
  intentName?: AssistantIntentName | null;
  message?: string | null;
  forceHeavyModel?: boolean;
}): boolean {
  if (params.forceHeavyModel) return true;
  const intentName = params.intentName || null;
  const text = String(params.message || "").toLowerCase();
  if (
    /(\u0447\u0442\u043e\s+\u0442\u0430\u043a\u043e\u0435|\u043a\u0430\u043a\s+\u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442|\u043e\u0431\u044a\u044f\u0441\u043d|\u043f\u0440\u043e\u0446\u0435\u0441\u0441|\u043a\u0430\u043a\s+\u043e\u0440\u0433\u0430\u043d|\u0444\u0438\u0442\u043e\u0444\u0442\u043e\u0440|\u0440\u0438\u0441\u043a|\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434|\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0446|what\s+is|how\s+does|explain|process|risk|recommend)/i.test(text)
  ) {
    return true;
  }
  if (isAgroKnowledgeQuestion(text)) return true;
  if (
    /(болез|disease|архитект|architecture|анализ|analytics|diagnos|рекоменд|оптимиз|strategy|стратег|риски|risk|прогноз|yield|урожайн|фитофтор|как работает|объясни|процесс|что такое|термос|весов|склад|репродукц)/.test(
      text
    )
  ) {
    return true;
  }
  if (intentName === "general_question" || intentName === "create_draft") {
    if (/(план\/факт|plan.?fact|mixed|compare|сравни|перерасход|deviation)/.test(text)) return true;
  }
  return false;
}

export function resolveAssistantModelConfig(
  settings: AssistantPlatformSettings,
  options?: {
    intentName?: AssistantIntentName | null;
    message?: string | null;
    forceFastModel?: boolean;
    forceHeavyModel?: boolean;
  }
): AssistantResolvedModelConfig {
  const envDefaultModel = asText(process.env.OPENAI_ASSISTANT_MODEL);
  const defaultModel = envDefaultModel || ASSISTANT_DEFAULT_MODEL;
  const fastModel =
    asText(process.env.OPENAI_ASSISTANT_FAST_MODEL) ||
    asText(process.env.OPENAI_ASSISTANT_FALLBACK_MODEL) ||
    ASSISTANT_DEFAULT_MODEL;
  const heavyModel = asText(process.env.OPENAI_ASSISTANT_HEAVY_MODEL) || ASSISTANT_HEAVY_MODEL;
  const dbModel = asText(settings.model);
  const useHeavy = shouldUseHeavyModel({
    intentName: options?.intentName || null,
    message: options?.message || null,
    forceHeavyModel: Boolean(options?.forceHeavyModel),
  });

  const routedModel = useHeavy ? heavyModel : defaultModel;
  const actualModel = options?.forceHeavyModel
    ? heavyModel
    : options?.forceFastModel
      ? fastModel
      : dbModel || routedModel;
  const settingsSource: AssistantSettingsSource = options?.forceHeavyModel
    ? asText(process.env.OPENAI_ASSISTANT_HEAVY_MODEL)
      ? "env"
      : "default"
    : options?.forceFastModel
      ? asText(process.env.OPENAI_ASSISTANT_FAST_MODEL) || asText(process.env.OPENAI_ASSISTANT_FALLBACK_MODEL)
        ? "env"
        : "default"
    : dbModel
      ? "db"
      : envDefaultModel
        ? "env"
        : "default";

  const reasoningEffort: "low" | "medium" | "high" =
    settings.reasoningEffort === "low" || settings.reasoningEffort === "high" ? settings.reasoningEffort : "medium";

  // Chat Completions in current wiring does not consume a reasoning parameter yet.
  const reasoningApplied = false;

  return {
    provider: "openai",
    configuredModel: options?.forceHeavyModel
      ? heavyModel
      : options?.forceFastModel
        ? fastModel
        : dbModel || routedModel,
    actualModel,
    settingsSource,
    temperature: asTemperature(settings.temperature, 0.2),
    reasoningEffort,
    reasoningApplied,
    routeTier: options?.forceFastModel ? "fast" : useHeavy ? "heavy" : "default",
  };
}

export function buildAssistantModelCandidateList(requestedModel: string | null | undefined): string[] {
  return uniqueNonEmpty([
    requestedModel,
    asText(process.env.OPENAI_ASSISTANT_MODEL) || ASSISTANT_DEFAULT_MODEL,
    asText(process.env.OPENAI_ASSISTANT_HEAVY_MODEL) || ASSISTANT_HEAVY_MODEL,
    asText(process.env.OPENAI_ASSISTANT_FALLBACK_MODEL),
    ...ASSISTANT_RUNTIME_FALLBACK_MODELS,
  ]);
}
