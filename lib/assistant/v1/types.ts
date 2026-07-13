import type { AssistantEngineResult, AssistantIntentName, AssistantToolName } from "@/lib/assistant/engine/types";

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
  lastIntent: AssistantIntentName | null;
  unresolvedQuestion: string | null;
};
export type ReadOnlyHistoryMessage = {
  role?: unknown;
  content?: unknown;
};

export type ReadOnlyRuntimeDiagnostics = {
  requestedModel: string;
  effectiveModel: string | null;
  effectiveReasoning: "unsupported";
  requestedReasoning: "low" | "medium" | "high";
  effectiveTemperature: number | null;
  temperatureSupported: boolean;
  historyMessageCount: number;
  conversationMessageCount: number;
  modelInputMessageCount: number;
  availableTools: ReadOnlyModelToolName[];
  blockedToolName: string | null;
  singleModelPath: true;
};

export type ReadOnlyAssistantV1Result = AssistantEngineResult & {
  threadState: ReadOnlyThreadState;
  runtimeDiagnostics: ReadOnlyRuntimeDiagnostics;
};
