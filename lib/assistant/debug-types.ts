export type AssistantDebugSettingsSource = "db" | "env" | "default" | "legacy" | "unknown";

export type AssistantDebugAnswerSource =
  | "tools"
  | "llm_fallback"
  | "policy_block"
  | "disabled"
  | "access_denied"
  | "no_data"
  | "tool_error"
  | "unknown";

export type AssistantDebugToolLog = {
  tool: string;
  ok: boolean;
  rows: number;
  error: string | null;
  args?: Record<string, unknown> | null;
  resolvedSeason?: string | null;
  companyId?: string | null;
};

export type AssistantDebugMetadata = {
  generatedAt: string;
  model: {
    provider: string | null;
    configuredModel: string | null;
    actualModel: string | null;
    settingsSource: AssistantDebugSettingsSource;
    promptVersion: string | null;
    promptSource: "code_default" | "db_override" | "env_override" | null;
    promptUpdatedAt: string | null;
    temperature: number | null;
    reasoningEffort: string | null;
    requestMode: string | null;
    llmStatus:
      | "not_called"
      | "ok"
      | "missing_api_key"
      | "network_error"
      | "http_error"
      | "invalid_response";
    llmHttpStatus: number | null;
    llmErrorCode: string | null;
    llmErrorMessage: string | null;
    llmMissingEnv: string[];
  };
  access: {
    role: string | null;
    authUserId: string | null;
    profileId: string | null;
    companyId: string | null;
    companyName: string | null;
    companyContextSource: string | null;
    authStatus: "ok" | "error";
  };
  runtime: {
    currentPage: string | null;
    currentRoute: string | null;
    currentEntity: string | null;
    selectedRowsCount: number;
    activeFiltersCount: number;
    season: string | null;
    locale: string | null;
  };
  engine: {
    endpoint: string;
    engineVersion: string;
    intent: string | null;
    mode: string | null;
    grounded: boolean | null;
    answerSource: AssistantDebugAnswerSource;
    navigationIntentDetected: boolean;
    navigationActionCreated: boolean;
    navigationActionExecuted: boolean | null;
    navigationActionType: string | null;
    navigationEntityType: string | null;
    navigationEntityId: string | null;
    targetRoute: string | null;
    routerError: string | null;
    toolCount: number;
    usedTools: AssistantDebugToolLog[];
    lastToolError: string | null;
  };
  memory: {
    sessionId: string | null;
    lastCrop: string | null;
    lastVariety: string | null;
    lastWarehouse: string | null;
    lastField: string | null;
    lastIntent: string | null;
    followUpActive: boolean;
  };
  performance: {
    latencyMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  warnings: string[];
};
