import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantUiContext } from "@/lib/assistant/engine/types";
import { normalizeAssistantUiContext } from "@/lib/assistant/engine/runtime";
import {
  listAssistantThreadMessages,
  type AssistantThreadMessageRecord,
} from "@/lib/assistant/threads-store";
import {
  emptyReadOnlyThreadState,
  normalizeReadOnlyThreadState,
} from "@/lib/assistant/v1/conversation";
import type { ReadOnlyHistoryMessage, ReadOnlyThreadState } from "@/lib/assistant/v1/types";

export const A104_MAX_MEANINGFUL_MESSAGES = 20;
export const A105_SUMMARY_REFRESH_MESSAGE_DELTA = 4;

export type AssistantConversationSummary = {
  version: 1;
  threadId: string;
  topics: string[];
  selectedObjects: {
    fieldId: string | null;
    fieldLabel: string | null;
    warehouseId: string | null;
    operationId: string | null;
    cropStructureLineId: string | null;
  };
  decisions: string[];
  confirmedFacts: string[];
  unresolvedQuestions: string[];
  rejectedAlternatives: string[];
  lastSafeAction: string | null;
  updatedAt: string;
  coveredUntilMessageId: string | null;
  coveredMessageCount: number;
};

export type AssistantConversationSummarySlot = AssistantConversationSummary | null;

export type AssistantUnresolvedQuestion = {
  version: 1;
  threadId: string;
  question: string;
  expectedClarification: string;
  fieldId: string | null;
  warehouseId: string | null;
  operationId: string | null;
  appearedAt: string;
  status: "open" | "resolved" | "cancelled";
  closedAt: string | null;
};

export type ServerConversationV2 = {
  history: ReadOnlyHistoryMessage[];
  state: ReadOnlyThreadState;
  historyTruncated: boolean;
  meaningfulMessageCount: number;
  excludedMessageCount: number;
  summary: AssistantConversationSummarySlot;
  summaryContext: string | null;
  unresolvedQuestion: AssistantUnresolvedQuestion | null;
  unresolvedQuestionContext: string | null;
};

const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk|proj)-[a-z0-9_-]{16,}\b/i,
  /\bBearer\s+[a-z0-9._~+/=-]{12,}\b/i,
  /\bOPENAI_API_KEY\s*=/i,
  /\bA102_TEST_ACCESS_TOKEN\s*=/i,
  /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/,
];

const TECHNICAL_CONTENT_PATTERNS = [
  /^\s*(?:system|developer|debug|trace|internal)\s*:/i,
  /^\s*\[(?:system|debug|trace|internal|technical)\]/i,
  /ignore (?:all )?(?:previous|developer|system) instructions/i,
];

export function containsPotentialConversationSecret(value: unknown): boolean {
  const content = String(value ?? "");
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

function clean(value: unknown, max = 4_000): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function unique(values: Array<string | null>, limit = 8): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).slice(0, limit);
}

function safeSummaryLine(value: unknown, max = 240): string | null {
  const text = clean(value, max);
  if (!text || containsPotentialConversationSecret(text)) return null;
  return text.replace(/\s+/g, " ").trim();
}

function classifyTopics(messages: AssistantThreadMessageRecord[]): string[] {
  const text = messages.map((message) => message.content).join(" ").toLowerCase();
  const topics: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ["fields", /пол[ея]|field|сад/],
    ["warehouses", /склад|warehouse|остат/],
    ["operations", /операц|operation/],
    ["materials", /материал|удобр|семен|product/],
    ["crop_structure", /культур|посев|crop/],
    ["assistant_preferences", /запомни|предпочита|отвечай|формат|язык/],
  ];
  for (const [topic, pattern] of rules) {
    if (pattern.test(text)) topics.push(topic);
  }
  return topics.slice(0, 8);
}

function latestStoredSummary(messages: AssistantThreadMessageRecord[], threadId: string): AssistantConversationSummarySlot {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const raw = messages[index].metadata?.conversation_summary_v1;
    if (!raw || typeof raw !== "object") continue;
    const summary = raw as Partial<AssistantConversationSummary>;
    if (summary.version !== 1 || summary.threadId !== threadId || !Array.isArray(summary.topics)) continue;
    return summary as AssistantConversationSummary;
  }
  return null;
}

