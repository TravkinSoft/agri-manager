import type { AssistantEngineResult, AssistantIntentName, AssistantToolName } from "@/lib/assistant/engine/types";
import type { AssistantRuntimeMode } from "@/lib/assistant/v2/runtime-mode";

export const READ_ONLY_MODEL_TOOL_NAMES = [
  "get_current_context",
  "search_fields",
  "get_field_card",
  "get_field_land_bank_summary",
  "get_field_materials",
  "get_warehouse_stock",
  "get_crop_structure_summary",
  "get_active_operations_summary",
] as const satisfies readonly AssistantToolName[];

export type ReadOnlyModelToolName = (typeof READ_ONLY_MODEL_TOOL_NAMES)[number];

export type ReadOnlyThreadState = {
  threadId: string;
  selectedFieldId: string | null;
  selectedFieldLabel: string | null;
  selectedWarehouseId: string | null;
  selectedOperationId: string | null;
  selectedCropStructureLineId: string | null;
  lastIntent: AssistantIntentName | null;
  lastSuccessfulTool: ReadOnlyModelToolName | null;
  unresolvedQuestion: string | null;
};
export type ReadOnlyHistoryMessage = {
  role?: unknown;
  content?: unknown;
};

export type ReadOnlyRuntimeDiagnostics = {
  requestedModel: string;
  effectiveModel: string | null;
  effectiveReasoning: "unsupported" | "low" | "medium" | "high";
  requestedReasoning: "low" | "medium" | "high";
  effectiveTemperature: number | null;
  temperatureSupported: boolean;
  historyMessageCount: number;
  conversationMessageCount: number;
  modelInputMessageCount: number;
  availableTools: ReadOnlyModelToolName[];
  modelToolsEnabled: boolean;
  requestPolicyDecision: "model_with_tools" | "model_without_tools" | "clarify_material" | "deny_write" | "deny_foreign_company";
  blockedToolName: string | null;
  singleModelPath: true;
  runtimeMode: AssistantRuntimeMode;
  historyTruncated: boolean;
  meaningfulHistoryCount: number;
  stablePromptPrefixHash: string;
  dynamicContextChars: number;
  cachedInputTokens: number | null;
  openAiRequestId: string | null;
  openAiEndpoint: "/v1/chat/completions" | "/v1/responses";
};

export type ReadOnlyAssistantV1Result = AssistantEngineResult & {
  threadState: ReadOnlyThreadState;
  runtimeDiagnostics: ReadOnlyRuntimeDiagnostics;
};
