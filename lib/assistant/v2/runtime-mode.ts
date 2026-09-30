export const ASSISTANT_RUNTIME_MODES = ["chat_completions_legacy", "responses_v2"] as const;

export type AssistantRuntimeMode = (typeof ASSISTANT_RUNTIME_MODES)[number];

export function isAssistantRuntimeMode(value: unknown): value is AssistantRuntimeMode {
  return ASSISTANT_RUNTIME_MODES.includes(String(value || "") as AssistantRuntimeMode);
}

export function resolveAssistantRuntimeMode(params?: {
  configuredMode?: unknown;
  nodeEnv?: string | null;
}): AssistantRuntimeMode {
  const configured = params?.configuredMode ?? process.env.ASSISTANT_RUNTIME_MODE;
  if (isAssistantRuntimeMode(configured)) return configured;

  const nodeEnv = String(params?.nodeEnv ?? process.env.NODE_ENV ?? "development").toLowerCase();
  return nodeEnv === "production" ? "chat_completions_legacy" : "responses_v2";
}