function latestStoredUnresolvedQuestion(
  messages: AssistantThreadMessageRecord[],
  threadId: string
): AssistantUnresolvedQuestion | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const raw = messages[index].metadata?.unresolved_question_v1;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<AssistantUnresolvedQuestion>;
    if (item.version !== 1 || item.threadId !== threadId) continue;
    if (item.status !== "open" && item.status !== "resolved" && item.status !== "cancelled") continue;
    return item as AssistantUnresolvedQuestion;
  }
  return null;
}

function buildConversationSummary(params: {
  threadId: string;
  olderMessages: AssistantThreadMessageRecord[];
  state: ReadOnlyThreadState;
  previous: AssistantConversationSummarySlot;
}): AssistantConversationSummarySlot {
  if (!params.olderMessages.length) return params.previous;
  const coveredIds = new Set(params.olderMessages.map((message) => message.id));
  const previousCoveredIndex = params.previous?.coveredUntilMessageId
    ? params.olderMessages.findIndex((message) => message.id === params.previous?.coveredUntilMessageId)
    : -1;
  const newlyCovered = previousCoveredIndex >= 0
    ? params.olderMessages.slice(previousCoveredIndex + 1)
    : params.olderMessages;
  const topics = classifyTopics(params.olderMessages);
  const materialTopicChange = classifyTopics(newlyCovered).some((topic) => !params.previous?.topics.includes(topic));
  if (
    params.previous &&
    newlyCovered.length < A105_SUMMARY_REFRESH_MESSAGE_DELTA &&
    !materialTopicChange &&
    params.previous.coveredUntilMessageId &&
    coveredIds.has(params.previous.coveredUntilMessageId)
  ) {
    return params.previous;
  }

  const userMessages = params.olderMessages.filter((message) => message.role === "user");
  const decisions = unique(userMessages.map((message) =>
    /(?:решено|выбираю|выбрали|будем|оставим|давай|подтверждаю)/i.test(message.content)
      ? safeSummaryLine(message.content)
      : null
  ));
  const confirmedFacts = unique(userMessages.map((message) =>
    /(?:подтверждаю(?:,|:)?|это факт|точно известно)/i.test(message.content) &&
    !/(остат|статус операц|склад|api|token|key)/i.test(message.content)
      ? safeSummaryLine(message.content)
      : null
  ));
  const rejectedAlternatives = unique(userMessages.map((message) =>
    /(?:не надо|отмен|отказываюсь|не использовать|не выбира)/i.test(message.content)
      ? safeSummaryLine(message.content)
      : null
  ));
  const lastAssistant = [...params.olderMessages].reverse().find((message) => message.role === "assistant");
  const now = new Date().toISOString();
  return {
    version: 1,
    threadId: params.threadId,
    topics,
    selectedObjects: {
      fieldId: params.state.selectedFieldId,
      fieldLabel: params.state.selectedFieldLabel,
      warehouseId: params.state.selectedWarehouseId,
      operationId: params.state.selectedOperationId,
      cropStructureLineId: params.state.selectedCropStructureLineId,
    },
    decisions,
    confirmedFacts,
    unresolvedQuestions: params.state.unresolvedQuestion ? [params.state.unresolvedQuestion] : [],
    rejectedAlternatives,
    lastSafeAction: lastAssistant ? safeSummaryLine(lastAssistant.content) : null,
    updatedAt: now,
    coveredUntilMessageId: params.olderMessages[params.olderMessages.length - 1]?.id || null,
    coveredMessageCount: params.olderMessages.length,
  };
}

export function formatConversationSummaryContext(summary: AssistantConversationSummarySlot): string | null {
  if (!summary) return null;
  return JSON.stringify({
    topics: summary.topics,
    selected_objects: summary.selectedObjects,
    decisions: summary.decisions,
    confirmed_facts: summary.confirmedFacts,
    unresolved_questions: summary.unresolvedQuestions,
    rejected_or_cancelled: summary.rejectedAlternatives,
    last_safe_action: summary.lastSafeAction,
    updated_at: summary.updatedAt,
  });
}

export function formatUnresolvedQuestionContext(item: AssistantUnresolvedQuestion | null): string | null {
  if (!item || item.status !== "open") return null;
  return JSON.stringify({
    unresolved_question: item.question,
    expected_clarification: item.expectedClarification,
    related_field_id: item.fieldId,
    related_warehouse_id: item.warehouseId,
    related_operation_id: item.operationId,
    appeared_at: item.appearedAt,
    status: item.status,
  });
}

