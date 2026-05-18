import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";

export type AssistantSettingsSource = "db" | "env" | "default";

export type AssistantResolvedModelConfig = {
  provider: "openai";
  configuredModel: string;
  actualModel: string;
  settingsSource: AssistantSettingsSource;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high";
  reasoningApplied: boolean;
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asTemperature(value: unknown, fallback = 0.2): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function resolveAssistantModelConfig(settings: AssistantPlatformSettings): AssistantResolvedModelConfig {
  const fallbackModel = "gpt-4.1-mini";
  const envModel = asText(process.env.OPENAI_ASSISTANT_MODEL);
  const dbModel = asText(settings.model);

  const actualModel = dbModel || envModel || fallbackModel;
  const settingsSource: AssistantSettingsSource = dbModel ? "db" : envModel ? "env" : "default";

  const reasoningEffort: "low" | "medium" | "high" =
    settings.reasoningEffort === "low" || settings.reasoningEffort === "high" ? settings.reasoningEffort : "medium";

  // Chat Completions in current wiring does not consume a reasoning parameter yet.
  const reasoningApplied = false;

  return {
    provider: "openai",
    configuredModel: actualModel,
    actualModel,
    settingsSource,
    temperature: asTemperature(settings.temperature, 0.2),
    reasoningEffort,
    reasoningApplied,
  };
}
