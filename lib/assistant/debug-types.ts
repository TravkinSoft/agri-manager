export type AssistantDebugSettingsSource = "db" | "env" | "default" | "legacy" | "unknown";

export type AssistantDebugAnswerSource =
  | "tools"
  | "llm_fallback"
  | "policy_block"
  | "disabled"
  | "access_denied"
  | "no_data"
  | "tool_error"
  | "fast_path_template"
  | "model_grounded"
  | "legacy_fallback"
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
    currentModule?: string | null;
    selectedFieldId?: string | null;
    selectedFieldLabel?: string | null;
    selectedWarehouseId?: string | null;
    selectedWarehouseLabel?: string | null;
    selectedCropStructureSectionId?: string | null;
    selectedCropStructureSectionLabel?: string | null;
    selectedOperationId?: string | null;
    selectedOperationLabel?: string | null;
    selectedTicketId?: string | null;
    selectedTicketLabel?: string | null;
    selectedBatchId?: string | null;
    selectedBatchLabel?: string | null;
    selectedRowsCount: number;
    activeFiltersCount: number;
    season: string | null;
    locale: string | null;
  };
  engine: {
    endpoint: string;
    engineVersion: string;
    intent: string | null;
    expectedAnswerType: string | null;
    selectedSource: string | null;
    selectedTool: string | null;
    fallbackSource: string | null;
    mode: string | null;
    grounded: boolean | null;
    answerSource: AssistantDebugAnswerSource;
    decisionSource?: "fast_path" | "router" | "model" | "memory_followup" | null;
    explicitNavigationRequested?: boolean;
    navigationPolicy?: "allowed" | "blocked" | "not_applicable" | null;
    consistencyCheck: "pass" | "fail" | "skipped";
    contradictionDetected: boolean;
    correctionApplied: boolean;
    previousRelatedMemory: string | null;
    navigationIntentDetected: boolean;
    navigationActionCreated: boolean;
    navigationActionExecuted: boolean | null;
    navigationActionType: string | null;
    navigationEntityType: string | null;
    navigationEntityId: string | null;
    navigationFilters: Record<string, string> | null;
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
    lastOperation?: string | null;
    lastTicket?: string | null;
    lastCropStructureSection?: string | null;
    lastBatch?: string | null;
    lastIntent: string | null;
    focusEntityType?: string | null;
    focusEntityId?: string | null;
    focusEntityLabel?: string | null;
    focusModule?: string | null;
    focusRoute?: string | null;
    focusSource?: string | null;
    pendingActionType?: string | null;
    pendingActionSummary?: string | null;
    pendingActionRoute?: string | null;
    lastActionType?: string | null;
    lastActionSummary?: string | null;
    longTermMemoryCount?: number | null;
    longTermMemoryLatestAt?: string | null;
    longTermMemoryWarning?: string | null;
    memorySavedCount?: number | null;
    memoryWriteSkippedReason?: string | null;
    memoryWriteWarning?: string | null;
    followUpActive: boolean;
  };
  performance: {
    score: number | null;
    latencyMs: number | null;
    routerMs: number | null;
    plannerMs: number | null;
    toolMs: number | null;
    validatorMs: number | null;
    modelMs: number | null;
    responseRenderMs: number | null;
    memoryReadMs?: number | null;
    memoryWriteMs?: number | null;
    totalMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  trust?: {
    score: number;
    sourceOfTruth: number;
    contextMemory: number;
    followUp: number;
    navigation: number;
    knowledge: number;
    analytics: number;
    notes: string[];
  };
  warnings: string[];
};