export function deriveUnresolvedQuestionV1(params: {
  threadId: string;
  previous: AssistantUnresolvedQuestion | null;
  nextQuestion: string | null;
  userMessage: string;
  state: ReadOnlyThreadState;
  now?: string;
}): AssistantUnresolvedQuestion | null {
  const now = params.now || new Date().toISOString();
  const nextQuestion = safeSummaryLine(params.nextQuestion, 500);
  const cancelled = /^(?:отмена|отмени|неважно|не надо|cancel)\b/i.test(params.userMessage.trim());
  if (params.previous?.threadId === params.threadId && params.previous.status === "open" && (cancelled || !nextQuestion)) {
    return { ...params.previous, status: cancelled ? "cancelled" : "resolved", closedAt: now };
  }
  if (!nextQuestion) return params.previous?.threadId === params.threadId ? params.previous : null;
  if (params.previous?.threadId === params.threadId && params.previous.status === "open" && params.previous.question === nextQuestion) {
    return params.previous;
  }
  return {
    version: 1,
    threadId: params.threadId,
    question: nextQuestion,
    expectedClarification: nextQuestion,
    fieldId: params.state.selectedFieldId,
    warehouseId: params.state.selectedWarehouseId,
    operationId: params.state.selectedOperationId,
    appearedAt: now,
    status: "open",
    closedAt: null,
  };
}

function structuredStateFromMessages(
  messages: AssistantThreadMessageRecord[],
  threadId: string
): ReadOnlyThreadState {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.metadata) continue;
    const raw = message.metadata.read_only_thread_state;
    if (!raw || typeof raw !== "object") continue;
    const normalized = normalizeReadOnlyThreadState({
      threadId,
      state: raw as Record<string, unknown>,
    });
    if (normalized.threadId === threadId) return normalized;
  }
  return emptyReadOnlyThreadState(threadId);
}

function isMeaningfulMessage(message: AssistantThreadMessageRecord, currentUserMessageId: string): boolean {
  if (message.id === currentUserMessageId) return false;
  if (message.role !== "user" && message.role !== "assistant") return false;
  const content = clean(message.content);
  if (!content) return false;
  const metadata = message.metadata || {};
  if (
    metadata.technical === true ||
    metadata.debug === true ||
    metadata.internal === true ||
    metadata.client_hint === true ||
    metadata.message_role === "system" ||
    metadata.message_role === "tool"
  ) return false;
  if (containsPotentialConversationSecret(content)) return false;
  if (TECHNICAL_CONTENT_PATTERNS.some((pattern) => pattern.test(content))) return false;
  return true;
}

export function buildServerConversationV2(params: {
  threadId: string;
  messages: AssistantThreadMessageRecord[];
  currentUserMessageId: string;
  verifiedUiContext: AssistantUiContext;
}): ServerConversationV2 {
  const previousState = structuredStateFromMessages(params.messages, params.threadId);
  const state: ReadOnlyThreadState = {
    ...previousState,
    threadId: params.threadId,
    selectedFieldId: params.verifiedUiContext.selectedFieldId || previousState.selectedFieldId,
    selectedFieldLabel: params.verifiedUiContext.selectedFieldLabel || previousState.selectedFieldLabel,
    selectedWarehouseId: params.verifiedUiContext.selectedWarehouseId || previousState.selectedWarehouseId,
    selectedOperationId: params.verifiedUiContext.selectedOperationId || previousState.selectedOperationId,
    selectedCropStructureLineId:
      params.verifiedUiContext.selectedCropStructureSectionId || previousState.selectedCropStructureLineId,
  };
  const meaningful = params.messages.filter((message) =>
    isMeaningfulMessage(message, params.currentUserMessageId)
  );
  const maxHistory = A104_MAX_MEANINGFUL_MESSAGES - 1;
  const selected = meaningful.slice(-maxHistory);
  const older = meaningful.slice(0, Math.max(0, meaningful.length - maxHistory));
  const previousSummary = latestStoredSummary(params.messages, params.threadId);
  const summary = buildConversationSummary({
    threadId: params.threadId,
    olderMessages: older,
    state,
    previous: previousSummary,
  });
  const unresolvedQuestion = latestStoredUnresolvedQuestion(params.messages, params.threadId);
  return {
    history: selected.map((message) => ({ role: message.role, content: clean(message.content) || "" })),
    state,
    historyTruncated: meaningful.length > maxHistory,
    meaningfulMessageCount: meaningful.length,
    excludedMessageCount: params.messages.length - meaningful.length - 1,
    summary,
    summaryContext: formatConversationSummaryContext(summary),
    unresolvedQuestion,
    unresolvedQuestionContext: formatUnresolvedQuestionContext(unresolvedQuestion),
  };
}

