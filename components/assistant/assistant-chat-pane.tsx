"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  Clock3,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Settings2,
  TerminalSquare,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  actions?: AssistantActionButton[];
  meta?: {
    sourceHints?: string[];
    intent?: string;
    mode?: string;
    toolActivity?: string[];
  };
};

type AssistantActionButton = {
  id: string;
  label: string;
  kind: "navigate" | "prompt";
  route?: string;
  filters?: Record<string, string>;
  prompt?: string;
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
  actions?: AssistantActionButton[];
  toolActivity?: string[];
  meta?: {
    sourceHints?: string[];
    intent?: { name?: string };
    mode?: string;
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

const TOOL_LOADING_STEPS = [
  "Reading company context...",
  "Fetching ERP data...",
  "Preparing operational answer...",
] as const;

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

function formatThreadDate(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function quickActionsByPage(page: string): string[] {
  const key = String(page || "").toLowerCase();
  if (key === "crop-structure") return ["Покажи картофель", "Покажи зерновые", "Открой поля"];
  if (key === "warehouses") return ["Покажи остатки", "Покажи движения", "Покажи отрицательные остатки"];
  if (key === "weighbridge") return ["Покажи активные талоны", "Покажи последние талоны", "Открой терминал"];
  if (key === "operations") return ["Покажи активные операции", "Покажи операции картофеля", "Открой поле 28"];
  return ["Открой страницу", "Найди данные", "Объясни процесс"];
}

function rolePermissionsLabel(role: string | null): string {
  const value = String(role || "").toLowerCase();
  if (value === "global_admin" || value === "company_admin") return "Расширенный read-only + debug";
  return "Read-only operational scope";
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
  const {
    setDebugSnapshot,
    setManualFilters,
    debugSnapshot,
    debugMonitorEnabled,
    debugMonitorOpen,
    toggleDebugMonitor,
  } = useAssistantShell();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "history" | "settings">("chat");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<AssistantSessionStatePayload>(EMPTY_STATE);
  const [lastMode, setLastMode] = useState<string>("erp_data");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const disabledReason = useMemo(() => resolveDisabledReason(access), [access]);
  const quickActions = useMemo(() => quickActionsByPage(runtimeContext.currentPage), [runtimeContext.currentPage]);
  const loadingText = TOOL_LOADING_STEPS[loadingStepIndex % TOOL_LOADING_STEPS.length];

  const storageKey = useMemo(() => {
    if (!profile?.id || !sessionId) return null;
    const companyScope = runtimeContext.companyId || profile.company_id || "no-company";
    return `assistant-panel-v4:${profile.id}:${companyScope}:${sessionId}`;
  }, [profile?.id, profile?.company_id, runtimeContext.companyId, sessionId]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        activeThreadId?: string | null;
        activeTab?: "chat" | "history" | "settings";
        sessionState?: Partial<AssistantSessionStatePayload>;
      };
      if (parsed.activeThreadId) setActiveThreadId(String(parsed.activeThreadId));
      if (parsed.activeTab) setActiveTab(parsed.activeTab);
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
        activeTab,
        sessionState,
        updatedAt: new Date().toISOString(),
      })
    );
  }, [storageKey, activeThreadId, activeTab, sessionState]);

  useEffect(() => {
    if (!loading) return;
    setLoadingStepIndex(0);
    const id = window.setInterval(() => setLoadingStepIndex((prev) => prev + 1), 1300);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, activeTab]);

  const loadThreads = async () => {
    if (!runtimeContext.companyId || disabledReason) return;
    setThreadsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/assistant/threads?companyId=${encodeURIComponent(runtimeContext.companyId)}&limit=80`,
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
        `/api/assistant/threads/${encodeURIComponent(threadId)}/messages?companyId=${encodeURIComponent(runtimeContext.companyId)}&limit=400`,
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
      const nextMessages = (payload.messages || []).map((message) => {
        const metadata = (message.metadata || {}) as Record<string, unknown>;
        return {
          id: String(message.id),
          role: message.role || "assistant",
          content: String(message.content || ""),
          createdAt: String(message.created_at || new Date().toISOString()),
          actions: Array.isArray(metadata.actions) ? (metadata.actions as AssistantActionButton[]) : undefined,
          meta: {
            sourceHints: Array.isArray(metadata.source_hints) ? (metadata.source_hints as string[]) : [],
            toolActivity: Array.isArray(metadata.tool_activity) ? (metadata.tool_activity as string[]) : [],
            mode: typeof metadata.mode === "string" ? metadata.mode : undefined,
            intent: typeof metadata.intent === "string" ? metadata.intent : undefined,
          },
        } as AssistantChatMessage;
      });
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
    setLastMode("erp_data");
    return created.id;
  };

  useEffect(() => {
    if (access.status !== "ready" || !runtimeContext.companyId) return;
    void loadThreads();
  }, [access.status, runtimeContext.companyId, profile?.id]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    void loadThreadMessages(activeThreadId);
  }, [activeThreadId]);

  const executeAction = (action: AssistantActionButton) => {
    if (action.kind === "prompt") {
      if (action.prompt) setInput(action.prompt);
      setActiveTab("chat");
      return;
    }
    const route = action.route || "/dashboard";
    const filters = action.filters || {};
    setManualFilters(filters);
    router.push(routeWithFilters(route, filters));
    setActiveTab("chat");
  };

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
      const mode = typeof meta.mode === "string" ? meta.mode : "erp_data";
      const navigationActions = Array.isArray(payload.navigationActions) ? payload.navigationActions : [];
      const actions = Array.isArray(payload.actions) ? payload.actions : [];
      const toolActivity = Array.isArray(payload.toolActivity) ? payload.toolActivity : [];
      setLastMode(mode);

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
        actions,
        meta: {
          sourceHints,
          intent: intentName,
          mode,
          toolActivity,
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
      const errText =
        error instanceof Error ? error.message : "Не удалось выполнить запрос к ассистенту.";
      setRequestError(errText);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: errText,
          createdAt: new Date().toISOString(),
          meta: { intent: "error", mode: "erp_data", toolActivity: [] },
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onNewChat = async () => {
    setRequestError(null);
    try {
      await createThread();
      setActiveTab("chat");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось создать новый чат.");
    }
  };

  const clearCurrentThreadView = () => {
    setMessages([]);
    setSessionState(EMPTY_STATE);
    setRequestError(null);
  };

  const canSend = !loading && !disabledReason && !!input.trim();

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-[#262D3D] bg-[#0F141E] text-[#E5E7EB]">
      {disabledReason ? (
        <div className="mx-3 mt-3 rounded-md border border-amber-400/50 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
          {disabledReason}
        </div>
      ) : null}

      {requestError ? (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-red-500/50 bg-red-500/15 px-3 py-2 text-xs text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{requestError}</span>
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "chat" | "history" | "settings")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messagesLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загружаю сообщения...
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#334058] px-3 py-4 text-xs text-[#94A3B8]">
                Спросите: «Открой весовую», «Покажи остатки» или «Что по полю 28?».
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role !== "user" ? (
                    <div className="mt-0.5 rounded-full bg-[#1B2435] p-1.5 text-[#F5C542]">
                      <Bot className="h-4 w-4" />
                    </div>
                  ) : null}

                  <div className="max-w-[92%] space-y-1">
                    <div
                      className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-snug ${
                        message.role === "user"
                          ? "bg-[#E0B100] text-[#111827]"
                          : "border border-[#2A3448] bg-[#151C28] text-[#E5E7EB]"
                      }`}
                    >
                      {message.content}
                    </div>

                    {message.role !== "user" && message.meta?.toolActivity?.length ? (
                      <div className="rounded-md border border-[#334058] bg-[#101725] px-2.5 py-2 text-[11px] text-[#9CA3AF]">
                        <div className="mb-1 flex items-center gap-1 text-[#CBD5E1]">
                          <TerminalSquare className="h-3.5 w-3.5" />
                          Tool activity
                        </div>
                        <div className="space-y-0.5">
                          {message.meta.toolActivity.slice(0, 4).map((line) => (
                            <div key={line} className="truncate">
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {message.role !== "user" && message.actions?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {message.actions.map((action) => (
                          <button
                            key={action.id}
                            type="button"
                            onClick={() => executeAction(action)}
                            className="rounded-md border border-[#334058] bg-[#141B29] px-2.5 py-1 text-xs text-[#E5E7EB] hover:bg-[#202738]"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {message.role === "user" ? (
                    <div className="mt-0.5 rounded-full bg-[#E0B100] p-1.5 text-[#111827]">
                      <User className="h-4 w-4" />
                    </div>
                  ) : null}
                </div>
              ))
            )}

            {loading ? (
              <div className="rounded-md border border-[#334058] bg-[#101725] px-3 py-2 text-xs text-[#CBD5E1]">
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {loadingText}
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[#262D3D] bg-[#111827] px-3 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {quickActions.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  disabled={loading || !!disabledReason}
                  className="rounded-full border border-[#334058] bg-[#151C28] px-2.5 py-1 text-[11px] text-[#CBD5E1] hover:bg-[#202738] disabled:cursor-not-allowed disabled:opacity-60"
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
                placeholder="Спросите про поле, склад, операцию или талон..."
                className="min-h-[42px] resize-none border-[#334058] bg-[#0F141E] text-[#E5E7EB] placeholder:text-[#64748B]"
                disabled={loading || !!disabledReason}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <Button type="submit" size="icon" disabled={!canSend} className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-3 data-[state=inactive]:hidden">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-xs text-[#9CA3AF]">Потоки диалогов</div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void loadThreads()}
                className="border-[#334058] bg-[#141B29] text-[#E5E7EB] hover:bg-[#202738]"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Обновить
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void onNewChat()}
                disabled={!!disabledReason}
                className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]"
              >
                Новый чат
              </Button>
            </div>
          </div>

          {threadsLoading ? (
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаю историю...
            </div>
          ) : threads.length ? (
            <div className="space-y-1.5">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => {
                    setActiveThreadId(thread.id);
                    setActiveTab("chat");
                  }}
                  className={`w-full rounded-md border px-2.5 py-2 text-left transition ${
                    activeThreadId === thread.id
                      ? "border-[#E0B100] bg-[#1C2433] text-[#F3F4F6]"
                      : "border-[#2A3448] bg-[#141B29] text-[#CBD5E1] hover:bg-[#202738]"
                  }`}
                >
                  <div className="line-clamp-1 text-sm font-medium">{thread.title || "Новый чат"}</div>
                  <div className="mt-0.5 text-[11px] text-[#94A3B8]">{formatThreadDate(thread.updated_at)}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[#334058] px-3 py-4 text-xs text-[#94A3B8]">
              История пока пустая. Создайте первый чат.
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-3 data-[state=inactive]:hidden">
          <div className="space-y-3">
            <div className="rounded-md border border-[#2A3448] bg-[#141B29] px-3 py-2 text-sm">
              <div className="mb-1 text-xs text-[#94A3B8]">Режим и модель</div>
              <div className="text-xs text-[#E5E7EB]">
                Mode: <span className="font-semibold">{lastMode}</span>
              </div>
              <div className="text-xs text-[#E5E7EB]">
                Model: <span className="font-semibold">{debugSnapshot?.model.actualModel || debugSnapshot?.model.configuredModel || "не определена"}</span>
              </div>
              <div className="text-xs text-[#E5E7EB]">
                LLM status: <span className="font-semibold">{debugSnapshot?.model.llmStatus || "n/a"}</span>
              </div>
            </div>

            <div className="rounded-md border border-[#2A3448] bg-[#141B29] px-3 py-2 text-sm">
              <div className="mb-1 text-xs text-[#94A3B8]">Права</div>
              <div className="text-xs text-[#E5E7EB]">
                Роль: <span className="font-semibold">{access.role || "не определена"}</span>
              </div>
              <div className="text-xs text-[#E5E7EB]">{rolePermissionsLabel(access.role)}</div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {debugMonitorEnabled ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={toggleDebugMonitor}
                  className="justify-start border-[#334058] bg-[#141B29] text-[#E5E7EB] hover:bg-[#202738]"
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  {debugMonitorOpen ? "Скрыть Debug" : "Показать Debug"}
                </Button>
              ) : null}

              <Button
                type="button"
                variant="outline"
                onClick={clearCurrentThreadView}
                className="justify-start border-[#334058] bg-[#141B29] text-[#E5E7EB] hover:bg-[#202738]"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Очистить текущий поток
              </Button>
            </div>
          </div>
        </TabsContent>

        <div className="border-t border-[#262D3D] bg-[#0F141E] px-2 py-2">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-md border border-[#2A3448] bg-[#141B29] p-1">
            <TabsTrigger
              value="chat"
              className="data-[state=active]:bg-[#E0B100] data-[state=active]:text-[#111827] text-[#CBD5E1]"
            >
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-[#E0B100] data-[state=active]:text-[#111827] text-[#CBD5E1]"
            >
              <Clock3 className="mr-1.5 h-3.5 w-3.5" />
              History
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="data-[state=active]:bg-[#E0B100] data-[state=active]:text-[#111827] text-[#CBD5E1]"
            >
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
    </div>
  );
}
