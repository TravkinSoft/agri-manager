import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { ServerActorContext } from "@/lib/auth/server-session";

export type AssistantToolName =
  | "get_current_context"
  | "get_routes"
  | "get_company_context"
  | "get_current_season"
  | "get_field_land_bank_summary"
  | "search_fields"
  | "get_field_card"
  | "get_field_timeline"
  | "get_field_materials"
  | "find_field"
  | "search_warehouses"
  | "get_warehouse_count"
  | "get_warehouse_stock"
  | "find_warehouse"
  | "search_operations"
  | "get_operation_details"
  | "find_operation"
  | "get_active_operations"
  | "get_active_operations_summary"
  | "get_active_tickets"
  | "get_recent_tickets"
  | "get_ticket_details"
  | "get_potato_material_report"
  | "get_crop_structure_summary"
  | "search_crops_by_group"
  | "get_warehouse_summary"
  | "get_fields"
  | "get_crop_structure"
  | "get_inventory"
  | "get_batches"
  | "get_warehouse_balances"
  | "get_warehouse_movements"
  | "get_weighbridge_tickets"
  | "get_operations"
  | "get_fuel_sources"
  | "get_fuel_balances"
  | "get_fuel_movements"
  | "resolve_warehouse_by_name"
  | "resolve_field_by_number"
  | "resolve_fuel_source_by_name"
  | "resolve_page_or_module"
  | "resolve_crop_variety"
  | "resolve_vehicle_or_equipment"
  | "resolve_operation_type"
  | "create_operation_draft"
  | "create_field_draft"
  | "create_meal_order_draft"
  | "create_warehouse_draft"
  | "create_transfer_draft"
  | "create_fuel_issue_draft"
  | "create_field_task_draft"
  | "create_material_issue_draft"
  | "create_weighbridge_ticket_draft"
  | "navigate_to_page"
  | "open_entity"
  | "apply_filter";

export type AssistantIntentName =
  | "warehouse_count"
  | "inventory_balance"
  | "warehouse_movements"
  | "weighbridge_tickets"
  | "crop_structure_area"
  | "field_total_area"
  | "rotation_history"
  | "fields_overview"
  | "crop_structure_overview"
  | "operations_recent"
  | "fuel_balance"
  | "fuel_movements"
  | "entity_resolution"
  | "company_context"
  | "navigation_help"
  | "create_draft"
  | "clarification_required"
  | "general_question";

export type AssistantOutputType =
  | "summary_total"
  | "filtered_summary"
  | "list"
  | "action_navigation"
  | "balance"
  | "movements";

export type AssistantEngineMode = "tool_first" | "hybrid" | "model_first";
export type AssistantDecisionSource = "fast_path" | "router" | "model" | "memory_followup";

export type AssistantUiContext = {
  currentPage: string;
  currentRoute: string;
  currentModule: string;
  entity: { type: string; id: string; label?: string | null } | null;
  selectedRows: string[];
  filters: Record<string, string | string[]>;
  season: string | null;
  defaultSeason: string;
  companyId: string | null;
  companyName?: string | null;
  userId: string | null;
  userRole: string | null;
  selectedEntityType: string | null;
  selectedEntityId: string | null;
  selectedFieldId: string | null;
  selectedFieldLabel: string | null;
  selectedWarehouseId: string | null;
  selectedWarehouseLabel: string | null;
  selectedCrop: string | null;
  language: "ru" | "kz" | "en" | null;
  locale: "ru" | "kz" | "en" | null;
};

export type AssistantSessionState = {
  lastEntity: string | null;
  lastCrop: string | null;
  lastVariety: string | null;
  lastBatchClass: string | null;
  lastWarehouse: string | null;
  lastWarehouseId: string | null;
  lastWarehouseLabel: string | null;
  lastField: string | null;
  lastFieldId: string | null;
  lastFieldLabel: string | null;
  lastSeason: string | null;
  lastModule: string | null;
  lastToolSource: string | null;
  lastAnswerType: string | null;
  lastIntent: AssistantIntentName | null;
  lastResultContext: string | null;
  lastWarehouseCount: number | null;
  lastInventoryTotalKg: number | null;
  lastCropStructureAreaHa: number | null;
  lastFieldsAreaHa: number | null;
  lastDetectedInconsistency: string | null;
  lastInconsistencyAt: string | null;
};

