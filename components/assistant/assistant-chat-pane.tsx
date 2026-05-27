"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bot, Loader2, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/contexts/auth-context";
import type { AssistantRuntimeUiContext } from "@/lib/assistant/shell";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";
import type { AssistantDebugMetadata } from "@/lib/assistant/debug-types";

type AssistantChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  createdAt: string;
  meta?: {
    sourceHints?: string[];
    intent?: string;
  };
};

type AssistantThread = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type AssistantAccessState = {
  status: "loading" | "ready" | "missing_company" | "denied" | "error";
  role: string | null;
  message: string | null;
};

type AssistantSessionStatePayload = {
  lastEntity: string | null;
  lastCrop: string | null;
  lastVariety: string | null;
  lastBatchClass: string | null;
  lastWarehouse: string | null;
  lastField: string | null;
  lastSeason: string | null;
  lastIntent: string | null;
  lastResultContext: string | null;
};

type AssistantNavigationActionPayload =
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

type QueryResponsePayload = {
  response?: string;
  sessionState?: Partial<AssistantSessionStatePayload>;
  threadId?: string | null;
  navigationActions?: AssistantNavigationActionPayload[];
  meta?: {
    sourceHints?: string[];
    intent?: { name?: string };
    llm?: {
      status?: string;
      httpStatus?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      missingEnv?: string[];
    };
  };
  debug?: AssistantDebugMetadata;
  error?: string;
  code?: string;
};

const QUICK_PROMPTS = [
  "Открой весовую",
  "Найди данные по складам",
  "Объясни процесс выдачи материалов",
] as const;

const EMPTY_STATE: AssistantSessionStatePayload = {
  lastEntity: null,
  lastCrop: null,
  lastVariety: null,
  lastBatchClass: null,
  lastWarehouse: null,
  lastField: null,
  lastSeason: null,
  lastIntent: null,
  lastResultContext: null,
};

function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("SESSION_EXPIRED");
  }
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": "application/json",
  };
}

function mapAssistantError(code: string | null, fallback: string | null): string {
  switch (code) {
    case "COMPANY_CONTEXT_REQUIRED":
      return "Выберите компанию в верхнем переключателе и повторите запрос.";
    case "COMPANY_CONTEXT_MISSING":
      return "Компания для текущего пользователя не настроена.";
    case "ROLE_FORBIDDEN":
      return "Для вашей роли ассистент недоступен.";
    case "AUTH_MISSING":
    case "AUTH_INVALID":
      return "Сессия истекла. Обновите страницу и войдите снова.";
    default:
      return fallback || "Не удалось выполнить запрос к ассистенту.";
  }
}

function resolveDisabledReason(access: AssistantAccessState): string | null {
  if (access.status === "loading") return "Загрузка контекста ассистента...";
  if (access.status === "missing_company") return access.message || "Выберите компанию для работы с ассистентом.";
  if (access.status === "denied") return access.message || "Ассистент недоступен для текущей роли.";
  if (access.status === "error") return access.message || "Не удалось загрузить контекст ассистента.";
  return null;
}

function routeWithFilters(route: string, filters?: Record<string, string>): string {
  const safeRoute = route.startsWith("/") ? route : `/${route}`;
  if (!filters || !Object.keys(filters).length) return safeRoute;
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    const text = String(value || "").trim();
    if (text) params.set(key, text);
  });
  const query = params.toString();
  return query ? `${safeRoute}?${query}` : safeRoute;
}

function buildEntityFilters(action: Extract<AssistantNavigationActionPayload, { type: "open_entity" }>): Record<string, string> {
  const filters: Record<string, string> = { ...(action.filters || {}) };
  if (!filters.search && action.entityQuery) filters.search = action.entityQuery;
  if (!filters.entityId && action.entityId) filters.entityId = action.entityId;
  if (!filters.entityType && action.entityType) filters.entityType = action.entityType;
  return filters;
}

