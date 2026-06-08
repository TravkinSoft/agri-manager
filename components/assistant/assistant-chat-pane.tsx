"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  AudioLines,
  Bot,
  Clock3,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Send,
  Settings2,
  Square,
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
import { resolveRouteEntryByPath } from "@/lib/assistant/route-registry";
import { buildAssistantChatExport } from "@/lib/assistant/export/chat-export";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

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
  lastWarehouseId: string | null;
  lastWarehouseLabel: string | null;
  lastField: string | null;
  lastFieldId: string | null;
  lastFieldLabel: string | null;
  lastSeason: string | null;
  lastModule: string | null;
  lastToolSource: string | null;
  lastAnswerType: string | null;
  lastIntent: string | null;
  lastResultContext: string | null;
  lastWarehouseCount: number | null;
  lastInventoryTotalKg: number | null;
  lastCropStructureAreaHa: number | null;
  lastFieldsAreaHa: number | null;
  lastDetectedInconsistency: string | null;
  lastInconsistencyAt: string | null;
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
  lastWarehouseId: null,
  lastWarehouseLabel: null,
  lastField: null,
  lastFieldId: null,
  lastFieldLabel: null,
  lastSeason: null,
  lastModule: null,
  lastToolSource: null,
  lastAnswerType: null,
  lastIntent: null,
  lastResultContext: null,
  lastWarehouseCount: null,
  lastInventoryTotalKg: null,
  lastCropStructureAreaHa: null,
  lastFieldsAreaHa: null,
  lastDetectedInconsistency: null,
  lastInconsistencyAt: null,
};

const TOOL_LOADING_STEPS = ["Смотрю данные..."] as const;

function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatVoiceDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.trunc(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function getSupportedVoiceMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"].find((type) =>
      MediaRecorder.isTypeSupported(type)
    ) || ""
  );
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

function downloadFile(params: { fileName: string; content: string; mimeType: string }) {
  const blob = new Blob([params.content], { type: params.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = params.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function matchRoutePath(actualPath: string, expectedPath: string): boolean {
  if (actualPath === expectedPath) return true;
  if (expectedPath.endsWith("/")) return actualPath.startsWith(expectedPath);
  return actualPath.startsWith(`${expectedPath}/`);
}

async function confirmExecution(params: {
  action: AssistantNavigationActionPayload;
  targetRoute: string | null;
  initialHref?: string | null;
  timeoutMs?: number;
}): Promise<{ executed: boolean; error: string | null }> {
  const { action, targetRoute, initialHref, timeoutMs = 8000 } = params;
  if (!targetRoute) {
    return { executed: false, error: "route не задан" };
  }

  const expected = new URL(targetRoute, window.location.origin);
  const expectedPath = expected.pathname;
  const expectedParams = expected.searchParams;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const current = new URL(window.location.href);
    const routeOk = matchRoutePath(current.pathname, expectedPath);
    if (!routeOk) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      continue;
    }

    let paramsOk = true;
    expectedParams.forEach((value, key) => {
      if ((current.searchParams.get(key) || "") !== value) {
        paramsOk = false;
      }
    });

    if (!paramsOk) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      continue;
    }

    if (action.type === "open_entity") {
      const entityId = action.entityId || "";
      const inPath = Boolean(entityId) && current.pathname.includes(entityId);
      const inQuery =
        current.searchParams.get("entityId") === entityId ||
        current.searchParams.get("warehouseId") === entityId ||
        current.searchParams.get("fieldId") === entityId;
      if (entityId && !inPath && !inQuery) {
        await new Promise((resolve) => window.setTimeout(resolve, 80));
        continue;
      }
    }

    if (initialHref && current.href === initialHref) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      continue;
    }

    if (resolveRouteEntryByPath(current.pathname)) {
      return { executed: true, error: null };
    }
    return { executed: true, error: null };
  }

  return { executed: false, error: "route/action не сработал" };
}

