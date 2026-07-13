import type { AssistantUiContext } from "@/lib/assistant/engine/types";
import type {
  ReadOnlyHistoryMessage,
  ReadOnlyThreadState,
} from "@/lib/assistant/v1/types";

export const A101_PROMPT_VERSION = "a101-read-only-v1";
export const A101_MAX_CONVERSATION_MESSAGES = 20;
export const A101_MAX_MODEL_INPUT_CHARS = 24_000;
const MAX_MESSAGE_CHARS = 4_000;

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type BoundedConversation = {
  messages: ConversationMessage[];
  historyMessageCount: number;
  conversationMessageCount: number;
  totalChars: number;
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}
function truncate(value: string, max = MAX_MESSAGE_CHARS): string {
  return value.length <= max ? value : value.slice(0, max);
}

export function emptyReadOnlyThreadState(threadId: string): ReadOnlyThreadState {
  return {
    threadId,
    selectedFieldId: null,
    selectedFieldLabel: null,
    selectedWarehouseId: null,
    selectedOperationId: null,
    lastIntent: null,
    unresolvedQuestion: null,
  };
}

export function normalizeReadOnlyThreadState(params: {
  threadId: string;
  state?: Record<string, unknown> | ReadOnlyThreadState | null;
  runtimeContext?: AssistantUiContext | null;
}): ReadOnlyThreadState {
  const state = params.state && typeof params.state === "object" ? params.state as Record<string, unknown> : {};
  const stateThreadId = clean(state.threadId) || clean(state.thread_id);
  if (stateThreadId !== params.threadId) {
    const fresh = emptyReadOnlyThreadState(params.threadId);
    if (params.runtimeContext) {
      fresh.selectedFieldId = clean(params.runtimeContext.selectedFieldId);
      fresh.selectedFieldLabel = clean(params.runtimeContext.selectedFieldLabel);
      fresh.selectedWarehouseId = clean(params.runtimeContext.selectedWarehouseId);
      fresh.selectedOperationId = clean(params.runtimeContext.selectedOperationId);
    }
    return fresh;
  }
  return {
    threadId: params.threadId,
    selectedFieldId: clean(state.selectedFieldId) || clean(state.selected_field_id),
    selectedFieldLabel: clean(state.selectedFieldLabel) || clean(state.selected_field_label),
    selectedWarehouseId: clean(state.selectedWarehouseId) || clean(state.selected_warehouse_id),
    selectedOperationId: clean(state.selectedOperationId) || clean(state.selected_operation_id),
    lastIntent: (clean(state.lastIntent) || clean(state.last_intent)) as ReadOnlyThreadState["lastIntent"],
    unresolvedQuestion: clean(state.unresolvedQuestion) || clean(state.unresolved_question),
  };
}

const CONSTANT_RULES = [
  "You are Travkin Assistant V1 in strict read-only mode.",
  "Use only the eight tools provided in this request. Every tool has side_effect=none.",
  "Never create, update, delete, confirm, navigate, execute SQL, or call a legacy endpoint. Refuse requests that require a write.",
  "ERP facts must come from a tool result from the current request. Conversation history is context only and is never a live ERP data source.",
  "For fields: Сад is a name; 22 га is area_ha=22, never number=22; поле 28 is number=28.",
  "If more than one field matches, list candidates and ask one clarification question. Never select a random field.",
  "For a short follow-up about materials, use structured selected field focus from this thread.",
  "For a short follow-up about active operations, scope the summary to the structured selected field ID from this thread.",
  "Answer briefly in the user's language. Do not claim a write or navigation was performed.",
].join("\n");

export function buildBoundedConversation(params: {
  threadId: string;
  historyThreadId: string | null;
  history: ReadOnlyHistoryMessage[] | null | undefined;
  currentMessage: string;
  actor: { id: string; role: string };
  company: { id: string; name: string | null };
  runtimeContext: AssistantUiContext;
  threadState: ReadOnlyThreadState;
}): BoundedConversation {
  const currentMessage = truncate(clean(params.currentMessage) || "");
  const serverContext = truncate(JSON.stringify({
    company_id: params.company.id,
    company_name: params.company.name,
    user_id: params.actor.id,
    role: params.actor.role,
    season: params.runtimeContext.season,
    current_page: params.runtimeContext.currentPage,
    current_route: params.runtimeContext.currentRoute,
    current_module: params.runtimeContext.currentModule,
  }), 3_000);
  const focusContext = truncate(JSON.stringify({
    thread_id: params.threadState.threadId,
    selected_field_id: params.threadState.selectedFieldId,
    selected_field_label: params.threadState.selectedFieldLabel,
    selected_warehouse_id: params.threadState.selectedWarehouseId,
    selected_operation_id: params.threadState.selectedOperationId,
    last_intent: params.threadState.lastIntent,
    unresolved_question: params.threadState.unresolvedQuestion,
  }), 2_000);
  const systemMessages: ConversationMessage[] = [
    { role: "system", content: CONSTANT_RULES },
    { role: "system", content: `Authenticated server context: ${serverContext}` },
    { role: "system", content: `Structured focus for current thread only: ${focusContext}` },
  ];

  const validHistory = params.historyThreadId === params.threadId && Array.isArray(params.history)
    ? params.history
        .map((item): ConversationMessage | null => {
          if (!item || typeof item !== "object") return null;
          const role = item.role === "user" || item.role === "assistant" ? item.role : null;
          const content = clean(item.content);
          return role && content ? { role, content: truncate(content) } : null;
        })
        .filter((item): item is ConversationMessage => Boolean(item))
    : [];

  if (
    validHistory.length > 0 &&
    validHistory[validHistory.length - 1].role === "user" &&
    validHistory[validHistory.length - 1].content === currentMessage
  ) {
    validHistory.pop();
  }

  const candidateHistory = validHistory.slice(-(A101_MAX_CONVERSATION_MESSAGES - 1));
  const fixedChars = systemMessages.reduce((sum, item) => sum + item.content.length, 0) + currentMessage.length;
  let remainingChars = Math.max(0, A101_MAX_MODEL_INPUT_CHARS - fixedChars);
  const boundedHistory: ConversationMessage[] = [];
  for (let index = candidateHistory.length - 1; index >= 0; index -= 1) {
    const item = candidateHistory[index];
    if (item.content.length > remainingChars) continue;
    boundedHistory.unshift(item);
    remainingChars -= item.content.length;
  }

  const messages = [...systemMessages, ...boundedHistory, { role: "user" as const, content: currentMessage }];
  return {
    messages,
    historyMessageCount: boundedHistory.length,
    conversationMessageCount: boundedHistory.length + 1,
    totalChars: messages.reduce((sum, item) => sum + item.content.length, 0),
  };
}