function pageLabel(page: string): string {
  const key = String(page || "").toLowerCase();
  switch (key) {
    case "dashboard":
      return "Панель";
    case "weighbridge":
      return "Весовая";
    case "warehouses":
      return "Склады";
    case "operations":
      return "Операции";
    case "fields":
      return "Поля";
    case "land-legal":
      return "Кадастр и право";
    case "users":
      return "Пользователи";
    case "analytics":
      return "Отчеты";
    default:
      return page || "—";
  }
}

function formatThreadDate(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function AssistantChatPane({
  runtimeContext,
  sessionId,
  access,
}: {
  runtimeContext: AssistantRuntimeUiContext;
  sessionId: string;
  access: AssistantAccessState;
}) {
  const router = useRouter();
  const { profile } = useAuth();
  const { setDebugSnapshot, setManualFilters } = useAssistantShell();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<AssistantSessionStatePayload>(EMPTY_STATE);
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const disabledReason = useMemo(() => resolveDisabledReason(access), [access]);

  const storageKey = useMemo(() => {
    if (!profile?.id || !sessionId) return null;
    const companyScope = runtimeContext.companyId || profile.company_id || "no-company";
    return `assistant-panel-v3:${profile.id}:${companyScope}:${sessionId}`;
  }, [profile?.id, profile?.company_id, runtimeContext.companyId, sessionId]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        activeThreadId?: string | null;
        sessionState?: Partial<AssistantSessionStatePayload>;
      };
      if (parsed.activeThreadId) setActiveThreadId(String(parsed.activeThreadId));
      if (parsed.sessionState && typeof parsed.sessionState === "object") {
        setSessionState((prev) => ({ ...prev, ...parsed.sessionState }));
      }
    } catch {
      // ignore malformed local storage payload
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        activeThreadId,
        sessionState,
        updatedAt: new Date().toISOString(),
      })
    );
  }, [storageKey, activeThreadId, sessionState]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const loadThreads = async () => {
    if (!runtimeContext.companyId || disabledReason) return;
    setThreadsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/assistant/threads?companyId=${encodeURIComponent(runtimeContext.companyId)}&limit=50`,
        {
          method: "GET",
          headers,
          cache: "no-store",
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        threads?: AssistantThread[];
        error?: string;
        code?: string;
      };
      if (!response.ok) throw new Error(mapAssistantError(payload.code || null, payload.error || null));
      const nextThreads = Array.isArray(payload.threads) ? payload.threads : [];
      setThreads(nextThreads);

      if (!activeThreadId && nextThreads.length > 0) {
        setActiveThreadId(nextThreads[0].id);
      } else if (activeThreadId && !nextThreads.some((thread) => thread.id === activeThreadId)) {
        setActiveThreadId(nextThreads[0]?.id || null);
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось загрузить историю чатов.");
    } finally {
      setThreadsLoading(false);
    }
  };

  const loadThreadMessages = async (threadId: string) => {
    if (!runtimeContext.companyId) return;
    setMessagesLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/assistant/threads/${encodeURIComponent(threadId)}/messages?companyId=${encodeURIComponent(runtimeContext.companyId)}&limit=300`,
        {
          method: "GET",
          headers,
          cache: "no-store",
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        messages?: Array<{
          id: string;
          role: "user" | "assistant" | "tool" | "system";
          content: string;
          metadata?: Record<string, unknown> | null;
          created_at: string;
        }>;
        error?: string;
        code?: string;
      };
      if (!response.ok) throw new Error(mapAssistantError(payload.code || null, payload.error || null));
      const nextMessages = (payload.messages || []).map((message) => ({
        id: String(message.id),
        role: message.role || "assistant",
        content: String(message.content || ""),
        createdAt: String(message.created_at || new Date().toISOString()),
        meta: {
          sourceHints: Array.isArray(message.metadata?.source_hints)
            ? (message.metadata?.source_hints as string[])
            : [],
          intent:
            typeof message.metadata?.intent === "string" ? (message.metadata.intent as string) : undefined,
        },
      }));
      setMessages(nextMessages);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось загрузить сообщения.");
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const createThread = async () => {
    if (!runtimeContext.companyId || disabledReason) return null;
    const headers = await getAuthHeaders();
    const response = await fetch("/api/assistant/threads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        companyId: runtimeContext.companyId,
        title: "Новый чат",
        currentPageContext: {
          page: runtimeContext.currentPage,
          route: runtimeContext.currentRoute,
          season: runtimeContext.season,
          companyName: runtimeContext.companyName,
        },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      thread?: AssistantThread;
      error?: string;
      code?: string;
    };
    if (!response.ok || !payload.thread) {
      throw new Error(mapAssistantError(payload.code || null, payload.error || null));
    }
    const created = payload.thread;
    setThreads((prev) => [created, ...prev.filter((thread) => thread.id !== created.id)]);
    setActiveThreadId(created.id);
    setMessages([]);
    setSessionState(EMPTY_STATE);
    return created.id;
  };

  useEffect(() => {
    if (access.status !== "ready" || !runtimeContext.companyId) return;
    void loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status, runtimeContext.companyId, profile?.id]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    void loadThreadMessages(activeThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || disabledReason) return;

    setRequestError(null);
    setLoading(true);
    const optimisticMessage: AssistantChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setInput("");

    try {
      const headers = await getAuthHeaders();
      let threadId = activeThreadId;
      if (!threadId) {
        threadId = await createThread();
      }
      if (!threadId) throw new Error("Не удалось создать чат.");

      const historyForRequest = [...messages, optimisticMessage]
        .slice(-20)
        .map((message) => ({ role: message.role, content: message.content }));

      const response = await fetch("/api/assistant/query", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: text,
          threadId,
          chatId: threadId,
          chatHistory: historyForRequest,
          runtimeContext,
          sessionState,
          sessionId,
          companyId: runtimeContext.companyId || null,
          locale: runtimeContext.locale || "ru",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as QueryResponsePayload;
      if (!response.ok) {
        throw new Error(mapAssistantError(payload.code || null, payload.error || null));
      }

      const meta = payload.meta ?? {};
      const sourceHints = Array.isArray(meta.sourceHints) ? meta.sourceHints : [];
      const intentName = meta.intent?.name ? String(meta.intent.name) : undefined;
      const navigationActions = Array.isArray(payload.navigationActions) ? payload.navigationActions : [];

      let navigationExecuted: boolean | null = null;
      let navigationError: string | null = null;
      let navigationRoute: string | null = null;

      if (navigationActions.length > 0) {
        const firstAction = navigationActions[0];
        try {
          switch (firstAction.type) {
            case "open_page":
              setManualFilters({});
              navigationRoute = routeWithFilters(firstAction.route);
              router.push(navigationRoute);
              break;
            case "open_page_with_filter":
            case "apply_filter":
              setManualFilters(firstAction.filters || {});
              navigationRoute = routeWithFilters(firstAction.route, firstAction.filters || {});
              router.push(navigationRoute);
              break;
            case "open_entity": {
              const filters = buildEntityFilters(firstAction);
              setManualFilters(filters);
              navigationRoute = routeWithFilters(firstAction.route, filters);
              router.push(navigationRoute);
              break;
            }
          }
          navigationExecuted = true;
        } catch (error) {
          navigationExecuted = false;
          navigationError = error instanceof Error ? error.message : "Router push failed";
        }
      }

      const answer = String(payload.response || "").trim() || "Я не вижу этих данных в системе.";
      const finalAnswer =
        navigationExecuted === false
          ? `${answer}\n\nНе смог открыть: ${navigationError || "route не найден"}.`
          : answer;
      const assistantMessage: AssistantChatMessage = {
        id: uid(),
        role: "assistant",
        content: finalAnswer,
        createdAt: new Date().toISOString(),
        meta: {
          sourceHints,
          intent: intentName,
        },
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (payload.debug) {
        setDebugSnapshot({
          ...payload.debug,
          engine: {
            ...payload.debug.engine,
            navigationIntentDetected:
              payload.debug.engine.navigationIntentDetected ||
              intentName === "navigation_help" ||
              navigationActions.length > 0,
            navigationActionCreated:
              payload.debug.engine.navigationActionCreated || navigationActions.length > 0,
            navigationActionExecuted: navigationExecuted,
            targetRoute: navigationRoute || payload.debug.engine.targetRoute || null,
            routerError: navigationError || null,
          },
        });
      } else {
        setDebugSnapshot(null);
      }

      if (payload.sessionState && typeof payload.sessionState === "object") {
        setSessionState((prev) => ({ ...prev, ...payload.sessionState }));
      }

      if (payload.threadId && payload.threadId !== activeThreadId) {
        setActiveThreadId(payload.threadId);
      }
      void loadThreads();
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Не удалось выполнить запрос к ассистенту."
      );
    } finally {
      setLoading(false);
    }
  };

  const onNewChat = async () => {
    setRequestError(null);
    try {
      await createThread();
      setHistoryOpen(false);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось создать новый чат.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border bg-white">
      <div className="border-b px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600">
            Я могу: открыть страницу, найти данные, объяснить процесс.
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setHistoryOpen((prev) => !prev)}>
              История
            </Button>
            <Button type="button" size="sm" onClick={() => void onNewChat()} disabled={!!disabledReason}>
              Новый чат
            </Button>
          </div>
        </div>

        {historyOpen ? (
          <div className="max-h-40 overflow-y-auto rounded-md border bg-slate-50 p-2">
            {threadsLoading ? (
              <div className="text-xs text-slate-500">Загрузка истории...</div>
            ) : threads.length ? (
              <div className="space-y-1">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      setHistoryOpen(false);
                    }}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                      activeThreadId === thread.id
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <div className="line-clamp-1 font-medium">{thread.title || "Новый чат"}</div>
                    <div className={`text-[11px] ${activeThreadId === thread.id ? "text-slate-300" : "text-slate-500"}`}>
                      {formatThreadDate(thread.updated_at)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">Пока нет истории. Создайте первый чат.</div>
            )}
          </div>
        ) : null}
      </div>

      {disabledReason ? (
        <div className="mx-4 mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {disabledReason}
        </div>
      ) : null}

      {requestError ? (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{requestError}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messagesLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаю сообщения...
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
            Спросите, например: «Открой весовую» или «Покажи активные операции».
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {message.role !== "user" ? (
                <div className="mt-0.5 rounded-full bg-green-100 p-1.5 text-green-700">
                  <Bot className="h-4 w-4" />
                </div>
              ) : null}

              <div className="max-w-[88%] space-y-1">
                <div
                  className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    message.role === "user"
                      ? "bg-green-600 text-white"
                      : "bg-slate-100 text-slate-900"
                  }`}
                >
                  {message.content}
                </div>
              </div>

              {message.role === "user" ? (
                <div className="mt-0.5 rounded-full bg-green-600 p-1.5 text-white">
                  <User className="h-4 w-4" />
                </div>
              ) : null}
            </div>
          ))
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Обрабатываю запрос...
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3">
        <div className="mb-2 text-xs text-slate-500">Вы на странице: {pageLabel(runtimeContext.currentPage)}.</div>
        <div className="mb-2 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setInput(prompt)}
              disabled={loading || !!disabledReason}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Спросите про талон, поле, склад или операцию…"
            className="min-h-[44px] resize-none"
            disabled={loading || !!disabledReason}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <Button type="submit" size="icon" disabled={loading || !!disabledReason || !input.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