function firstActionToSuccessText(action: AssistantNavigationActionPayload | null): string | null {
  if (!action) return null;
  if (action.type === "open_entity") {
    const label = action.entityQuery || action.entityId || "объект";
    return `Открыл: ${label}.`;
  }
  if (action.type === "open_page_with_filter" || action.type === "apply_filter") {
    return "Открыл страницу и применил фильтр.";
  }
  if (action.type === "open_page") {
    return "Открыл страницу.";
  }
  return null;
}

function formatThreadDate(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function rolePermissionsLabel(role: string | null): string {
  const value = String(role || "").toLowerCase();
  if (value === "global_admin" || value === "company_admin") return "Расширенный read-only + debug";
  return "Read-only operational scope";
}

function isProductionAssistantMessage(message: Pick<AssistantChatMessage, "content" | "actions" | "meta">): boolean {
  return !hasQaDataMarker(`${message.content || ""} ${JSON.stringify(message.actions || [])} ${JSON.stringify(message.meta || {})}`);
}

function sanitizeAssistantAnswer(content: string): string {
  if (!hasQaDataMarker(content)) return content;
  return "Ответ скрыт: в истории или источнике обнаружены тестовые QA-данные. Повторите запрос, и я проверю только производственные данные.";
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
    isOpen,
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
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<AssistantSessionStatePayload>(EMPTY_STATE);
  const [lastMode, setLastMode] = useState<string>("erp_data");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const focusInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const disabledReason = useMemo(() => resolveDisabledReason(access), [access]);
  const resolvedCompanyId = useMemo(
    () => runtimeContext.companyId || profile?.context_company_id || profile?.company_id || null,
    [runtimeContext.companyId, profile?.context_company_id, profile?.company_id]
  );
  const loadingText = TOOL_LOADING_STEPS[loadingStepIndex % TOOL_LOADING_STEPS.length];

  const stopVoiceStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    if (voiceState !== "recording") return;
    setVoiceSeconds(0);
    const startedAt = Date.now();
    const timerId = window.setInterval(() => {
      setVoiceSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timerId);
  }, [voiceState]);

  useEffect(() => {
    return () => stopVoiceStream();
  }, [stopVoiceStream]);

  const transcribeVoiceBlob = useCallback(
    async (blob: Blob) => {
      if (!blob.size) {
        setVoiceState("idle");
        setVoiceSeconds(0);
        return;
      }
      setVoiceState("transcribing");
      setVoiceError(null);
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session?.access_token) throw new Error("SESSION_EXPIRED");

        const formData = new FormData();
        formData.append("audio", blob, "voice.webm");
        formData.append("language", runtimeContext.locale || "ru");

        const response = await fetch("/api/assistant/transcribe", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: formData,
        });
        const payload = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!response.ok) throw new Error(payload.error || "Не удалось распознать голос.");
        const text = String(payload.text || "").trim();
        if (text) {
          setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
          focusInput();
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message === "SESSION_EXPIRED"
            ? "Сессия истекла. Обновите страницу и войдите снова."
            : error instanceof Error
              ? error.message
              : "Не удалось распознать голос.";
        setVoiceError(message);
      } finally {
        setVoiceState("idle");
        setVoiceSeconds(0);
      }
    },
    [focusInput, runtimeContext.locale]
  );

  const startVoiceRecording = useCallback(async () => {
    if (voiceState !== "idle" || loading || disabledReason) return;
    setVoiceError(null);
    setVoiceSeconds(0);
    setVoiceState("recording");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Браузер не поддерживает запись с микрофона.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder is not supported in this browser.");
      }
      const mimeType = getSupportedVoiceMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        audioChunksRef.current = [];
        stopVoiceStream();
        void transcribeVoiceBlob(blob);
      };
      recorder.onerror = () => {
        stopVoiceStream();
        setVoiceState("idle");
        setVoiceSeconds(0);
        setVoiceError("Запись с микрофона прервалась.");
      };
      recorder.start();
    } catch (error) {
      stopVoiceStream();
      setVoiceState("idle");
      setVoiceSeconds(0);
      setVoiceError(error instanceof Error ? error.message : "Не удалось включить микрофон.");
    }
  }, [disabledReason, loading, stopVoiceStream, transcribeVoiceBlob, voiceState]);

  const stopVoiceRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    setVoiceState("transcribing");
    recorder.stop();
  }, []);

  const storageKey = useMemo(() => {
    if (!profile?.id || !sessionId) return null;
    const companyScope = resolvedCompanyId || "no-company";
    return `assistant-panel-v4:${profile.id}:${companyScope}:${sessionId}`;
  }, [profile?.id, resolvedCompanyId, sessionId]);

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
    return () => stopVoiceStream();
  }, [stopVoiceStream]);

  useEffect(() => {
    if (!loading) return;
    setLoadingStepIndex(0);
    const id = window.setInterval(() => setLoadingStepIndex((prev) => prev + 1), 1300);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, activeTab]);

  useEffect(() => {
    if (activeTab === "chat") {
      focusInput();
    }
  }, [activeTab, focusInput]);

  useEffect(() => {
    if (isOpen) {
      focusInput();
    }
  }, [isOpen, focusInput]);

  const loadThreads = async () => {
    if (!resolvedCompanyId || disabledReason) return;
    setThreadsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/assistant/threads?companyId=${encodeURIComponent(resolvedCompanyId)}&limit=80`,
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
    if (!resolvedCompanyId) return;
    setMessagesLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/assistant/threads/${encodeURIComponent(threadId)}/messages?companyId=${encodeURIComponent(resolvedCompanyId)}&limit=400`,
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
      }).filter(isProductionAssistantMessage);
      setMessages(nextMessages);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось загрузить сообщения.");
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const createThread = async () => {
    if (!resolvedCompanyId || disabledReason) return null;
    const headers = await getAuthHeaders();
    const response = await fetch("/api/assistant/threads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        companyId: resolvedCompanyId,
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
    if (access.status !== "ready" || !resolvedCompanyId) return;
    if (!isOpen && threads.length === 0) return;
    if (threads.length > 0) return;
    void loadThreads();
  }, [access.status, resolvedCompanyId, profile?.id, isOpen, threads.length]);

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
      focusInput();
      return;
    }
    const route = action.route || "/dashboard";
    const filters = action.filters || {};
    setManualFilters(filters);
    router.push(routeWithFilters(route, filters));
    setActiveTab("chat");
    focusInput();
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
    focusInput();

    try {
      const headers = await getAuthHeaders();
      let threadId = activeThreadId;
      if (!threadId) {
        threadId = await createThread();
      }
      if (!threadId) throw new Error("Не удалось создать чат.");

      const historyForRequest = [...messages, optimisticMessage]
        .filter(isProductionAssistantMessage)
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
          companyId: resolvedCompanyId,
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
      let navigationActionType: string | null = null;
      let navigationEntityType: string | null = null;
      let navigationEntityId: string | null = null;

      if (navigationActions.length > 0) {
        const firstAction = navigationActions[0];
        const initialHref = window.location.href;
        navigationActionType = firstAction.type;
        let actionFiltersForDebug: Record<string, string> | null = null;
        if (firstAction.type === "open_entity") {
          navigationEntityType = firstAction.entityType;
          navigationEntityId = firstAction.entityId || null;
        }
        try {
          switch (firstAction.type) {
            case "open_page": {
              if (!firstAction.route) throw new Error("Missing route for open_page");
              setManualFilters({});
              navigationRoute = routeWithFilters(firstAction.route);
              router.push(navigationRoute);
              actionFiltersForDebug = {};
              break;
            }
            case "open_page_with_filter":
            case "apply_filter": {
              if (!firstAction.route) throw new Error("Missing route for filtered navigation");
              const filters = firstAction.filters || {};
              setManualFilters(filters);
              navigationRoute = routeWithFilters(firstAction.route, filters);
              router.push(navigationRoute);
              actionFiltersForDebug = filters;
              break;
            }
            case "open_entity": {
              if (!firstAction.route) throw new Error("Missing route for open_entity");
              if (!firstAction.entityId) throw new Error("Entity id is required for open_entity");
              const filters = buildEntityFilters(firstAction);
              if (firstAction.entityType === "warehouse" && !filters.warehouseId) {
                filters.warehouseId = firstAction.entityId;
              }
              setManualFilters(filters);
              navigationRoute = routeWithFilters(firstAction.route, filters);
              router.push(navigationRoute);
              actionFiltersForDebug = filters;
              break;
            }
          }
          const confirmed = await confirmExecution({
            action: firstAction,
            targetRoute: navigationRoute,
            initialHref,
          });
          navigationExecuted = confirmed.executed;
          navigationError = confirmed.error;
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
                navigationActionExecuted: confirmed.executed,
                navigationActionType: navigationActionType || payload.debug.engine.navigationActionType || null,
                navigationEntityType: navigationEntityType || payload.debug.engine.navigationEntityType || null,
                navigationEntityId: navigationEntityId || payload.debug.engine.navigationEntityId || null,
                navigationFilters: actionFiltersForDebug,
                targetRoute: navigationRoute || payload.debug.engine.targetRoute || null,
                routerError: confirmed.error || null,
              },
            });
          }
        } catch (error) {
          navigationExecuted = false;
          navigationError = error instanceof Error ? error.message : "Router push failed";
        }
      }

      const responseRenderStartedAt = typeof window !== "undefined" && window.performance ? window.performance.now() : Date.now();
      const answer = String(payload.response || "").trim() || "По системе сейчас данных по этому запросу не найдено.";
      const successTail =
        navigationExecuted === true && intentName === "navigation_help"
          ? firstActionToSuccessText(navigationActions[0] || null)
          : null;
      const rawFinalAnswer =
        navigationExecuted === false
          ? `${answer}\n\nНе удалось выполнить переход: ${navigationError || "route не найден"}.`
          : successTail
            ? `${answer}\n\n${successTail}`
            : answer;
      const finalAnswer = sanitizeAssistantAnswer(rawFinalAnswer);
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
      focusInput();
      const responseRenderMs = Math.max(
        0,
        Math.round((typeof window !== "undefined" && window.performance ? window.performance.now() : Date.now()) - responseRenderStartedAt)
      );
      if (payload.debug) {
        setDebugSnapshot({
          ...payload.debug,
          performance: {
            ...payload.debug.performance,
            responseRenderMs,
          },
          engine: {
            ...payload.debug.engine,
            navigationIntentDetected:
              payload.debug.engine.navigationIntentDetected ||
              intentName === "navigation_help" ||
              navigationActions.length > 0,
            navigationActionCreated:
              payload.debug.engine.navigationActionCreated || navigationActions.length > 0,
            navigationActionExecuted:
              navigationExecuted ?? payload.debug.engine.navigationActionExecuted ?? null,
            navigationActionType: navigationActionType || payload.debug.engine.navigationActionType || null,
            navigationEntityType: navigationEntityType || payload.debug.engine.navigationEntityType || null,
            navigationEntityId: navigationEntityId || payload.debug.engine.navigationEntityId || null,
            navigationFilters: payload.debug.engine.navigationFilters || null,
            targetRoute: navigationRoute || payload.debug.engine.targetRoute || null,
            routerError: navigationError || payload.debug.engine.routerError || null,
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
      focusInput();
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
  const canExportChat = useMemo(
    () => messages.filter(isProductionAssistantMessage).some((message) => message.role === "user" || message.role === "assistant"),
    [messages]
  );

  const onExportChat = useCallback(() => {
    if (!canExportChat) return;
    try {
      const result = buildAssistantChatExport({
        format: "markdown",
        context: {
          companyName: runtimeContext.companyName || null,
          season: runtimeContext.season || runtimeContext.defaultSeason || "2026",
          userName: profile?.full_name || profile?.email || profile?.id || null,
        },
        messages: messages.filter(isProductionAssistantMessage).map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          actions: message.actions?.map((action) => ({ label: action.label, kind: action.kind })),
        })),
      });
      downloadFile(result);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось экспортировать чат.");
    }
  }, [
    canExportChat,
    messages,
    profile?.email,
    profile?.full_name,
    profile?.id,
    runtimeContext.companyName,
    runtimeContext.defaultSeason,
    runtimeContext.season,
  ]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("travkin:assistant-export-state", {
        detail: { enabled: canExportChat },
      })
    );
  }, [canExportChat]);

  useEffect(() => {
    const handler = () => onExportChat();
    window.addEventListener("travkin:assistant-export-trigger", handler);
    return () => window.removeEventListener("travkin:assistant-export-trigger", handler);
  }, [onExportChat]);

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
          <div className="travkin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messagesLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загружаю сообщения...
              </div>
            ) : messages.length === 0 ? null : (
              messages.filter(isProductionAssistantMessage).map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-1.5 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role !== "user" ? (
                    <div className="mt-0.5 rounded-full bg-[#1B2435] p-1.5 text-[#F5C542]">
                      <Bot className="h-4 w-4" />
                    </div>
                  ) : null}

                  <div className="max-w-[92%] space-y-1">
                    <div
                      className={`whitespace-pre-wrap rounded-md px-2.5 py-1.5 text-sm leading-snug ${
                        message.role === "user"
                          ? "bg-[#E0B100] text-[#111827]"
                          : "border border-[#2A3448] bg-[#151C28] text-[#E5E7EB]"
                      }`}
                    >
                      {message.content}
                    </div>

                    {debugMonitorEnabled && debugMonitorOpen && message.role !== "user" && message.meta?.toolActivity?.length ? (
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
            {voiceState === "recording" ? (
              <div
                data-testid="assistant-voice-status"
                className="mb-2 flex items-center gap-2 rounded-md border border-[#3B465C] bg-[#151C28] px-2.5 py-1.5 text-xs text-[#E5E7EB]"
              >
                <AudioLines className="h-4 w-4 text-[#E0B100]" />
                <div className="flex h-5 items-end gap-0.5">
                  {Array.from({ length: 14 }).map((_, index) => (
                    <span
                      key={index}
                      className="w-1 animate-pulse rounded-full bg-[#E0B100]"
                      style={{
                        height: `${6 + ((index * 7) % 16)}px`,
                        animationDelay: `${index * 55}ms`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-[#CBD5E1]">Запись идет</span>
                <span className="ml-auto font-mono text-[11px] text-[#E0B100]">{formatVoiceDuration(voiceSeconds)}</span>
              </div>
            ) : null}

            {voiceError ? <div className="mb-2 text-xs text-red-200">{voiceError}</div> : null}

            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <Textarea
                ref={inputRef}
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
                  if (event.key === "Escape") {
                    event.stopPropagation();
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={loading || !!disabledReason || voiceState === "transcribing"}
                className="border-[#334058] bg-[#141B29] text-[#E5E7EB] hover:bg-[#202738]"
                data-testid="assistant-voice-button"
                aria-label={voiceState === "recording" ? "Остановить запись" : "Голосовой ввод"}
                aria-pressed={voiceState === "recording"}
                onClick={() => {
                  if (voiceState === "recording") {
                    stopVoiceRecording();
                    return;
                  }
                  void startVoiceRecording();
                }}
                title={voiceState === "recording" ? "Остановить запись" : "Голосовой ввод"}
              >
                {voiceState === "transcribing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : voiceState === "recording" ? (
                  <Square className="h-4 w-4 fill-current" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
              <Button type="submit" size="icon" disabled={!canSend} className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </TabsContent>

        <TabsContent value="history" className="travkin-scrollbar mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-3 data-[state=inactive]:hidden">
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

        <TabsContent value="settings" className="travkin-scrollbar mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-3 data-[state=inactive]:hidden">
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
