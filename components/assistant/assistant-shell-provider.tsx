"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import type { AssistantContextEntity, AssistantRuntimeUiContext, AssistantSessionMeta } from "@/lib/assistant/shell";
import { canUseAssistantShell } from "@/lib/assistant/shell";
import type { AssistantDebugMetadata } from "@/lib/assistant/debug-types";

type AssistantAccessStatus = "loading" | "ready" | "missing_company" | "denied" | "error";

type AssistantAccessState = {
  status: AssistantAccessStatus;
  role: string | null;
  message: string | null;
  debugSource: {
    role?: string;
    company?: string;
  } | null;
  debugDetails?: {
    authUserId?: string | null;
    profileId?: string | null;
    resolvedRole?: string | null;
    roleRawKey?: string | null;
    roleIsLegacyAlias?: boolean | null;
    homeCompanyId?: string | null;
    contextCompanyId?: string | null;
    resolvedCompanyId?: string | null;
  } | null;
};

type AssistantShellContextValue = {
  enabled: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  runtimeContext: AssistantRuntimeUiContext;
  session: AssistantSessionMeta;
  access: AssistantAccessState;
  debugMonitorEnabled: boolean;
  debugMonitorOpen: boolean;
  debugMonitorCollapsed: boolean;
  debugSnapshot: AssistantDebugMetadata | null;
  setContextEntity: (entity: AssistantContextEntity | null) => void;
  setSelectedRows: (rows: string[]) => void;
  setManualFilters: (filters: Record<string, string | string[]>) => void;
  openDebugMonitor: () => void;
  closeDebugMonitor: () => void;
  toggleDebugMonitor: () => void;
  setDebugMonitorCollapsed: (collapsed: boolean) => void;
  setDebugSnapshot: (snapshot: AssistantDebugMetadata | null) => void;
};

const AssistantShellContext = createContext<AssistantShellContextValue | undefined>(undefined);

type AssistantServerContextPayload = {
  allowed?: boolean;
  role?: string;
  season?: string | null;
  requiresCompanySelection?: boolean;
  source?: {
    role?: string;
    company?: string;
  };
  debug?: {
    authUserId?: string | null;
    profileId?: string | null;
    resolvedRole?: string | null;
    roleRawKey?: string | null;
    roleIsLegacyAlias?: boolean | null;
    homeCompanyId?: string | null;
    contextCompanyId?: string | null;
    resolvedCompanyId?: string | null;
  };
  company?: {
    id: string;
    name: string;
  } | null;
  error?: string;
  code?: string;
};

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function isLikelyEntityId(value: string): boolean {
  return /^[0-9a-f-]{8,}$/i.test(value) || /^\d+$/.test(value);
}

function detectEntityFromPath(pathname: string): AssistantContextEntity | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const candidate = parts[parts.length - 1];
  if (!candidate || !isLikelyEntityId(candidate)) return null;
  return {
    type: parts[parts.length - 2] || parts[0] || "entity",
    id: candidate,
    label: null,
  };
}

function storageKey(userId: string | null | undefined, companyId: string | null | undefined): string | null {
  if (!userId) return null;
  return `assistant-shell:${userId}:${companyId || "no-company"}`;
}