async function verifyEntity(params: {
  supabase: SupabaseClient;
  table: "fields" | "warehouses" | "operations" | "crop_structure";
  id: string | null;
  companyId: string;
  select?: string;
}): Promise<Record<string, unknown> | null> {
  if (!params.id) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.id)) {
    return null;
  }
  const result = await params.supabase
    .from(params.table)
    .select(params.select || "id")
    .eq("id", params.id)
    .eq("company_id", params.companyId)
    .maybeSingle();
  if (result.error) throw new Error(`UI context verification failed for ${params.table}: ${result.error.message}`);
  return result.data as Record<string, unknown> | null;
}

export async function verifyAssistantUiContextV2(params: {
  supabase: SupabaseClient;
  raw: Record<string, unknown> | null | undefined;
  companyId: string;
  companyName: string | null;
  userId: string;
  userRole: string;
}): Promise<AssistantUiContext> {
  const normalized = normalizeAssistantUiContext({
    currentPage: clean(params.raw?.currentPage, 120) || "dashboard",
    currentRoute: clean(params.raw?.currentRoute, 240) || "/dashboard",
    currentModule: clean(params.raw?.currentModule, 120) || "dashboard",
    season: clean(params.raw?.season, 40),
    defaultSeason: clean(params.raw?.defaultSeason, 40) || "2026",
    locale:
      params.raw?.locale === "en" || params.raw?.locale === "kz" || params.raw?.locale === "ru"
        ? params.raw.locale
        : "ru",
    companyId: params.companyId,
    companyName: params.companyName,
    userId: params.userId,
    userRole: params.userRole,
    selectedFieldId: clean(params.raw?.selectedFieldId, 100),
    selectedWarehouseId: clean(params.raw?.selectedWarehouseId, 100),
    selectedOperationId: clean(params.raw?.selectedOperationId, 100),
    selectedCropStructureSectionId: clean(params.raw?.selectedCropStructureSectionId, 100),
  });

  const [field, warehouse, operation, cropStructure] = await Promise.all([
    verifyEntity({
      supabase: params.supabase,
      table: "fields",
      id: normalized.selectedFieldId,
      companyId: params.companyId,
      select: "id,name",
    }),
    verifyEntity({
      supabase: params.supabase,
      table: "warehouses",
      id: normalized.selectedWarehouseId,
      companyId: params.companyId,
    }),
    verifyEntity({
      supabase: params.supabase,
      table: "operations",
      id: normalized.selectedOperationId,
      companyId: params.companyId,
    }),
    verifyEntity({
      supabase: params.supabase,
      table: "crop_structure",
      id: normalized.selectedCropStructureSectionId,
      companyId: params.companyId,
    }),
  ]);

  return {
    ...normalized,
    filters: {},
    selectedRows: [],
    entity: null,
    selectedEntityType: null,
    selectedEntityId: null,
    selectedFieldId: field ? String(field.id) : null,
    selectedFieldLabel: field ? clean(field.name, 240) : null,
    selectedWarehouseId: warehouse ? String(warehouse.id) : null,
    selectedWarehouseLabel: null,
    selectedOperationId: operation ? String(operation.id) : null,
    selectedOperationLabel: null,
    selectedCropStructureSectionId: cropStructure ? String(cropStructure.id) : null,
    selectedCropStructureSectionLabel: null,
    selectedTicketId: null,
    selectedTicketLabel: null,
    selectedBatchId: null,
    selectedBatchLabel: null,
    selectedCrop: null,
  };
}

export async function loadServerConversationV2(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  threadId: string;
  currentUserMessageId: string;
  verifiedUiContext: AssistantUiContext;
}): Promise<ServerConversationV2> {
  const messages = await listAssistantThreadMessages({
    supabase: params.supabase,
    companyId: params.companyId,
    userId: params.userId,
    threadId: params.threadId,
    limit: 1_000,
  });
  return buildServerConversationV2({
    threadId: params.threadId,
    messages,
    currentUserMessageId: params.currentUserMessageId,
    verifiedUiContext: params.verifiedUiContext,
  });
}
