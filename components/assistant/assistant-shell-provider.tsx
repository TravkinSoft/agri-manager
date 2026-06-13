"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import type { AssistantContextEntity, AssistantRuntimeUiContext, AssistantSessionMeta } from "@/lib/assistant/shell";
import { canUseAssistantShell } from "@/lib/assistant/shell";
import type { AssistantDebugMetadata } from "@/lib/assistant/debug-types";
import { normalizeRouteKeyFromPath } from "@/lib/assistant/route-registry";

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
  panelWidth: number;
  setContextEntity: (entity: AssistantContextEntity | null) => void;
  setSelectedRows: (rows: string[]) => void;
  setManualFilters: (filters: Record<string, string | string[]>) => void;
  setPanelWidth: (width: number) => void;
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

const DEFAULT_ASSISTANT_SEASON = "2026";
const DEFAULT_ASSISTANT_PANEL_WIDTH = 520;
const MIN_ASSISTANT_PANEL_WIDTH = 360;
const MAX_ASSISTANT_PANEL_WIDTH = 920;

function clampAssistantPanelWidth(width: unknown): number {
  const parsed = typeof width === "number" ? width : Number(width);
  if (!Number.isFinite(parsed)) return DEFAULT_ASSISTANT_PANEL_WIDTH;
  return Math.min(MAX_ASSISTANT_PANEL_WIDTH, Math.max(MIN_ASSISTANT_PANEL_WIDTH, Math.round(parsed)));
}

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
  const readableMessages: Record<string, string> = {
    COMPANY_CONTEXT_REQUIRED: "Выберите компанию в верхнем переключателе, чтобы использовать ассистента.",
    COMPANY_CONTEXT_MISSING: "Компания для текущего пользователя не настроена. Обратитесь к администратору.",
    COMPANY_CONTEXT_INVALID: "Контекст компании поврежден. Выберите компанию заново в верхнем переключателе.",
    COMPANY_CONTEXT_MISMATCH: "Запрошенный контекст компании не совпадает с вашим доступом.",
    ROLE_FORBIDDEN: "Для вашей роли ассистент недоступен.",
    ROLE_LEGACY_ALIAS: "Обнаружена устаревшая роль пользователя. Обновите роль через администратора.",
    AUTH_MISSING: "Сессия истекла. Обновите страницу и войдите снова.",
    AUTH_INVALID: "Сессия истекла. Обновите страницу и войдите снова.",
    PROFILE_NOT_FOUND: "Профиль пользователя не найден. Обратитесь к администратору.",
    PROFILE_INACTIVE: "Профиль пользователя неактивен.",
    ROLE_UNKNOWN: "Роль пользователя не распознана. Доступ к ассистенту закрыт.",
  };
  if (code && readableMessages[code]) return readableMessages[code];
  return fallback || "Не удалось определить контекст ассистента.";

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
  const [panelWidth, setPanelWidthState] = useState(DEFAULT_ASSISTANT_PANEL_WIDTH);
  const [manualEntity, setManualEntity] = useState<AssistantContextEntity | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [manualFilters, setManualFilters] = useState<Record<string, string | string[]>>({});
  const [session, setSession] = useState<AssistantSessionMeta>(() => ({
    sessionId: createSessionId(),
    updatedAt: new Date().toISOString(),
  }));

  const [serverContext, setServerContext] = useState<AssistantServerContextPayload | null>(null);
  const initialAccessMessage = enabled
    ? "Загрузка контекста ассистента..."
    : profile?.role_is_legacy_alias
      ? "Обнаружена устаревшая роль пользователя. Обновите роль через администратора."
      : "Ассистент недоступен для текущей роли.";
  const [access, setAccess] = useState<AssistantAccessState>({
    status: enabled ? "loading" : "denied",
    role: profile?.role || null,
    message: initialAccessMessage,
    debugSource: null,
    debugDetails: null,
  });

  const contextFromRoute = useMemo(() => {
    const filters: Record<string, string | string[]> = {};
    searchParams?.forEach((value, key) => {
      if (key in filters) {
        const current = filters[key];
        filters[key] = Array.isArray(current) ? [...current, value] : [current, value];
      } else {
        filters[key] = value;
      }
    });
    return filters;
  }, [searchParams]);

  const shellStorageKey = useMemo(() => storageKey(user?.id, profile?.company_id || null), [user?.id, profile?.company_id]);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    setStorageHydrated(false);
    setHydratedStorageKey(shellStorageKey);
    if (!shellStorageKey) {
      setStorageHydrated(true);
      return;
    }
    try {
      const raw = localStorage.getItem(shellStorageKey);
      if (!raw) {
        setStorageHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw) as {
        isOpen?: boolean;
        debugMonitorOpen?: boolean;
        debugMonitorCollapsed?: boolean;
        sessionId?: string;
        selectedRows?: string[];
        manualFilters?: Record<string, string | string[]>;
        panelWidth?: number;
      };
      if (typeof parsed.isOpen === "boolean") setIsOpen(parsed.isOpen);
      if (typeof parsed.debugMonitorOpen === "boolean") setDebugMonitorOpen(parsed.debugMonitorOpen);
      if (typeof parsed.debugMonitorCollapsed === "boolean") setDebugMonitorCollapsed(parsed.debugMonitorCollapsed);
      if (parsed.sessionId) setSession({ sessionId: parsed.sessionId, updatedAt: new Date().toISOString() });
      if (Array.isArray(parsed.selectedRows)) setSelectedRows(parsed.selectedRows.map(String));
      if (parsed.manualFilters && typeof parsed.manualFilters === "object") setManualFilters(parsed.manualFilters);
      if (parsed.panelWidth != null) setPanelWidthState(clampAssistantPanelWidth(parsed.panelWidth));
    } catch {
      // Ignore malformed local storage payload.
    } finally {
      setStorageHydrated(true);
    }
  }, [shellStorageKey]);

  useEffect(() => {
    if (!shellStorageKey || !storageHydrated || hydratedStorageKey !== shellStorageKey) return;
    const payload = {
      isOpen,
      debugMonitorOpen,
      debugMonitorCollapsed,
      sessionId: session.sessionId,
      selectedRows,
      manualFilters,
      panelWidth,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(shellStorageKey, JSON.stringify(payload));
  }, [
    shellStorageKey,
    storageHydrated,
    hydratedStorageKey,
    isOpen,
    debugMonitorOpen,
    debugMonitorCollapsed,
    session.sessionId,
    selectedRows,
    manualFilters,
    panelWidth,
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
    const routeParts = pathname.split("/").filter(Boolean);
    const currentPage = routeParts[0] || "dashboard";
    const currentModule = normalizeRouteKeyFromPath(pathname);
    const routeSeason = cleanString(contextFromRoute.season) || cleanString(contextFromRoute.year);
    const season = cleanString(serverContext?.season) || routeSeason || DEFAULT_ASSISTANT_SEASON;
    const entity = manualEntity || detectEntityFromPath(pathname);
    const selectedEntityType = cleanString(entity?.type);
    const selectedEntityId = cleanString(entity?.id);
    const mergedFilters = { ...contextFromRoute, ...manualFilters };
    const selectedFieldId =
      cleanString((mergedFilters as Record<string, unknown>).field) ||
      cleanString((mergedFilters as Record<string, unknown>).fieldId) ||
      (selectedEntityType === "field" ? selectedEntityId : null);
    const selectedFieldLabel =
      cleanString((mergedFilters as Record<string, unknown>).fieldLabel) ||
      (selectedEntityType === "field" ? cleanString(entity?.label) : null);
    const selectedWarehouseId =
      cleanString((mergedFilters as Record<string, unknown>).warehouse) ||
      cleanString((mergedFilters as Record<string, unknown>).warehouseId) ||
      (selectedEntityType === "warehouse" ? selectedEntityId : null);
    const selectedWarehouseLabel =
      cleanString((mergedFilters as Record<string, unknown>).warehouseLabel) ||
      (selectedEntityType === "warehouse" ? cleanString(entity?.label) : null);
    const selectedCropStructureSectionId =
      cleanString((mergedFilters as Record<string, unknown>).cropStructureId) ||
      cleanString((mergedFilters as Record<string, unknown>).crop_structure_id) ||
      cleanString((mergedFilters as Record<string, unknown>).sectionId) ||
      cleanString((mergedFilters as Record<string, unknown>).structureId) ||
      (selectedEntityType === "crop_structure_line" ? selectedEntityId : null);
    const selectedCropStructureSectionLabel =
      cleanString((mergedFilters as Record<string, unknown>).cropStructureLabel) ||
      cleanString((mergedFilters as Record<string, unknown>).sectionLabel) ||
      (selectedEntityType === "crop_structure_line" ? cleanString(entity?.label) : null);
    const selectedOperationId =
      cleanString((mergedFilters as Record<string, unknown>).operationId) ||
      cleanString((mergedFilters as Record<string, unknown>).operation_id) ||
      (selectedEntityType === "operation" ? selectedEntityId : null);
    const selectedOperationLabel =
      cleanString((mergedFilters as Record<string, unknown>).operationLabel) ||
      (selectedEntityType === "operation" ? cleanString(entity?.label) : null);
    const selectedTicketId =
      cleanString((mergedFilters as Record<string, unknown>).ticketId) ||
      cleanString((mergedFilters as Record<string, unknown>).ticket_id) ||
      (selectedEntityType === "ticket" ? selectedEntityId : null);
    const selectedTicketLabel =
      cleanString((mergedFilters as Record<string, unknown>).ticketNo) ||
      cleanString((mergedFilters as Record<string, unknown>).ticketLabel) ||
      (selectedEntityType === "ticket" ? cleanString(entity?.label) : null);
    const selectedBatchId =
      cleanString((mergedFilters as Record<string, unknown>).batchId) ||
      cleanString((mergedFilters as Record<string, unknown>).batch_id) ||
      (selectedEntityType === "batch" ? selectedEntityId : null);
    const selectedBatchLabel =
      cleanString((mergedFilters as Record<string, unknown>).batchCode) ||
      cleanString((mergedFilters as Record<string, unknown>).batchLabel) ||
      (selectedEntityType === "batch" ? cleanString(entity?.label) : null);
    const selectedCrop =
      cleanString((mergedFilters as Record<string, unknown>).crop) ||
      cleanString((mergedFilters as Record<string, unknown>).culture) ||
      cleanString((mergedFilters as Record<string, unknown>).variety) ||
      null;

    const companyId =
      access.status === "ready"
        ? cleanString(serverContext?.company?.id) ||
          (profile?.role === "global_admin" ? cleanString(profile?.context_company_id) : cleanString(profile?.company_id))
        : null;

    const companyName = access.status === "ready" ? cleanString(serverContext?.company?.name) : null;

    return {
      currentPage,
      currentRoute: pathname,
      currentModule,
      entity,
      selectedRows,
      filters: mergedFilters,
      season,
      defaultSeason: DEFAULT_ASSISTANT_SEASON,
      companyId: companyId || null,
      companyName: companyName || null,
      userId: user?.id || null,
      userRole: profile?.role || null,
      selectedEntityType,
      selectedEntityId,
      selectedFieldId,
      selectedFieldLabel,
      selectedWarehouseId,
      selectedWarehouseLabel,
      selectedCropStructureSectionId,
      selectedCropStructureSectionLabel,
      selectedOperationId,
      selectedOperationLabel,
      selectedTicketId,
      selectedTicketLabel,
      selectedBatchId,
      selectedBatchLabel,
      selectedCrop,
      language: language || "ru",
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
    user?.id,
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
  const setPanelWidth = useCallback((width: number) => {
    setPanelWidthState(clampAssistantPanelWidth(width));
  }, []);

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
      panelWidth,
      setContextEntity: setManualEntity,
      setSelectedRows,
      setManualFilters,
      setPanelWidth,
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
      panelWidth,
      setPanelWidth,
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
