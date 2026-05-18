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
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  meta?: {
    sourceHints?: string[];
    intent?: string;
  };
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
  navigationActions?: AssistantNavigationActionPayload[];
  meta?: {
    sourceHints?: string[];
    intent?: { name?: string };
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
  const fallbackText = String(fallback || "").toLowerCase();
  if (!code) {
    if (fallbackText.includes("profile not found")) {
      return "Профиль пользователя не найден. Обратитесь к администратору.";
    }
    if (fallbackText.includes("unknown user role")) {
      return "Роль пользователя не распознана. Доступ к ассистенту закрыт.";
    }
    if (fallbackText.includes("legacy role alias")) {
      return "Обнаружена устаревшая роль. Обновите роль через администратора.";
    }
    if (fallbackText.includes("company context is not selected")) {
      return "Выберите компанию в верхнем переключателе и повторите запрос.";
    }
    if (fallbackText.includes("company context is not configured")) {
      return "Компания для текущего пользователя не настроена. Обратитесь к администратору.";
    }
  }

  switch (code) {
    case "COMPANY_CONTEXT_REQUIRED":
      return "Выберите компанию в верхнем переключателе и повторите запрос.";
    case "COMPANY_CONTEXT_MISSING":
      return "Компания для текущего пользователя не настроена. Обратитесь к администратору.";
    case "COMPANY_CONTEXT_INVALID":
      return "Контекст компании повреждён. Выберите компанию заново.";
    case "COMPANY_CONTEXT_MISMATCH":
      return "Запрошенная компания не совпадает с вашим доступом.";
    case "ROLE_FORBIDDEN":
      return "Для вашей роли ассистент недоступен.";
    case "ROLE_LEGACY_ALIAS":
      return "Обнаружена устаревшая роль. Обновите роль через администратора.";
    case "ROLE_UNKNOWN":
      return "Роль пользователя не распознана. Доступ к ассистенту закрыт.";
    case "PROFILE_NOT_FOUND":
      return "Профиль пользователя не найден. Обратитесь к администратору.";
    case "PROFILE_INACTIVE":
      return "Профиль пользователя неактивен.";
    case "AUTH_MISSING":
    case "AUTH_INVALID":
      return "Сессия истекла. Обновите страницу и войдите снова.";
    default:
      return "Не удалось выполнить запрос к ассистенту. Повторите позже.";
  }
}

function resolveDisabledReason(access: AssistantAccessState): string | null {
  if (access.status === "loading") return "Загрузка контекста ассистента...";
  if (access.status === "missing_company") {
    return access.message || "Выберите компанию для работы с ассистентом.";
  }
  if (access.status === "denied") {
    return access.message || "Ассистент недоступен для текущей роли.";
  }
  if (access.status === "error") {
    return access.message || "Не удалось загрузить контекст ассистента.";
  }
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
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<AssistantSessionStatePayload>(EMPTY_STATE);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const disabledReason = useMemo(() => resolveDisabledReason(access), [access]);

  const storageKey = useMemo(() => {
    if (!profile?.id || !sessionId) return null;
    const companyScope = runtimeContext.companyId || profile.company_id || "no-company";
    return `assistant-panel-v2:${profile.id}:${companyScope}:${sessionId}`;
  }, [profile?.id, profile?.company_id, runtimeContext.companyId, sessionId]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        messages?: AssistantChatMessage[];
        sessionState?: Partial<AssistantSessionStatePayload>;
      };
      if (Array.isArray(parsed.messages)) {
        setMessages(
          parsed.messages
            .filter((item) => item && (item.role === "user" || item.role === "assistant"))
            .slice(-30)
        );
      }
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
        messages: messages.slice(-30),
        sessionState,
        updatedAt: new Date().toISOString(),
      })
    );
  }, [storageKey, messages, sessionState]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || disabledReason) return;

    const userMessage: AssistantChatMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const historyForRequest = [...messages, userMessage].slice(-20).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setRequestError(null);
    setLoading(true);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/assistant/query", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: text,
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
            default:
              navigationRoute = null;
          }
          navigationExecuted = true;
        } catch (error) {
          navigationExecuted = false;
          navigationError = error instanceof Error ? error.message : "Router push failed";
        }
      }

      const assistantMessage: AssistantChatMessage = {
        role: "assistant",
        content: String(payload.response || "").trim() || "Данные по запросу не найдены.",
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
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить запрос к ассистенту."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border bg-white">
      <div className="border-b px-4 py-3 text-sm text-slate-600">
        Контекстный помощник ERP. Ответы по остаткам, складам, партиям и операциям формируются только через backend tools.
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
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
            Спросите, например: «Сколько картофеля по складам?» или «Открой страницу складов».
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.createdAt}-${index}`}
              className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "assistant" ? (
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
            placeholder="Введите вопрос по данным компании..."
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