export type AssistantAnswerDiagnostics = {
  expectedAnswerType: AssistantOutputType | null;
  selectedSource: string | null;
  selectedTool: string | null;
  fallbackSource: string | null;
  previousRelatedMemory: string | null;
  consistencyCheck: "pass" | "fail" | "skipped";
  contradictionDetected: boolean;
  correctionApplied: boolean;
};

export type AssistantIntent = {
  name: AssistantIntentName;
  confidence: number;
  needsData: boolean;
  parameters: Record<string, string | number | boolean | null>;
};

export type AssistantToolCallLog = {
  tool: AssistantToolName;
  params: Record<string, unknown>;
  ok: boolean;
  error?: string;
  rows?: number;
  durationMs?: number;
};

export type AssistantToolContext = {
  supabase: SupabaseClient;
  actor: ServerActorContext;
  companyId: string;
  settings: AssistantPlatformSettings;
  runtimeContext: AssistantUiContext;
  sessionState: AssistantSessionState;
  intent: AssistantIntent;
};

export type AssistantToolOutput = {
  title: string;
  rows: Array<Record<string, unknown>>;
  source: {
    module: string;
    tableOrView: string;
    season?: string | null;
    fetchedAt: string;
  };
  summary?: string;
  navigationHint?: {
    action: "open_page" | "open_entity" | "apply_filter";
    target: string;
    params?: Record<string, string>;
  };
};

export type AssistantNavigationAction =
  | {
      type: "open_page";
      page: string;
      route: string;
    }
  | {
      type: "open_page_with_filter";
      page: string;
      route: string;
      filters: Record<string, string>;
    }
  | {
      type: "open_entity";
      page: string;
      route: string;
      entityType: "warehouse" | "field" | "fuel";
      entityId: string | null;
      entityQuery: string | null;
      filters: Record<string, string>;
    }
  | {
      type: "apply_filter";
      page: string;
      route: string;
      filters: Record<string, string>;
    };

export type AssistantToolDefinition = {
  name: AssistantToolName;
  description: string;
  domains: string[];
  run: (context: AssistantToolContext) => Promise<AssistantToolOutput>;
};

export type AssistantEngineInput = {
  message: string;
  locale?: "ru" | "kz" | "en" | null;
  chatId?: string | null;
  runtimeContext?: Partial<AssistantUiContext> | null;
  sessionState?: Partial<AssistantSessionState> | null;
  chatHistory?: Array<{ role?: string; content?: string }> | null;
};

export type AssistantEngineResult = {
  answer: string;
  sessionState: AssistantSessionState;
  intent: AssistantIntent;
  outputType: AssistantOutputType;
  mode: "erp_data" | "agro_knowledge" | "mixed" | "navigation";
  toolCalls: AssistantToolCallLog[];
  toolActivity: string[];
  navigationActions: AssistantNavigationAction[];
  sourceHints: string[];
  answerSource:
    | "tools"
    | "llm_fallback"
    | "policy_block"
    | "disabled"
    | "access_denied"
    | "no_data"
    | "tool_error"
    | "fast_path_template"
    | "model_grounded"
    | "legacy_fallback";
  grounded: boolean;
  decisionSource?: AssistantDecisionSource;
  explicitNavigationRequested?: boolean;
  navigationPolicy?: "allowed" | "blocked" | "not_applicable";
  model: {
    configuredModel: string | null;
    actualModel: string | null;
    settingsSource: "db" | "env" | "default";
    promptVersion: string;
    promptSource: "code_default" | "db_override" | "env_override";
    promptUpdatedAt: string;
    requestMode: AssistantEngineMode;
    llm: {
      status: "not_called" | "ok" | "missing_api_key" | "network_error" | "http_error" | "invalid_response";
      httpStatus: number | null;
      errorCode: string | null;
      errorMessage: string | null;
      missingEnv: string[];
    };
  };
  diagnostics: AssistantAnswerDiagnostics;
  performance: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    routerMs: number | null;
    plannerMs: number | null;
    toolMs: number | null;
    validatorMs: number | null;
    modelMs: number | null;
    responseRenderMs: number | null;
    totalMs: number | null;
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
};
