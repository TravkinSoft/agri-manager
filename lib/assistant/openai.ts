import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { AssistantIntentName } from "@/lib/assistant/engine/types";

export type AssistantSettingsSource = "db" | "env" | "default";

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

function shouldUseHeavyModel(params: {
  intentName?: AssistantIntentName | null;
  message?: string | null;
}): boolean {
  const intentName = params.intentName || null;
  const text = String(params.message || "").toLowerCase();
  if (intentName === "general_question" || intentName === "create_draft") {
    if (/(болез|disease|архитект|architecture|анализ|analytics|diagnos|рекоменд|оптимиз|strategy|стратег)/.test(text)) {
      return true;
    }
  }
  return false;
}

export function resolveAssistantModelConfig(
  settings: AssistantPlatformSettings,
  options?: { intentName?: AssistantIntentName | null; message?: string | null }
): AssistantResolvedModelConfig {
  const defaultModel = asText(process.env.OPENAI_ASSISTANT_MODEL) || "gpt-5.4-mini";
  const heavyModel = asText(process.env.OPENAI_ASSISTANT_HEAVY_MODEL) || "gpt-5.5";
  const dbModel = asText(settings.model);
  const useHeavy = shouldUseHeavyModel({
    intentName: options?.intentName || null,
    message: options?.message || null,
  });

  const routedModel = useHeavy ? heavyModel : defaultModel;
  const actualModel = dbModel || routedModel;
  const settingsSource: AssistantSettingsSource = dbModel ? "db" : "env";

  const reasoningEffort: "low" | "medium" | "high" =
    settings.reasoningEffort === "low" || settings.reasoningEffort === "high" ? settings.reasoningEffort : "medium";

  // Chat Completions in current wiring does not consume a reasoning parameter yet.
  const reasoningApplied = false;

  return {
    provider: "openai",
    configuredModel: dbModel || routedModel,
    actualModel,
    settingsSource,
    temperature: asTemperature(settings.temperature, 0.2),
    reasoningEffort,
    reasoningApplied,
    routeTier: useHeavy ? "heavy" : "default",
  };
}
