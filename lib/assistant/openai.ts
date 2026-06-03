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
  routeTier: "default" | "heavy";
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

function shouldUseHeavyModel(params: {
  intentName?: AssistantIntentName | null;
  message?: string | null;
  forceHeavyModel?: boolean;
}): boolean {
  if (params.forceHeavyModel) return true;
  const intentName = params.intentName || null;
  const text = String(params.message || "").toLowerCase();
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
  options?: { intentName?: AssistantIntentName | null; message?: string | null; forceHeavyModel?: boolean }
): AssistantResolvedModelConfig {
  const envDefaultModel = asText(process.env.OPENAI_ASSISTANT_MODEL);
  const defaultModel = envDefaultModel || ASSISTANT_DEFAULT_MODEL;
  const heavyModel = asText(process.env.OPENAI_ASSISTANT_HEAVY_MODEL) || ASSISTANT_HEAVY_MODEL;
  const dbModel = asText(settings.model);
  const useHeavy = shouldUseHeavyModel({
    intentName: options?.intentName || null,
    message: options?.message || null,
    forceHeavyModel: Boolean(options?.forceHeavyModel),
  });

  const routedModel = useHeavy ? heavyModel : defaultModel;
  const actualModel = options?.forceHeavyModel ? heavyModel : dbModel || routedModel;
  const settingsSource: AssistantSettingsSource = options?.forceHeavyModel
    ? asText(process.env.OPENAI_ASSISTANT_HEAVY_MODEL)
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
    configuredModel: options?.forceHeavyModel ? heavyModel : dbModel || routedModel,
    actualModel,
    settingsSource,
    temperature: asTemperature(settings.temperature, 0.2),
    reasoningEffort,
    reasoningApplied,
    routeTier: useHeavy ? "heavy" : "default",
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
