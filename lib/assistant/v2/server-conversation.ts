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

export type AssistantConversationSummarySlot = {
  version: 1;
  content: string;
  coveredUntilMessageId: string | null;
} | null;

export type ServerConversationV2 = {
  history: ReadOnlyHistoryMessage[];
  state: ReadOnlyThreadState;
  historyTruncated: boolean;
  meaningfulMessageCount: number;
  excludedMessageCount: number;
  summary: AssistantConversationSummarySlot;
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
  return {
    history: selected.map((message) => ({ role: message.role, content: clean(message.content) || "" })),
    state,
    historyTruncated: meaningful.length > maxHistory,
    meaningfulMessageCount: meaningful.length,
    excludedMessageCount: params.messages.length - meaningful.length - 1,
    summary: null,
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
