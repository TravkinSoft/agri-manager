import type { CanonicalRole } from "@/lib/auth/role-contract";

export type AssistantProvider = "openai";
export type AssistantUserRole = Extract<
  CanonicalRole,
  | "global_admin"
  | "company_admin"
  | "agronomist"
  | "director"
  | "warehouse_operator"
  | "weighman"
  | "specialist"
  | "brigadier"
  | "legal_operator"
  | "fuel_operator"
>;

export type AssistantResponseRules = {
  requireGroundingForDataQuestions: boolean;
  maxClarifyingQuestions: number;
  alwaysIncludeSourceHints: boolean;
};

export type AssistantGroundingRules = {
  blockUngroundedDataAnswers: boolean;
  requireToolForDomains: string[];
  disallowSeasonMixing: boolean;
};

export type AssistantLimits = {
  maxRecentMessages: number;
  maxSummaryChars: number;
  maxToolCallsPerQuery: number;
};

export type AssistantLogging = {
  enabled: boolean;
  storePromptSnippets: boolean;
  storeToolPayloads: boolean;
};

export type AssistantFeatures = {
  panelEnabled: boolean;
  navigationEnabled: boolean;
  actionDraftsEnabled: boolean;
  voiceEnabled: boolean;
  notificationsEnabled: boolean;
};

export type AssistantCompanyDataAccess = {
  inventory: boolean;
  warehouses: boolean;
  batches: boolean;
  ledger: boolean;
  fields: boolean;
  cropStructure: boolean;
  operations: boolean;
  weighbridge: boolean;
  fuel: boolean;
};

export type AssistantActionConfirmationRules = {
  alwaysRequireHumanConfirmation: boolean;
  allowDraftAutofill: boolean;
};

export type AssistantKnowledgePolicy = {
  internalLibraryFirst: boolean;
  allowPublicInternetLookup: boolean;
  requireLibrarySourceHints: boolean;
  fallbackToModelKnowledge: boolean;
};

export type AssistantMemoryPolicy = {
  userMemoryEnabled: boolean;
  companyMemoryEnabled: boolean;
  explicitLearningOnly: boolean;
  isolateMemoryPerUser: boolean;
};

export type AssistantCompanyPolicy = {
  allowCompanyInstructions: boolean;
  companyInstructionsOverrideCore: boolean;
  defaultCompanyInstructions: string;
};

export type AssistantPlatformSettings = {
  systemPrompt: string;
  provider: AssistantProvider;
  model: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high";
  enabled: boolean;
  allowedRoles: AssistantUserRole[];
  allowedTools: string[];
  forbiddenActions: string[];
  responseRules: AssistantResponseRules;
  groundingRules: AssistantGroundingRules;
  companyDataAccess: AssistantCompanyDataAccess;
  actionConfirmation: AssistantActionConfirmationRules;
  knowledgePolicy: AssistantKnowledgePolicy;
  memoryPolicy: AssistantMemoryPolicy;
  companyPolicy: AssistantCompanyPolicy;
  limits: AssistantLimits;
  logging: AssistantLogging;
  features: AssistantFeatures;
};

export const DEFAULT_ASSISTANT_PLATFORM_SETTINGS: AssistantPlatformSettings = {
  systemPrompt: "",
  provider: "openai",
  model: process.env.OPENAI_ASSISTANT_MODEL || "gpt-5.4-mini",
  temperature: 0.2,
  reasoningEffort: "medium",
  enabled: true,
  allowedRoles: [
    "global_admin",
    "company_admin",
    "agronomist",
    "director",
    "warehouse_operator",
    "weighman",
    "specialist",
    "brigadier",
    "legal_operator",
    "fuel_operator",
  ],
  allowedTools: [
    "get_current_context",
    "get_routes",
    "get_company_context",
    "get_current_season",
    "get_field_land_bank_summary",
    "search_fields",
    "get_field_card",
    "get_field_timeline",
    "get_field_materials",
    "find_field",
    "search_warehouses",
    "get_warehouse_stock",
    "find_warehouse",
    "search_operations",
    "get_operation_details",
    "find_operation",
    "get_active_operations",
    "get_active_operations_summary",
    "get_active_tickets",
    "get_recent_tickets",
    "get_ticket_details",
    "get_potato_material_report",
    "get_crop_structure_summary",
    "search_crops_by_group",
    "get_warehouse_summary",
    "get_fields",
    "get_crop_structure",
    "get_inventory",
    "get_batches",
    "get_warehouse_balances",
    "get_warehouse_movements",
    "get_weighbridge_tickets",
    "get_operations",
    "get_fuel_sources",
    "get_fuel_balances",
    "get_fuel_movements",
    "resolve_warehouse_by_name",
    "resolve_field_by_number",
    "resolve_fuel_source_by_name",
    "resolve_page_or_module",
    "resolve_crop_variety",
    "resolve_vehicle_or_equipment",
    "resolve_operation_type",
    "create_operation_draft",
    "create_field_draft",
    "create_meal_order_draft",
    "create_warehouse_draft",
    "create_transfer_draft",
    "create_fuel_issue_draft",
    "create_field_task_draft",
    "create_material_issue_draft",
    "create_weighbridge_ticket_draft",
    "navigate_to_page",
    "open_entity",
    "apply_filter",
  ],
  forbiddenActions: [
    "direct_sql_execution",
    "direct_ledger_mutation",
    "direct_ticket_finalize_without_confirm",
  ],
  responseRules: {
    requireGroundingForDataQuestions: true,
    maxClarifyingQuestions: 1,
    alwaysIncludeSourceHints: true,
  },
  groundingRules: {
    blockUngroundedDataAnswers: true,
    requireToolForDomains: [
      "inventory",
      "warehouses",
      "batches",
      "ledger",
      "weighbridge",
      "fuel",
      "crop_structure",
      "fields",
      "operations",
    ],
    disallowSeasonMixing: true,
  },
  companyDataAccess: {
    inventory: true,
    warehouses: true,
    batches: true,
    ledger: true,
    fields: true,
    cropStructure: true,
    operations: true,
    weighbridge: true,
    fuel: true,
  },
  actionConfirmation: {
    alwaysRequireHumanConfirmation: true,
    allowDraftAutofill: true,
  },
  knowledgePolicy: {
    internalLibraryFirst: true,
    allowPublicInternetLookup: false,
    requireLibrarySourceHints: true,
    fallbackToModelKnowledge: true,
  },
  memoryPolicy: {
    userMemoryEnabled: true,
    companyMemoryEnabled: false,
    explicitLearningOnly: true,
    isolateMemoryPerUser: true,
  },
  companyPolicy: {
    allowCompanyInstructions: true,
    companyInstructionsOverrideCore: false,
    defaultCompanyInstructions: "",
  },
  limits: {
    maxRecentMessages: 20,
    maxSummaryChars: 4000,
    maxToolCallsPerQuery: 10,
  },
  logging: {
    enabled: true,
    storePromptSnippets: true,
    storeToolPayloads: true,
  },
  features: {
    panelEnabled: true,
    navigationEnabled: true,
    actionDraftsEnabled: true,
    voiceEnabled: false,
    notificationsEnabled: false,
  },
};