function isDebugEnabledForRole(role: string | null | undefined): boolean {
  if (role === "global_admin" || role === "company_admin") return true;
  return process.env.NEXT_PUBLIC_ASSISTANT_DEBUG === "1";
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

function mapContextErrorMessage(code: string | null, fallback: string | null): string {
  switch (code) {
    case "COMPANY_CONTEXT_REQUIRED":
      return "Выберите компанию в верхнем переключателе, чтобы использовать ассистента.";
    case "COMPANY_CONTEXT_MISSING":
      return "Компания для текущего пользователя не настроена. Обратитесь к администратору.";
    case "COMPANY_CONTEXT_INVALID":
      return "Контекст компании поврежден. Выберите компанию заново в верхнем переключателе.";
    case "COMPANY_CONTEXT_MISMATCH":
      return "Запрошенный контекст компании не совпадает с вашим доступом.";
    case "ROLE_FORBIDDEN":
      return "Для вашей роли ассистент недоступен.";
    case "ROLE_LEGACY_ALIAS":
      return "Обнаружена устаревшая роль пользователя. Обновите роль через администратора.";
    case "AUTH_MISSING":
    case "AUTH_INVALID":
      return "Сессия истекла. Обновите страницу и войдите снова.";
    case "PROFILE_NOT_FOUND":
      return "Профиль пользователя не найден. Обратитесь к администратору.";
    case "PROFILE_INACTIVE":
      return "Профиль пользователя неактивен.";
    case "ROLE_UNKNOWN":
      return "Роль пользователя не распознана. Доступ к ассистенту закрыт.";
    default:
      return fallback || "Не удалось определить контекст ассистента.";
  }
}

function mapAccessStatus(code: string | null): AssistantAccessStatus {
  if (!code) return "error";
  if (code === "ROLE_FORBIDDEN" || code === "ROLE_LEGACY_ALIAS" || code === "ROLE_UNKNOWN") return "denied";
  if (code === "COMPANY_CONTEXT_REQUIRED" || code === "COMPANY_CONTEXT_MISSING" || code === "COMPANY_CONTEXT_INVALID") {
    return "missing_company";
  }
  if (code === "AUTH_MISSING" || code === "AUTH_INVALID" || code === "PROFILE_NOT_FOUND" || code === "PROFILE_INACTIVE") {
    return "error";
  }
  return "error";
}

export function AssistantShellProvider({ children }: { children: React.ReactNode }) {
  const { profile, user } = useAuth();
  const { language } = useLanguage();
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();

  const enabled = canUseAssistantShell(profile?.role) && !profile?.role_is_legacy_alias;
  const debugMonitorEnabled = isDebugEnabledForRole(profile?.role);
  const [isOpen, setIsOpen] = useState(false);
  const [debugMonitorOpen, setDebugMonitorOpen] = useState(false);
  const [debugMonitorCollapsed, setDebugMonitorCollapsed] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState<AssistantDebugMetadata | null>(null);
  const [manualEntity, setManualEntity] = useState<AssistantContextEntity | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [manualFilters, setManualFilters] = useState<Record<string, string | string[]>>({});
  const [session, setSession] = useState<AssistantSessionMeta>(() => ({
    sessionId: createSessionId(),
    updatedAt: new Date().toISOString(),
  }));

  const [serverContext, setServerContext] = useState<AssistantServerContextPayload | null>(null);
  const [access, setAccess] = useState<AssistantAccessState>({
    status: enabled ? "loading" : "denied",
    role: profile?.role || null,
    message: enabled
      ? "Загрузка контекста ассистента..."
      : profile?.role_is_legacy_alias
        ? "Обнаружена устаревшая роль пользователя. Обновите роль через администратора."
        : "Ассистент недоступен для текущей роли.",
    debugSource: null,
    debugDetails: null,
  });

  const contextFromRoute = useMemo(() => {
    const filters: Record<string, string | string[]> = {};
    searchParams.forEach((value, key) => {
      if (key in filters) {
        const current = filters[key];
        filters[key] = Array.isArray(current) ? [...current, value] : [current, value];
      } else {
        filters[key] = value;
      }
    });
    return filters;
  }, [searchParams]);

  useEffect(() => {
    const key = storageKey(user?.id, profile?.company_id || null);
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        isOpen?: boolean;
        debugMonitorOpen?: boolean;
        debugMonitorCollapsed?: boolean;
        sessionId?: string;
        selectedRows?: string[];
        manualFilters?: Record<string, string | string[]>;
      };
      if (typeof parsed.isOpen === "boolean") setIsOpen(parsed.isOpen);
      if (typeof parsed.debugMonitorOpen === "boolean") setDebugMonitorOpen(parsed.debugMonitorOpen);
      if (typeof parsed.debugMonitorCollapsed === "boolean") setDebugMonitorCollapsed(parsed.debugMonitorCollapsed);
      if (parsed.sessionId) setSession({ sessionId: parsed.sessionId, updatedAt: new Date().toISOString() });
      if (Array.isArray(parsed.selectedRows)) setSelectedRows(parsed.selectedRows.map(String));
      if (parsed.manualFilters && typeof parsed.manualFilters === "object") setManualFilters(parsed.manualFilters);
    } catch {
      // Ignore malformed local storage payload.
    }
  }, [user?.id, profile?.company_id]);

  useEffect(() => {
    const key = storageKey(user?.id, profile?.company_id || null);
    if (!key) return;
    const payload = {
      isOpen,
      debugMonitorOpen,
      debugMonitorCollapsed,
      sessionId: session.sessionId,
      selectedRows,
      manualFilters,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(payload));
  }, [
    user?.id,
    profile?.company_id,
    isOpen,
    debugMonitorOpen,
    debugMonitorCollapsed,
    session.sessionId,
    selectedRows,
    manualFilters,
  ]);

  useEffect(() => {
    if (debugMonitorEnabled) return;
    setDebugMonitorOpen(false);
    setDebugSnapshot(null);
  }, [debugMonitorEnabled]);

  useEffect(() => {
    let cancelled = false;

    async function loadServerContext() {
      if (!enabled) {
        setServerContext(null);
        setAccess({
          status: "denied",
          role: profile?.role || null,
          message: profile?.role_is_legacy_alias
            ? "Обнаружена устаревшая роль пользователя. Обновите роль через администратора."
            : "Ассистент недоступен для текущей роли.",
          debugSource: null,
          debugDetails: null,
        });
        return;
      }

      setAccess((prev) => ({
        ...prev,
        status: "loading",
        role: profile?.role || null,
        message: "Загрузка контекста ассистента...",
      }));

      try {
        const headers = await getAuthHeaders();
        const debugQuery =
          profile?.role === "global_admin" ||
          profile?.role === "company_admin" ||
          process.env.NEXT_PUBLIC_ASSISTANT_DEBUG === "1"
            ? "?debug=1"
            : "";
        const response = await fetch(`/api/assistant/context${debugQuery}`, {
          method: "GET",
          headers,
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as AssistantServerContextPayload;
        if (cancelled) return;

        if (!response.ok) {
          const code = cleanString(payload.code);
          const resolvedRole = payload.role || profile?.role || null;
          setServerContext(null);
          setAccess({
            status: mapAccessStatus(code),
            role: resolvedRole,
            message: mapContextErrorMessage(code, payload.error || null),
            debugSource: payload.source || null,
            debugDetails: payload.debug || null,
          });
          return;
        }

        setServerContext(payload);
        if (payload.requiresCompanySelection) {
          setAccess({
            status: "missing_company",
            role: payload.role || profile?.role || null,
            message: "Выберите компанию в верхнем переключателе, чтобы использовать ассистента.",
            debugSource: payload.source || null,
            debugDetails: payload.debug || null,
          });
          return;
        }

        setAccess({
          status: "ready",
          role: payload.role || profile?.role || null,
          message: null,
          debugSource: payload.source || null,
          debugDetails: payload.debug || null,
        });
      } catch (error) {
        if (cancelled) return;
        setServerContext(null);
        setAccess({
          status: "error",
          role: profile?.role || null,
          message:
            error instanceof Error && error.message === "SESSION_EXPIRED"
              ? "Сессия истекла. Обновите страницу и войдите снова."
              : "Не удалось загрузить контекст ассистента.",
          debugSource: null,
          debugDetails: null,
        });
      }
    }

    void loadServerContext();
    return () => {
      cancelled = true;
    };
  }, [enabled, profile?.role, profile?.role_is_legacy_alias, user?.id]);

  const runtimeContext = useMemo<AssistantRuntimeUiContext>(() => {
    const routeSeason = cleanString(contextFromRoute.season) || cleanString(contextFromRoute.year);
    const season = cleanString(serverContext?.season) || routeSeason;
    const entity = manualEntity || detectEntityFromPath(pathname);

    const companyId =
      access.status === "ready"
        ? cleanString(serverContext?.company?.id) ||
          (profile?.role === "global_admin" ? cleanString(profile?.context_company_id) : cleanString(profile?.company_id))
        : null;

    const companyName = access.status === "ready" ? cleanString(serverContext?.company?.name) : null;

    return {
      currentPage: pathname.split("/").filter(Boolean)[0] || "dashboard",
      currentRoute: pathname,
      entity,
      selectedRows,
      filters: { ...contextFromRoute, ...manualFilters },
      season,
      companyId: companyId || null,
      companyName: companyName || null,
      locale: language || "ru",
    };
  }, [
    pathname,
    manualEntity,
    selectedRows,
    contextFromRoute,
    manualFilters,
    serverContext?.season,
    serverContext?.company?.id,
    serverContext?.company?.name,
    access.status,
    profile?.role,
    profile?.context_company_id,
    profile?.company_id,
    language,
  ]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const openDebugMonitor = useCallback(() => setDebugMonitorOpen(true), []);
  const closeDebugMonitor = useCallback(() => setDebugMonitorOpen(false), []);
  const toggleDebugMonitor = useCallback(() => setDebugMonitorOpen((prev) => !prev), []);
  const handleSetDebugMonitorCollapsed = useCallback((collapsed: boolean) => setDebugMonitorCollapsed(Boolean(collapsed)), []);
  const handleSetDebugSnapshot = useCallback((snapshot: AssistantDebugMetadata | null) => setDebugSnapshot(snapshot), []);

  const value = useMemo<AssistantShellContextValue>(
    () => ({
      enabled,
      isOpen,
      open,
      close,
      toggle,
      runtimeContext,
      session,
      access,
      debugMonitorEnabled,
      debugMonitorOpen,
      debugMonitorCollapsed,
      debugSnapshot,
      setContextEntity: setManualEntity,
      setSelectedRows,
      setManualFilters,
      openDebugMonitor,
      closeDebugMonitor,
      toggleDebugMonitor,
      setDebugMonitorCollapsed: handleSetDebugMonitorCollapsed,
      setDebugSnapshot: handleSetDebugSnapshot,
    }),
    [
      enabled,
      isOpen,
      open,
      close,
      toggle,
      runtimeContext,
      session,
      access,
      debugMonitorEnabled,
      debugMonitorOpen,
      debugMonitorCollapsed,
      debugSnapshot,
      openDebugMonitor,
      closeDebugMonitor,
      toggleDebugMonitor,
      handleSetDebugMonitorCollapsed,
      handleSetDebugSnapshot,
    ]
  );

  return <AssistantShellContext.Provider value={value}>{children}</AssistantShellContext.Provider>;
}

export function useAssistantShell() {
  const ctx = useContext(AssistantShellContext);
  if (!ctx) {
    throw new Error("useAssistantShell must be used within AssistantShellProvider");
  }
  return ctx;
}
