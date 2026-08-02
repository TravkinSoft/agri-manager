"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  AudioLines,
  Bot,
  Clock3,
  Compass,
  Download,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
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
import type {
  AssistantDraftCard,
  AssistantGenericDraftCard,
  AssistantDraftMaterialLine,
  AssistantDraftTankLine,
  AssistantOperationDraftCard,
} from "@/lib/assistant/draft-cards";
import { resolveRouteEntryByPath } from "@/lib/assistant/route-registry";
import { buildAssistantChatExport } from "@/lib/assistant/export/chat-export";
import { localizeUnit } from "@/lib/i18n/helpers";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

type AssistantChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  createdAt: string;
  actions?: AssistantActionButton[];
  draftCards?: AssistantDraftCard[];
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
  actionType?: "navigate" | "open_module" | "continue_draft" | "prepare_draft" | string;
  targetRoute?: string | null;
  requiresConfirmation?: boolean;
  payload?: Record<string, unknown>;
};

type AssistantActionReceipt = {
  id: string;
  actionId: string;
  actionType: string;
  status: "prepared" | "executed" | "failed" | "blocked";
  targetRoute: string | null;
  message: string;
  error: string | null;
  executedAt: string;
  clientVerified: boolean;
};

type AssistantThread = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

function isOperationDraftCard(card: AssistantDraftCard): card is AssistantOperationDraftCard {
  return card.kind === "operation";
}

type AssistantMemoryRecord = {
  id: string;
  scope: string;
  category: string;
  memory_key: string;
  value: string;
  confidence: number | null;
  source: string | null;
  active: boolean;
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
  lastOperation: string | null;
  lastOperationId: string | null;
  lastOperationLabel: string | null;
  lastTicket: string | null;
  lastTicketId: string | null;
  lastTicketLabel: string | null;
  lastCropStructureSection: string | null;
  lastCropStructureSectionId: string | null;
  lastCropStructureSectionLabel: string | null;
  lastBatch: string | null;
  lastBatchId: string | null;
  lastBatchLabel: string | null;
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
  focusEntityType: string | null;
  focusEntityId: string | null;
  focusEntityLabel: string | null;
  focusModule: string | null;
  focusRoute: string | null;
  focusSource: string | null;
  focusUpdatedAt: string | null;
  pendingActionType: string | null;
  pendingActionSummary: string | null;
  pendingActionRoute: string | null;
  pendingActionPayloadJson: string | null;
  pendingActionUpdatedAt: string | null;
  lastActionType: string | null;
  lastActionSummary: string | null;
  lastActionAt: string | null;
};

type ReadOnlyThreadStatePayload = {
  threadId: string;
  selectedFieldId: string | null;
  selectedFieldLabel: string | null;
  selectedWarehouseId: string | null;
  selectedOperationId: string | null;
  selectedCropStructureLineId: string | null;
  lastIntent: string | null;
  lastSuccessfulTool: string | null;
  unresolvedQuestion: string | null;
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
      entityType: "warehouse" | "field" | "fuel" | "operation" | "ticket" | "crop_structure_line" | "batch";
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
  threadState?: Partial<ReadOnlyThreadStatePayload>;
  threadId?: string | null;
  messageIds?: {
    assistant?: string | null;
  };
  navigationActions?: AssistantNavigationActionPayload[];
  actions?: AssistantActionButton[];
  draftCards?: AssistantDraftCard[];
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
    memoryWrite?: {
      action?: "save" | "delete" | "noop";
      savedCount?: number;
      deletedCount?: number;
      provenance?: string | null;
      ids?: string[];
      skippedReason?: string | null;
      warning?: string | null;
    };
  };
  debug?: AssistantDebugMetadata;
  error?: string;
  code?: string;
};

type AssistantQuickPrompt = {
  label: string;
  prompt: string;
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
  lastOperation: null,
  lastOperationId: null,
  lastOperationLabel: null,
  lastTicket: null,
  lastTicketId: null,
  lastTicketLabel: null,
  lastCropStructureSection: null,
  lastCropStructureSectionId: null,
  lastCropStructureSectionLabel: null,
  lastBatch: null,
  lastBatchId: null,
  lastBatchLabel: null,
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
  focusEntityType: null,
  focusEntityId: null,
  focusEntityLabel: null,
  focusModule: null,
  focusRoute: null,
  focusSource: null,
  focusUpdatedAt: null,
  pendingActionType: null,
  pendingActionSummary: null,
  pendingActionRoute: null,
  pendingActionPayloadJson: null,
  pendingActionUpdatedAt: null,
  lastActionType: null,
  lastActionSummary: null,
  lastActionAt: null,
};

function emptyThreadState(threadId: string): ReadOnlyThreadStatePayload {
  return {
    threadId,
    selectedFieldId: null,
    selectedFieldLabel: null,
    selectedWarehouseId: null,
    selectedOperationId: null,
    selectedCropStructureLineId: null,
    lastIntent: null,
    lastSuccessfulTool: null,
    unresolvedQuestion: null,
  };
}

const TOOL_LOADING_STEPS = ["Смотрю контекст...", "Проверяю источники...", "Собираю короткий ответ..."] as const;

const MAX_CACHED_MESSAGES = 80;

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

function compactContextLabel(value: string | null | undefined, fallback: string): string {
  const text = String(value || "").trim();
  return text || fallback;
}

function dedupeQuickPrompts(prompts: AssistantQuickPrompt[]): AssistantQuickPrompt[] {
  const seen = new Set<string>();
  return prompts.filter((item) => {
    const key = `${item.label}:${item.prompt}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  if (action.entityId) {
    if (action.entityType === "warehouse" && !filters.warehouseId) filters.warehouseId = action.entityId;
    if (action.entityType === "field" && !filters.fieldId) filters.fieldId = action.entityId;
    if (action.entityType === "operation" && !filters.operationId) filters.operationId = action.entityId;
    if (action.entityType === "ticket" && !filters.ticketId) filters.ticketId = action.entityId;
    if (action.entityType === "crop_structure_line") {
      if (!filters.cropStructureId) filters.cropStructureId = action.entityId;
      if (!filters.sectionId) filters.sectionId = action.entityId;
    }
    if (action.entityType === "batch" && !filters.batchId) filters.batchId = action.entityId;
  }
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

const ASSISTANT_ROLE_ROUTE_ALLOWLIST: Record<string, string[]> = {
  company_admin: ["/dashboard", "/fields", "/crop-structure", "/operations", "/warehouses", "/warehouses/manage", "/weighbridge", "/analytics", "/references", "/users", "/settings"],
  agronomist: ["/dashboard", "/fields", "/crop-structure", "/operations", "/warehouses", "/analytics", "/references"],
  director: ["/dashboard", "/fields", "/crop-structure", "/operations", "/warehouses", "/weighbridge", "/analytics", "/references"],
  specialist: ["/dashboard", "/tasks"],
  brigadier: ["/dashboard", "/operations", "/fields"],
  warehouse: ["/dashboard", "/warehouses", "/inventory", "/warehouses/transactions", "/warehouses/requests"],
  warehouse_operator: ["/dashboard", "/weighbridge", "/warehouses", "/inventory", "/warehouses/transactions", "/warehouses/requests"],
  weighman: ["/weighbridge", "/warehouses", "/ledger"],
  legal_operator: ["/dashboard", "/fields", "/analytics"],
  fuel_operator: ["/dashboard"],
};

const ASSISTANT_FULL_NAV_ROLES = new Set(["global_admin"]);

function routePathOnly(route: string | null): string {
  if (!route) return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(route, origin).pathname;
}

function isRouteAllowedForRole(role: string | null, route: string | null): boolean {
  const normalizedRole = String(role || "").toLowerCase();
  if (!normalizedRole || ASSISTANT_FULL_NAV_ROLES.has(normalizedRole)) return true;
  const allowedRoutes = ASSISTANT_ROLE_ROUTE_ALLOWLIST[normalizedRole];
  if (!allowedRoutes) return true;

  const path = routePathOnly(route);
  return allowedRoutes.some((allowed) => matchRoutePath(path, allowed));
}

function assertRouteAllowedForRole(role: string | null, route: string | null) {
  if (isRouteAllowedForRole(role, route)) return;
  const path = routePathOnly(route) || "route";
  throw new Error(`Роль ${role || "не определена"} не имеет доступа к ${path}`);
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
        current.searchParams.get("fieldId") === entityId ||
        current.searchParams.get("operationId") === entityId ||
        current.searchParams.get("ticketId") === entityId ||
        current.searchParams.get("cropStructureId") === entityId ||
        current.searchParams.get("sectionId") === entityId ||
        current.searchParams.get("batchId") === entityId;
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

function actionButtonToNavigationAction(
  action: AssistantActionButton,
  targetRoute: string,
  filters: Record<string, string>
): AssistantNavigationActionPayload {
  const page = String(action.payload?.page || action.id || "assistant_action");
  if (Object.keys(filters).length > 0) {
    return {
      type: "open_page_with_filter",
      page,
      route: targetRoute,
      filters,
    };
  }
  return {
    type: "open_page",
    page,
    route: targetRoute,
  };
}

function actionReceiptToMessage(receipt: AssistantActionReceipt): AssistantChatMessage {
  return {
    id: receipt.id,
    role: "assistant",
    content: receipt.message,
    createdAt: receipt.executedAt,
    meta: {
      mode: "action_receipt",
      toolActivity: [
        `${receipt.actionType}:${receipt.status}`,
        receipt.targetRoute ? `route:${receipt.targetRoute}` : "",
        receipt.error ? `error:${receipt.error}` : "",
      ].filter(Boolean),
    },
  };
}

function formatDraftNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function formatDraftQuantity(value: number | null | undefined, unit: string | null | undefined): string {
  const displayUnit = localizeUnit(unit || "", "ru") || unit || "";
  if (value == null || !Number.isFinite(value)) return displayUnit;
  return `${formatDraftNumber(value)}${displayUnit ? ` ${displayUnit}` : ""}`;
}

function recalculateDraftLines<T extends AssistantDraftMaterialLine | AssistantDraftTankLine>(
  rows: T[],
  areaHa: number | null,
  sprayVolumeLHa?: number | null
): T[] {
  return rows.map((row) => {
    if ("ratePerHa" in row) {
      const nextQty = areaHa != null && row.ratePerHa != null ? Number((areaHa * row.ratePerHa).toFixed(4)) : row.requiredQty;
      return {
        ...row,
        requiredQty: nextQty,
        calculation:
          areaHa != null && row.ratePerHa != null && row.unit
            ? `${formatDraftNumber(row.ratePerHa)} × ${formatDraftNumber(areaHa)} = ${formatDraftNumber(nextQty)} ${localizeUnit(row.unit, "ru")}`
            : row.calculation,
      };
    }
    if (row.id === "tank_water" && areaHa != null && sprayVolumeLHa != null) {
      return { ...row, quantity: Number((areaHa * sprayVolumeLHa).toFixed(2)) };
    }
    return row;
  });
}

function patchDraftConfirmBody(card: AssistantOperationDraftCard, patch: Record<string, unknown>): AssistantOperationDraftCard {
  return {
    ...card,
    confirm: {
      ...card.confirm,
      body: {
        ...card.confirm.body,
        ...patch,
      },
    },
  };
}

type AssistantDraftEditCommand = {
  areaHa?: number | null;
  date?: string | null;
  comment?: string | null;
  removeMaterial?: string | null;
  replaceMaterial?: { from: string; to: string } | null;
  restore?: boolean;
  labels: string[];
};

function normalizeDraftEditText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,;:()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDraftDate(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (!match) return null;
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : String(new Date().getFullYear());
  return `${year}-${month}-${day}`;
}

function parseDraftEditCommand(text: string): AssistantDraftEditCommand | null {
  const source = text.trim();
  const lower = normalizeDraftEditText(source);
  const labels: string[] = [];
  const command: AssistantDraftEditCommand = { labels };

  if (/(верни|восстанови|продолжи|вернуть|возобнови).*(черновик|план|карточк)/i.test(source)) {
    command.restore = true;
    labels.push("вернул черновик в работу");
  }

  const areaMatch = source.match(/(?:площадь|площадку|га|на)\s*(?:на|=|:)?\s*(\d+(?:[,.]\d+)?)\s*(?:га|ha)\b/i);
  if (areaMatch) {
    const areaHa = Number(areaMatch[1].replace(",", "."));
    if (Number.isFinite(areaHa) && areaHa > 0) {
      command.areaHa = areaHa;
      labels.push(`площадь ${formatDraftNumber(areaHa)} га`);
    }
  }

  const dateMatch =
    source.match(/(?:дат[ау]|перенеси|поставь)\s*(?:на|=|:)?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/i) ||
    source.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const date = parseDraftDate(dateMatch?.[1] || null);
  if (date) {
    command.date = date;
    labels.push(`дата ${date}`);
  }

  const replaceMatch = source.match(/(?:замени|поменяй)\s+(.+?)\s+(?:на|->)\s+(.+?)(?:\s+в\s+черновике|\s+в\s+карточке|$)/i);
  if (replaceMatch) {
    const from = replaceMatch[1].trim();
    const to = replaceMatch[2].trim();
    if (from && to) {
      command.replaceMaterial = { from, to };
      labels.push(`замена ${from} → ${to}`);
    }
  }

  const removeMatch = source.match(/(?:убери|удали|исключи)\s+(.+?)(?:\s+из\s+черновика|\s+из\s+карточки|$)/i);
  if (removeMatch) {
    const removeMaterial = removeMatch[1].trim();
    if (removeMaterial) {
      command.removeMaterial = removeMaterial;
      labels.push(`убрал ${removeMaterial}`);
    }
  }

  const commentMatch = source.match(/(?:комментарий|коммент|примечание)\s*(?:=|:|-)\s*(.+)$/i);
  if (commentMatch?.[1]) {
    command.comment = commentMatch[1].trim();
    labels.push("обновил комментарий");
  }

  const looksLikeDraftEdit =
    labels.length > 0 &&
    (/(черновик|карточк|план|площадь|убери|удали|исключи|замени|поменяй|коммент|дат[ау])/i.test(source) ||
      lower.startsWith("убери ") ||
      lower.startsWith("замени "));
  return looksLikeDraftEdit ? command : null;
}

function materialConfirmRowsFromDraft(materials: AssistantDraftMaterialLine[]): Array<Record<string, unknown>> {
  return materials.map((item) => ({
    product: item.name,
    product_name: item.name,
    rate_per_ha: item.ratePerHa,
    unit: item.unit,
  }));
}

function rebuildTankTotalsFromMaterials(
  materials: AssistantDraftMaterialLine[],
  currentTankTotals: AssistantDraftTankLine[],
  areaHa: number | null,
  sprayVolumeLHa: number | null
): AssistantDraftTankLine[] {
  const materialRows = materials
    .filter((item) => item.requiredQty != null)
    .map((item) => ({
      id: `tank_${item.id}`,
      name: item.name,
      quantity: item.requiredQty,
      unit: item.unit,
    }));
  const water = currentTankTotals.find((row) => row.id === "tank_water");
  if (!water && (areaHa == null || sprayVolumeLHa == null)) return materialRows;
  return [
    ...materialRows,
    {
      id: "tank_water",
      name: "Вода",
      quantity: areaHa != null && sprayVolumeLHa != null ? Number((areaHa * sprayVolumeLHa).toFixed(2)) : water?.quantity ?? null,
      unit: water?.unit || "л",
    },
  ];
}

function applyDraftEditCommandToCard(
  card: AssistantOperationDraftCard,
  command: AssistantDraftEditCommand
): { card: AssistantOperationDraftCard; labels: string[]; warnings: string[] } {
  const labels = [...command.labels];
  const warnings: string[] = [];
  const nextArea = command.areaHa !== undefined ? command.areaHa : card.areaHa;
  const nextDate = command.date !== undefined ? command.date : card.date;
  const nextComment = command.comment !== undefined ? command.comment : card.comment;
  let nextMaterials = recalculateDraftLines(card.materials, nextArea);

  if (command.removeMaterial) {
    const target = normalizeDraftEditText(command.removeMaterial);
    const before = nextMaterials.length;
    nextMaterials = nextMaterials.filter((item) => !normalizeDraftEditText(item.name).includes(target));
    if (nextMaterials.length === before) warnings.push(`Не нашёл материал “${command.removeMaterial}” в черновике.`);
  }

  if (command.replaceMaterial) {
    const target = normalizeDraftEditText(command.replaceMaterial.from);
    let replaced = false;
    nextMaterials = nextMaterials.map((item) => {
      if (!normalizeDraftEditText(item.name).includes(target)) return item;
      replaced = true;
      return {
        ...item,
        name: command.replaceMaterial?.to || item.name,
      };
    });
    if (!replaced) warnings.push(`Не нашёл материал “${command.replaceMaterial.from}” для замены.`);
  }

  const nextTankTotals = rebuildTankTotalsFromMaterials(nextMaterials, card.tankTotals, nextArea, card.sprayVolumeLHa);
  const updated = patchDraftConfirmBody(
    {
      ...card,
      status: "draft",
      collapsed: false,
      areaHa: nextArea,
      date: nextDate,
      comment: nextComment,
      materials: nextMaterials,
      tankTotals: nextTankTotals,
      error: warnings.length ? warnings.join(" ") : null,
    },
    {
      planned_area_ha: nextArea,
      date: nextDate,
      notes: nextComment,
      materials: materialConfirmRowsFromDraft(nextMaterials),
    }
  );

  return { card: updated, labels, warnings };
}

function formatThreadDate(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function memoryCategoryLabel(category: string): string {
  switch (category) {
    case "communication_preference":
      return "Стиль общения";
    case "workflow_preference":
      return "Рабочая привычка";
    case "user_identity":
      return "Пользователь";
    case "assistant_goal":
      return "Цель ассиста";
    case "explicit_note":
      return "Заметка";
    default:
      return category || "Память";
  }
}

function rolePermissionsLabel(role: string | null): string {
  const value = String(role || "").toLowerCase();
  if (value === "global_admin" || value === "company_admin") return "Расширенный read-only + debug";
  return "Read-only operational scope";
}

function isProductionAssistantMessage(message: Pick<AssistantChatMessage, "content" | "actions" | "meta">): boolean {
  return !hasQaDataMarker(`${message.content || ""} ${JSON.stringify(message.actions || [])} ${JSON.stringify(message.meta || {})}`);
}

const INTERNAL_ASSISTANT_LINE_PATTERNS = [
  /PLAN\/FACT control/i,
  /Source of Truth contract/i,
  /Source of Truth mismatch/i,
  /Working Memory rule/i,
  /Router fallback/i,
  /crop_structure is PLAN/i,
  /Do not merge them without labels/i,
  /Do not choose one conflicting figure silently/i,
  /Detected area mismatch/i,
];

function stripInternalAssistantLines(content: string): string {
  return String(content || "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_ASSISTANT_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeAssistantAnswer(content: string): string {
  const cleaned = stripInternalAssistantLines(content);
  if (!hasQaDataMarker(cleaned)) return cleaned || "Данных недостаточно, чтобы подтвердить ответ.";
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
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "history" | "settings">("chat");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [threadStates, setThreadStates] = useState<Record<string, ReadOnlyThreadStatePayload>>({});
  const [lastMode, setLastMode] = useState<string>("erp_data");
  const [, setActionReceipts] = useState<AssistantActionReceipt[]>([]);
  const [confirmingDraftId, setConfirmingDraftId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [expandedDraftRecommendations, setExpandedDraftRecommendations] = useState<Record<string, boolean>>({});
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [memoryRecords, setMemoryRecords] = useState<AssistantMemoryRecord[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [memoryBusyId, setMemoryBusyId] = useState<string | null>(null);
  const [memoryWarning, setMemoryWarning] = useState<string | null>(null);
  const memoryLoadAbortRef = useRef<AbortController | null>(null);
  const memoryLoadSequenceRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
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
  const updateJumpToBottomVisibility = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || activeTab !== "chat") {
      setShowJumpToBottom(false);
      return;
    }

    const bottomGap = container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldShow = bottomGap > 120 && messages.length > 0;
    setShowJumpToBottom((current) => (current === shouldShow ? current : shouldShow));
  }, [activeTab, messages.length]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current;
    if (container) {
      const applyScroll = () => {
        if (behavior === "auto") {
          container.scrollTop = container.scrollHeight;
          return;
        }
        container.scrollTo({ top: container.scrollHeight, behavior });
      };
      applyScroll();
      if (behavior === "auto") {
        window.requestAnimationFrame(applyScroll);
        window.setTimeout(applyScroll, 40);
        window.setTimeout(applyScroll, 140);
      }
      setShowJumpToBottom(false);
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || activeTab !== "chat") return;
    container.addEventListener("scroll", updateJumpToBottomVisibility, { passive: true });
    updateJumpToBottomVisibility();
    return () => container.removeEventListener("scroll", updateJumpToBottomVisibility);
  }, [activeTab, updateJumpToBottomVisibility]);

  const disabledReason = useMemo(() => resolveDisabledReason(access), [access]);
  const resolvedCompanyId = useMemo(
    () => runtimeContext.companyId || profile?.context_company_id || profile?.company_id || null,
    [runtimeContext.companyId, profile?.context_company_id, profile?.company_id]
  );
  const loadingText = TOOL_LOADING_STEPS[loadingStepIndex % TOOL_LOADING_STEPS.length];
  const contextPills = useMemo(() => {
    const selected =
      runtimeContext.selectedFieldLabel ||
      runtimeContext.selectedWarehouseLabel ||
      runtimeContext.selectedOperationLabel ||
      runtimeContext.selectedTicketLabel ||
      runtimeContext.selectedBatchLabel ||
      runtimeContext.selectedCropStructureSectionLabel ||
      null;

    return [
      compactContextLabel(runtimeContext.companyName, "Компания не выбрана"),
      compactContextLabel(runtimeContext.season || runtimeContext.defaultSeason, "Сезон не выбран"),
      compactContextLabel(runtimeContext.currentModule || runtimeContext.currentPage, "Текущая страница"),
      compactContextLabel(access.role, "Роль не определена"),
      selected,
    ].filter(Boolean) as string[];
  }, [
    access.role,
    runtimeContext.companyName,
    runtimeContext.currentModule,
    runtimeContext.currentPage,
    runtimeContext.defaultSeason,
    runtimeContext.season,
    runtimeContext.selectedBatchLabel,
    runtimeContext.selectedCropStructureSectionLabel,
    runtimeContext.selectedFieldLabel,
    runtimeContext.selectedOperationLabel,
    runtimeContext.selectedTicketLabel,
    runtimeContext.selectedWarehouseLabel,
  ]);
  const quickPrompts = useMemo<AssistantQuickPrompt[]>(() => {
    const route = runtimeContext.currentRoute || "";
    const prompts: AssistantQuickPrompt[] = [];

    if (runtimeContext.selectedFieldLabel) {
      prompts.push({ label: runtimeContext.selectedFieldLabel, prompt: `Что по ${runtimeContext.selectedFieldLabel}?` });
    }
    if (runtimeContext.selectedWarehouseLabel) {
      prompts.push({ label: runtimeContext.selectedWarehouseLabel, prompt: `Что по складу ${runtimeContext.selectedWarehouseLabel}?` });
    }
    if (runtimeContext.selectedOperationLabel) {
      prompts.push({ label: "Операция", prompt: `Что по операции ${runtimeContext.selectedOperationLabel}?` });
    }

    if (route.includes("/tasks")) {
      prompts.push({ label: "Мои задачи", prompt: "Что мне делать сейчас?" });
    } else if (route.includes("/operations")) {
      prompts.push({ label: "В работе", prompt: "Какие операции в работе?" });
    } else if (route.includes("/warehouses")) {
      prompts.push({ label: "Остатки", prompt: "Остатки по складам" });
    } else if (route.includes("/weighbridge")) {
      prompts.push({ label: "Талоны", prompt: "Последние 3 талона" });
    } else if (route.includes("/crop-structure")) {
      prompts.push({ label: "Структура", prompt: "Что по структуре посевов?" });
    } else {
      prompts.push({ label: "Сводка", prompt: "Что важно сейчас?" });
    }

    prompts.push(
      { label: "Активные операции", prompt: "Покажи активные операции" },
      { label: "Остатки", prompt: "Остатки по складам" }
    );

    return dedupeQuickPrompts(prompts).slice(0, 4);
  }, [
    runtimeContext.currentRoute,
    runtimeContext.selectedFieldLabel,
    runtimeContext.selectedOperationLabel,
    runtimeContext.selectedWarehouseLabel,
  ]);

  const stopVoiceStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const applyQuickPrompt = useCallback(
    (prompt: string) => {
      setInput(prompt);
      setActiveTab("chat");
      focusInput();
    },
    [focusInput]
  );

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
    if (!storageKey) {
      setStorageHydrated(true);
      setHydratedStorageKey(null);
      return;
    }
    setStorageHydrated(false);
    setHydratedStorageKey(null);
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setActiveThreadId(null);
        setActiveTab("chat");
        setThreadStates({});
        setMessages([]);
        setInput("");
        setLastMode("erp_data");
        return;
      }
      const parsed = JSON.parse(raw) as {
        activeThreadId?: string | null;
        activeTab?: "chat" | "history" | "settings";
        threadStates?: Record<string, Partial<ReadOnlyThreadStatePayload>>;
        messages?: AssistantChatMessage[];
        input?: string;
        lastMode?: string;
      };
      if (parsed.activeThreadId) setActiveThreadId(String(parsed.activeThreadId));
      if (parsed.activeTab) setActiveTab(parsed.activeTab);
      if (parsed.threadStates && typeof parsed.threadStates === "object") {
        const validated: Record<string, ReadOnlyThreadStatePayload> = {};
        Object.entries(parsed.threadStates).forEach(([threadId, value]) => {
          if (!value || typeof value !== "object" || value.threadId !== threadId) return;
          validated[threadId] = { ...emptyThreadState(threadId), ...value, threadId };
        });
        setThreadStates(validated);
      }
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        setMessages(
          parsed.messages
            .filter(isProductionAssistantMessage)
            .slice(-MAX_CACHED_MESSAGES)
            .map((message) => ({ ...message, actions: undefined, draftCards: undefined }))
        );
      }
      if (typeof parsed.input === "string") setInput(parsed.input);
      if (typeof parsed.lastMode === "string") setLastMode(parsed.lastMode);
    } catch {
      // ignore malformed local storage payload
    } finally {
      setStorageHydrated(true);
      setHydratedStorageKey(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !storageHydrated || hydratedStorageKey !== storageKey) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        activeThreadId,
        activeTab,
        threadStates,
        messages: messages.filter(isProductionAssistantMessage).slice(-MAX_CACHED_MESSAGES),
        input,
        lastMode,
        updatedAt: new Date().toISOString(),
      })
    );
  }, [storageKey, storageHydrated, hydratedStorageKey, activeThreadId, activeTab, threadStates, messages, input, lastMode]);

  useEffect(() => {
    return () => stopVoiceStream();
  }, [stopVoiceStream]);

  useEffect(() => {
    if (!loading) return;
    setLoadingStepIndex(0);
    const id = window.setInterval(() => setLoadingStepIndex((prev) => prev + 1), 1300);
    return () => window.clearInterval(id);
  }, [loading]);

  useLayoutEffect(() => {
    const openedNow = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!isOpen || activeTab !== "chat") {
      setShowJumpToBottom(false);
      return;
    }

    if (openedNow) {
      scrollToBottom("auto");
      return;
    }

    if (showJumpToBottom && !loading) {
      updateJumpToBottomVisibility();
      return;
    }

    scrollToBottom();
  }, [
    activeTab,
    isOpen,
    loading,
    messages.length,
    messagesLoading,
    scrollToBottom,
    showJumpToBottom,
    storageHydrated,
    updateJumpToBottomVisibility,
  ]);

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
      const storedThreadState = [...(payload.messages || [])]
        .reverse()
        .map((message) => message.metadata?.read_only_thread_state)
        .find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
      if (storedThreadState && storedThreadState.threadId === threadId) {
        setThreadStates((previous) => ({
          ...previous,
          [threadId]: {
            ...emptyThreadState(threadId),
            ...(storedThreadState as Partial<ReadOnlyThreadStatePayload>),
            threadId,
          },
        }));
      }
      const nextMessages = (payload.messages || []).map((message) => {
        const metadata = (message.metadata || {}) as Record<string, unknown>;
        return {
          id: String(message.id),
          role: message.role || "assistant",
          content: String(message.content || ""),
          createdAt: String(message.created_at || new Date().toISOString()),
          actions: undefined,
          draftCards: undefined,
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
    setThreadStates((previous) => ({ ...previous, [created.id]: emptyThreadState(created.id) }));
    setLastMode("erp_data");
    return created.id;
  };

  useEffect(() => {
    if (!storageHydrated) return;
    if (access.status !== "ready" || !resolvedCompanyId) return;
    if (!isOpen && threads.length === 0) return;
    if (threads.length > 0) return;
    void loadThreads();
  }, [access.status, resolvedCompanyId, profile?.id, isOpen, threads.length, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) return;
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    void loadThreadMessages(activeThreadId);
  }, [activeThreadId, storageHydrated]);

  const recordActionReceipt = useCallback((receipt: AssistantActionReceipt) => {
    setActionReceipts((prev) => [receipt, ...prev].slice(0, 20));
    setMessages((prev) => [...prev, actionReceiptToMessage(receipt)]);
  }, []);

  const persistDraftCardsForMessage = useCallback(
    async (messageId: string, draftCards: AssistantDraftCard[]) => {
      if (!activeThreadId || !resolvedCompanyId || !messageId || !draftCards.length) return;
      try {
        const headers = await getAuthHeaders();
        await fetch(`/api/assistant/threads/${encodeURIComponent(activeThreadId)}/messages`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            companyId: resolvedCompanyId,
            messageId,
            metadata: {
              draft_cards: draftCards,
            },
          }),
        });
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.warn("Failed to persist assistant draft card state", error);
        }
      }
    },
    [activeThreadId, resolvedCompanyId]
  );

  const updateDraftCard = useCallback(
    (messageId: string, draftId: string, updater: (card: AssistantDraftCard) => AssistantDraftCard) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId || !message.draftCards?.length) return message;
          const draftCards = message.draftCards.map((card) => (card.id === draftId ? updater(card) : card));
          window.setTimeout(() => {
            void persistDraftCardsForMessage(messageId, draftCards);
          }, 0);
          return {
            ...message,
            draftCards,
          };
        })
      );
    },
    [persistDraftCardsForMessage]
  );

  const appendThreadMessage = useCallback(
    async (
      threadId: string | null,
      role: AssistantChatMessage["role"],
      content: string,
      metadata?: Record<string, unknown> | null
    ) => {
      if (!threadId || !resolvedCompanyId || !content.trim()) return;
      try {
        const headers = await getAuthHeaders();
        await fetch(`/api/assistant/threads/${encodeURIComponent(threadId)}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            companyId: resolvedCompanyId,
            role,
            content,
            metadata: metadata || null,
          }),
        });
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.warn("Failed to persist local assistant message", error);
        }
      }
    },
    [resolvedCompanyId]
  );

  const findLatestDraftCard = useCallback((): { messageId: string; card: AssistantDraftCard } | null => {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      const cards = message.draftCards || [];
      for (let cardIndex = cards.length - 1; cardIndex >= 0; cardIndex -= 1) {
        const card = cards[cardIndex];
        if (card.status === "confirmed" || card.status === "expired") continue;
        return { messageId: message.id, card };
      }
    }
    return null;
  }, [messages]);

  const setDraftCollapsed = useCallback(
    (messageId: string, draftId: string, collapsed: boolean) => {
      updateDraftCard(messageId, draftId, (card) => ({ ...card, collapsed }));
    },
    [updateDraftCard]
  );

  const restoreDraftCard = useCallback(
    (messageId: string, draftId: string) => {
      updateDraftCard(messageId, draftId, (card) => ({ ...card, status: "draft", collapsed: false, error: null }));
    },
    [updateDraftCard]
  );

  const cancelDraftCard = useCallback(
    (messageId: string, draftId: string) => {
      updateDraftCard(messageId, draftId, (card) => ({ ...card, status: "cancelled", collapsed: true, error: null }));
    },
    [updateDraftCard]
  );

  const startDraftChange = useCallback(
    (card: AssistantDraftCard) => {
      setEditingDraftId(card.id);
      setInput(
        isOperationDraftCard(card)
          ? `Измени черновик операции: ${card.operationType || "операция"}. `
          : `Измени черновик: ${card.title}. `
      );
      setActiveTab("chat");
      focusInput();
    },
    [focusInput]
  );

  const applyDraftQuickEdit = useCallback(
    (messageId: string, draftId: string, patch: { areaHa?: number | null; date?: string | null; comment?: string | null }) => {
      updateDraftCard(messageId, draftId, (card) => {
        if (!isOperationDraftCard(card)) return card;
        const nextArea = patch.areaHa !== undefined ? patch.areaHa : card.areaHa;
        const nextDate = patch.date !== undefined ? patch.date : card.date;
        const nextComment = patch.comment !== undefined ? patch.comment : card.comment;
        const nextMaterials = recalculateDraftLines(card.materials, nextArea);
        const materialTankRows = card.tankTotals.filter((row) => row.id !== "tank_water");
        const nextTankTotals = [
          ...recalculateDraftLines(materialTankRows, nextArea),
          ...recalculateDraftLines(card.tankTotals.filter((row) => row.id === "tank_water"), nextArea, card.sprayVolumeLHa),
        ];
        return patchDraftConfirmBody(
          {
            ...card,
            areaHa: nextArea,
            date: nextDate,
            comment: nextComment,
            materials: nextMaterials,
            tankTotals: nextTankTotals,
            error: null,
          },
          {
            planned_area_ha: nextArea,
            date: nextDate,
            notes: nextComment,
          }
        );
      });
      setEditingDraftId(null);
    },
    [updateDraftCard]
  );

  const confirmDraftCard = useCallback(
    async (messageId: string, card: AssistantOperationDraftCard) => {
      const error = "Подтверждение и любые действия записи отключены в Travkin Assistant V1.";
      updateDraftCard(messageId, card.id, (draft) => ({ ...draft, error, collapsed: false }));
      setRequestError(error);
    },
    [updateDraftCard]
  );

  const executeAction = async (action: AssistantActionButton) => {
    if (action.kind === "prompt") {
      if (action.prompt) setInput(action.prompt);
      recordActionReceipt({
        id: uid(),
        actionId: action.id,
        actionType: action.actionType || "prompt",
        status: "prepared",
        targetRoute: null,
        message:
          action.actionType === "continue_draft"
            ? "Продолжаю черновик. Заполните недостающие данные в сообщении."
            : "Подготовил продолжение в поле ввода.",
        error: null,
        executedAt: new Date().toISOString(),
        clientVerified: true,
      });
      setActiveTab("chat");
      focusInput();
      return;
    }
    setRequestError("Навигационные действия отключены в Travkin Assistant V1.");
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

      const response = await fetch("/api/assistant/query", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: text,
          threadId,
          runtimeContext: {
            currentPage: runtimeContext.currentPage,
            currentRoute: runtimeContext.currentRoute,
            currentModule: runtimeContext.currentModule,
            season: runtimeContext.season,
            defaultSeason: runtimeContext.defaultSeason,
            locale: runtimeContext.locale,
            selectedFieldId: runtimeContext.selectedFieldId,
            selectedWarehouseId: runtimeContext.selectedWarehouseId,
            selectedOperationId: runtimeContext.selectedOperationId,
            selectedCropStructureSectionId: runtimeContext.selectedCropStructureSectionId,
          },
          companyId: resolvedCompanyId,
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
      const actions: AssistantActionButton[] = [];
      const draftCards: AssistantDraftCard[] = [];
      const toolActivity = Array.isArray(payload.toolActivity) ? payload.toolActivity : [];
      setLastMode(mode);
      const memoryWrite = meta.memoryWrite;
      if (
        (memoryWrite?.action === "save" && Number(memoryWrite.savedCount || 0) > 0) ||
        (memoryWrite?.action === "delete" && Number(memoryWrite.deletedCount || 0) > 0)
      ) {
        window.dispatchEvent(new CustomEvent("travkin:assistant-memory-changed"));
      }

      const responseRenderStartedAt = typeof window !== "undefined" && window.performance ? window.performance.now() : Date.now();
      const answer = String(payload.response || "").trim() || "По системе сейчас данных по этому запросу не найдено.";
      const finalAnswer = sanitizeAssistantAnswer(answer);
      const assistantMessage: AssistantChatMessage = {
        id: payload.messageIds?.assistant || uid(),
        role: "assistant",
        content: finalAnswer,
        createdAt: new Date().toISOString(),
        actions,
        draftCards,
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
              false,
            navigationActionCreated: false,
            navigationActionExecuted: null,
            navigationActionType: null,
            navigationEntityType: null,
            navigationEntityId: null,
            navigationFilters: null,
            targetRoute: null,
            routerError: null,
          },
        });
      } else {
        setDebugSnapshot(null);
      }

      const responseThreadId = payload.threadId || threadId;
      if (payload.threadState && typeof payload.threadState === "object" && responseThreadId) {
        setThreadStates((previous) => ({
          ...previous,
          [responseThreadId]: {
            ...emptyThreadState(responseThreadId),
            ...payload.threadState,
            threadId: responseThreadId,
          },
        }));
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
    if (activeThreadId) {
      setThreadStates((previous) => ({ ...previous, [activeThreadId]: emptyThreadState(activeThreadId) }));
    }
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
          draftCards: message.draftCards?.map((card) => ({ kind: card.kind, status: card.status, title: card.title })),
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

  const loadPersonalMemory = useCallback(async () => {
    if (!resolvedCompanyId || disabledReason) return;
    const sequence = memoryLoadSequenceRef.current + 1;
    memoryLoadSequenceRef.current = sequence;
    memoryLoadAbortRef.current?.abort();
    const controller = new AbortController();
    memoryLoadAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
    setMemoryLoading(true);
    setMemoryWarning(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/assistant/memory?companyId=${encodeURIComponent(resolvedCompanyId)}&limit=80`, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        memories?: AssistantMemoryRecord[];
        warning?: string | null;
        error?: string;
        code?: string;
      };
      if (!response.ok) throw new Error(mapAssistantError(payload.code || null, payload.error || null));
      if (sequence === memoryLoadSequenceRef.current) {
        setMemoryRecords(Array.isArray(payload.memories) ? payload.memories.filter((item) => item.active !== false) : []);
        setMemoryWarning(payload.warning || null);
      }
    } catch (error) {
      if (sequence === memoryLoadSequenceRef.current) {
        setMemoryWarning(
          error instanceof DOMException && error.name === "AbortError"
            ? "Не удалось загрузить память: сервер не ответил за 10 секунд."
            : error instanceof Error
              ? error.message
              : "Не удалось загрузить память ассистента."
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (sequence === memoryLoadSequenceRef.current) {
        setMemoryLoaded(true);
        setMemoryLoading(false);
        memoryLoadAbortRef.current = null;
      }
    }
  }, [disabledReason, resolvedCompanyId]);

  const forgetPersonalMemory = useCallback(
    async (memoryId: string | null, all = false) => {
      if (!resolvedCompanyId || disabledReason || memoryBusyId) return;
      if (all && memoryRecords.length > 0 && !window.confirm("Очистить всю личную память ассиста для текущего пользователя?")) {
        return;
      }
      setMemoryBusyId(all ? "__all__" : memoryId || "__unknown__");
      setMemoryWarning(null);
      try {
        const headers = await getAuthHeaders();
        const ids = all ? memoryRecords.map((memory) => memory.id) : memoryId ? [memoryId] : [];
        for (const id of ids) {
          const response = await fetch("/api/assistant/memory", {
            method: "DELETE",
            headers,
            body: JSON.stringify({ companyId: resolvedCompanyId, memoryId: id, confirmed: true }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
          };
          if (!response.ok) throw new Error(mapAssistantError(payload.code || null, payload.error || null));
        }
        if (all) {
          setMemoryRecords([]);
        } else if (memoryId) {
          setMemoryRecords((prev) => prev.filter((item) => item.id !== memoryId));
        }
      } catch (error) {
        setMemoryWarning(error instanceof Error ? error.message : "Не удалось обновить память ассиста.");
      } finally {
        setMemoryBusyId(null);
      }
    },
    [disabledReason, memoryBusyId, memoryRecords, resolvedCompanyId]
  );

  useEffect(() => {
    if (activeTab !== "settings" || memoryLoaded || memoryLoading) return;
    void loadPersonalMemory();
  }, [activeTab, loadPersonalMemory, memoryLoaded, memoryLoading]);

  useEffect(() => {
    const onMemoryChanged = () => {
      setMemoryLoaded(false);
      void loadPersonalMemory();
    };
    window.addEventListener("travkin:assistant-memory-changed", onMemoryChanged);
    return () => {
      window.removeEventListener("travkin:assistant-memory-changed", onMemoryChanged);
      memoryLoadAbortRef.current?.abort();
    };
  }, [loadPersonalMemory]);

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

  const openGenericDraftModule = useCallback(
    async (card: AssistantGenericDraftCard) => {
      void card;
      setRequestError("Навигация к write-модулям отключена в Travkin Assistant V1.");
    },
    []
  );

  const renderGenericDraftCard = (messageId: string, card: AssistantGenericDraftCard) => {
    const statusLabel =
      card.status === "confirmed"
        ? "Подтверждён"
        : card.status === "cancelled"
          ? "Отменён"
          : card.status === "expired"
            ? "Истёк"
            : "Черновик";

    if (card.collapsed) {
      return (
        <button
          key={card.id}
          type="button"
          onClick={() => setDraftCollapsed(messageId, card.id, false)}
          className="flex w-full items-center justify-between rounded-lg border border-[#334058] bg-[#111827] px-3 py-2 text-left text-xs text-[#CBD5E1] transition hover:border-[#E0B100]/70"
        >
          <span>
            {card.title} {card.status === "cancelled" ? "(отменён)" : ""}
          </span>
          <span className="text-[#E0B100]">Открыть</span>
        </button>
      );
    }

    return (
      <div key={card.id} className="overflow-hidden rounded-xl border border-[#334058] bg-[#111827] shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between gap-3 border-b border-[#263247] bg-[#151E2D] px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#E0B100]">{card.title}</div>
            <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-[#F8FAFC]">{card.summary}</div>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
              card.status === "cancelled"
                ? "border-slate-500/50 bg-slate-600/20 text-slate-200"
                : "border-[#E0B100]/50 bg-[#E0B100]/10 text-[#FDE68A]"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="space-y-2 px-3 py-2.5 text-xs text-[#CBD5E1]">
          {card.items.length ? (
            <div className="rounded-lg border border-[#2A3448] bg-[#0F141E] p-2">
              <div className="space-y-1">
                {card.items.slice(0, 8).map((item) => (
                  <div key={item.id} className="grid grid-cols-[94px_1fr] gap-2">
                    <span className="truncate text-[#94A3B8]">{item.label}</span>
                    <span className="line-clamp-2 text-[#E5E7EB]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-[#2A3448] bg-[#0F141E] px-2 py-1.5 text-[#94A3B8]">
              Данных пока мало. Можно уточнить детали в чате.
            </div>
          )}

          {card.missingFields.length ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-100">
              Нужно уточнить: {card.missingFields.join(", ")}.
            </div>
          ) : null}

          {card.note ? (
            <div className="text-[11px] text-[#94A3B8]">{card.note}</div>
          ) : null}

          {card.error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-100">
              {card.error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {card.status === "cancelled" ? (
              <button
                type="button"
                onClick={() => restoreDraftCard(messageId, card.id)}
                className="rounded-lg bg-[#E0B100] px-3 py-1.5 text-xs font-semibold text-[#111827] transition hover:bg-[#C89F00]"
              >
                Вернуть в работу
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void openGenericDraftModule(card)}
                  disabled={card.status !== "draft"}
                  className="rounded-lg bg-[#E0B100] px-3 py-1.5 text-xs font-semibold text-[#111827] transition hover:bg-[#C89F00] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {card.actionLabel}
                </button>
                <button
                  type="button"
                  onClick={() => startDraftChange(card)}
                  disabled={card.status !== "draft"}
                  className="rounded-lg border border-[#334058] bg-[#141B29] px-3 py-1.5 text-xs text-[#E5E7EB] transition hover:border-[#E0B100]/70 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => cancelDraftCard(messageId, card.id)}
                  disabled={card.status !== "draft"}
                  className="rounded-lg border border-[#334058] bg-[#141B29] px-3 py-1.5 text-xs text-[#E5E7EB] transition hover:border-red-400/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Отменить
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderDraftCard = (messageId: string, card: AssistantDraftCard) => {
    if (!isOperationDraftCard(card)) return renderGenericDraftCard(messageId, card);

    const isConfirming = confirmingDraftId === card.id;
    const isEditing = editingDraftId === card.id;
    const recommendationsOpen = !!expandedDraftRecommendations[card.id];
    const visibleMaterials = card.materials.slice(0, 4);
    const hiddenMaterialsCount = Math.max(0, card.materials.length - visibleMaterials.length);
    const visibleTankTotals = card.tankTotals.slice(0, 5);
    const hiddenTankCount = Math.max(0, card.tankTotals.length - visibleTankTotals.length);
    const statusLabel =
      card.status === "confirmed"
        ? "Подтверждён"
        : card.status === "cancelled"
          ? "Отменён"
          : card.status === "expired"
            ? "Истёк"
            : "Черновик";

    if (card.collapsed) {
      return (
        <button
          key={card.id}
          type="button"
          onClick={() => setDraftCollapsed(messageId, card.id, false)}
          className="flex w-full items-center justify-between rounded-lg border border-[#334058] bg-[#111827] px-3 py-2 text-left text-xs text-[#CBD5E1] transition hover:border-[#E0B100]/70"
        >
          <span>Черновик операции {card.status === "cancelled" ? "(отменён)" : ""}</span>
          <span className="text-[#E0B100]">Открыть</span>
        </button>
      );
    }

    return (
      <div key={card.id} className="overflow-hidden rounded-xl border border-[#334058] bg-[#111827] shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between gap-3 border-b border-[#263247] bg-[#151E2D] px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#E0B100]">{card.title}</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-[#F8FAFC]">{card.operationType || "Операция"}</div>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
              card.status === "confirmed"
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : card.status === "cancelled"
                  ? "border-slate-500/50 bg-slate-600/20 text-slate-200"
                  : "border-[#E0B100]/50 bg-[#E0B100]/10 text-[#FDE68A]"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="space-y-2 px-3 py-2.5 text-xs text-[#CBD5E1]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase text-[#64748B]">Поле</div>
              <div className="truncate font-medium text-[#F8FAFC]">{card.field || "Уточнить"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#64748B]">Площадь</div>
              <div className="font-medium text-[#F8FAFC]">{card.areaHa != null ? `${formatDraftNumber(card.areaHa)} га` : "Уточнить"}</div>
            </div>
            {card.section ? (
              <div className="col-span-2">
                <div className="text-[10px] uppercase text-[#64748B]">Участок</div>
                <div className="truncate font-medium text-[#F8FAFC]">{card.section}</div>
              </div>
            ) : null}
            {card.crop ? (
              <div>
                <div className="text-[10px] uppercase text-[#64748B]">Культура</div>
                <div className="truncate font-medium text-[#F8FAFC]">{card.crop}</div>
              </div>
            ) : null}
            {card.sprayVolumeLHa != null ? (
              <div>
                <div className="text-[10px] uppercase text-[#64748B]">Норма вылива</div>
                <div className="font-medium text-[#F8FAFC]">{formatDraftNumber(card.sprayVolumeLHa)} л/га</div>
              </div>
            ) : null}
          </div>

          {card.materials.length ? (
            <div className="rounded-lg border border-[#2A3448] bg-[#0F141E] p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase text-[#94A3B8]">Материалы</div>
              <div className="space-y-1">
                {visibleMaterials.map((material) => (
                  <div key={material.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[#E5E7EB]">{material.name}</span>
                    <span className="shrink-0 text-[#CBD5E1]">
                      {material.ratePerHa != null ? `${formatDraftNumber(material.ratePerHa)}${material.unit ? ` ${localizeUnit(`${material.unit}/ha`, "ru")}` : ""}` : ""}
                    </span>
                  </div>
                ))}
                {hiddenMaterialsCount ? <div className="text-[#94A3B8]">+ ещё {hiddenMaterialsCount}</div> : null}
              </div>
            </div>
          ) : null}

          {card.materials.some((item) => item.calculation) ? (
            <div className="rounded-lg border border-[#2A3448] bg-[#0F141E] p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase text-[#94A3B8]">Расчёт потребности</div>
              <div className="space-y-1">
                {card.materials
                  .filter((item) => item.calculation)
                  .slice(0, 4)
                  .map((material) => (
                    <div key={`calc-${material.id}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-[#E5E7EB]">{material.name}</span>
                      <span className="shrink-0 text-[#CBD5E1]">{material.calculation}</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}

          {card.tankTotals.length ? (
            <div className="rounded-lg border border-[#2A3448] bg-[#0F141E] p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase text-[#94A3B8]">Итого в раствор</div>
              <div className="space-y-1">
                {visibleTankTotals.map((line) => (
                  <div key={line.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[#E5E7EB]">{line.name}</span>
                    <span className="shrink-0 text-[#CBD5E1]">{formatDraftQuantity(line.quantity, line.unit)}</span>
                  </div>
                ))}
                {hiddenTankCount ? <div className="text-[#94A3B8]">+ ещё {hiddenTankCount}</div> : null}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase text-[#64748B]">Дата</div>
              <div className="font-medium text-[#F8FAFC]">{card.date || "Уточнить"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#64748B]">Ответственный</div>
              <div className="truncate font-medium text-[#F8FAFC]">{card.responsible || "Не назначен"}</div>
            </div>
          </div>

          {card.comment ? (
            <div>
              <div className="text-[10px] uppercase text-[#64748B]">Комментарий</div>
              <div className="line-clamp-2 text-[#E5E7EB]">{card.comment}</div>
            </div>
          ) : null}

          {card.recommendations.length ? (
            <div className="rounded-lg border border-[#2A3448] bg-[#0F141E]">
              <button
                type="button"
                onClick={() =>
                  setExpandedDraftRecommendations((prev) => ({ ...prev, [card.id]: !recommendationsOpen }))
                }
                className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs text-[#E5E7EB]"
              >
                <span>Рекомендации</span>
                <span className="text-[#E0B100]">{recommendationsOpen ? "Скрыть" : "Показать"}</span>
              </button>
              {recommendationsOpen ? (
                <ol className="space-y-1 border-t border-[#2A3448] px-4 py-2 text-[#CBD5E1]">
                  {card.recommendations.map((item, index) => (
                    <li key={`${card.id}-rec-${index}`}>{index + 1}. {item}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}

          {card.confirm.missingFields.length ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-100">
              Нужно уточнить: {card.confirm.missingFields.join(", ")}.
            </div>
          ) : null}

          {card.error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-100">
              {card.error}
            </div>
          ) : null}

          {isEditing ? (
            <form
              className="grid gap-2 rounded-lg border border-[#334058] bg-[#0F141E] p-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const areaText = String(data.get("areaHa") || "").replace(",", ".").trim();
                const areaHa = areaText ? Number(areaText) : null;
                applyDraftQuickEdit(messageId, card.id, {
                  areaHa: Number.isFinite(areaHa) ? areaHa : null,
                  date: String(data.get("date") || "").trim() || null,
                  comment: String(data.get("comment") || "").trim() || null,
                });
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-[#CBD5E1]">
                  Площадь, га
                  <input
                    name="areaHa"
                    defaultValue={card.areaHa ?? ""}
                    className="mt-1 w-full rounded-md border border-[#334058] bg-[#111827] px-2 py-1 text-xs text-[#F8FAFC]"
                  />
                </label>
                <label className="text-[11px] text-[#CBD5E1]">
                  Дата
                  <input
                    name="date"
                    type="date"
                    defaultValue={card.date || ""}
                    className="mt-1 w-full rounded-md border border-[#334058] bg-[#111827] px-2 py-1 text-xs text-[#F8FAFC]"
                  />
                </label>
              </div>
              <label className="text-[11px] text-[#CBD5E1]">
                Комментарий
                <textarea
                  name="comment"
                  defaultValue={card.comment || ""}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-md border border-[#334058] bg-[#111827] px-2 py-1 text-xs text-[#F8FAFC]"
                />
              </label>
              <div className="flex gap-1.5">
                <button type="submit" className="rounded-md bg-[#E0B100] px-2.5 py-1 text-xs font-medium text-[#111827]">
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => setEditingDraftId(null)}
                  className="rounded-md border border-[#334058] px-2.5 py-1 text-xs text-[#E5E7EB]"
                >
                  Отмена
                </button>
              </div>
            </form>
          ) : null}

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {card.status === "cancelled" ? (
              <button
                type="button"
                onClick={() => restoreDraftCard(messageId, card.id)}
                className="rounded-lg bg-[#E0B100] px-3 py-1.5 text-xs font-semibold text-[#111827] transition hover:bg-[#C89F00]"
              >
                Вернуть в работу
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void confirmDraftCard(messageId, card)}
                  disabled
                  className="rounded-lg bg-[#E0B100] px-3 py-1.5 text-xs font-semibold text-[#111827] transition hover:bg-[#C89F00] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Только чтение
                </button>
                <button
                  type="button"
                  onClick={() => startDraftChange(card)}
                  disabled={card.status !== "draft"}
                  className="rounded-lg border border-[#334058] bg-[#141B29] px-3 py-1.5 text-xs text-[#E5E7EB] transition hover:border-[#E0B100]/70 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => cancelDraftCard(messageId, card.id)}
                  disabled={card.status !== "draft"}
                  className="rounded-lg border border-[#334058] bg-[#141B29] px-3 py-1.5 text-xs text-[#E5E7EB] transition hover:border-red-400/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Отменить
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0D121B] text-[#E5E7EB]">
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
        <div className="border-b border-[#1F2937] bg-[#0D121B] px-1 pb-2">
          <TabsList className="inline-flex h-8 w-auto rounded-xl border border-[#253044] bg-[#0A0F18] p-0.5">
            <TabsTrigger
              value="chat"
              className="h-7 rounded-lg px-3 text-xs text-[#CBD5E1] data-[state=active]:bg-[#1B2435] data-[state=active]:text-[#F8FAFC]"
            >
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="h-7 rounded-lg px-3 text-xs text-[#CBD5E1] data-[state=active]:bg-[#1B2435] data-[state=active]:text-[#F8FAFC]"
            >
              <Clock3 className="mr-1.5 h-3.5 w-3.5" />
              History
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="h-7 rounded-lg px-3 text-xs text-[#CBD5E1] data-[state=active]:bg-[#1B2435] data-[state=active]:text-[#F8FAFC]"
            >
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="relative mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <div
            ref={scrollContainerRef}
            onScroll={updateJumpToBottomVisibility}
            className="travkin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
          >
            {messagesLoading && messages.length === 0 ? (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-[#94A3B8]">
                <Loader2 className="h-4 w-4 animate-spin text-[#E0B100]" />
                Загружаю сообщения...
              </div>
            ) : messages.length === 0 ? (
              <div className="space-y-4 px-1 py-2">
                <div>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center text-[#E0B100]">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#F8FAFC]">Контекст готов</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {contextPills.slice(0, 5).map((pill) => (
                          <span
                            key={pill}
                            className="max-w-[220px] truncate rounded-md border border-[#2A3448] px-2 py-1 text-[11px] text-[#CBD5E1]"
                          >
                            {pill}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {quickPrompts.map((item) => (
                    <button
                      key={`${item.label}-${item.prompt}`}
                      type="button"
                      onClick={() => applyQuickPrompt(item.prompt)}
                      className="group flex items-center justify-between gap-2 rounded-lg border border-[#2A3448] px-3 py-2 text-left text-sm text-[#E5E7EB] transition hover:border-[#E0B100]/70 hover:bg-[#151C28]"
                    >
                      <span className="truncate">{item.label}</span>
                      <Compass className="h-3.5 w-3.5 shrink-0 text-[#E0B100] transition group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messagesLoading ? (
                  <div className="flex items-center gap-2 px-1 py-1 text-xs text-[#94A3B8]">
                    <Loader2 className="h-4 w-4 animate-spin text-[#E0B100]" />
                    <span>Обновляю историю...</span>
                  </div>
                ) : null}
                {messages.filter(isProductionAssistantMessage).map((message) => {
                  const visibleContent = message.role === "assistant" ? sanitizeAssistantAnswer(message.content) : message.content;
                  return (
                  <div
                    key={message.id}
                    className={`flex items-start gap-2.5 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                  {message.role !== "user" ? (
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[#E0B100]">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                  ) : null}

                  <div className={`${message.role === "user" ? "max-w-[86%]" : "max-w-[94%]"} space-y-2`}>
                    <div
                      className={`whitespace-pre-wrap text-sm leading-relaxed ${
                        message.role === "user"
                          ? "rounded-2xl bg-[#242B3A] px-3 py-2 text-[#F8FAFC]"
                          : "px-0 py-0 text-[#E5E7EB]"
                      }`}
                    >
                      {visibleContent}
                    </div>

                    {message.role !== "user" && message.draftCards?.length ? (
                      <div className="space-y-2">
                        {message.draftCards.map((card) => renderDraftCard(message.id, card))}
                      </div>
                    ) : null}

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
                            className="rounded-lg border border-[#334058] px-2.5 py-1 text-xs text-[#E5E7EB] transition hover:border-[#E0B100]/70 hover:bg-[#151C28]"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {message.role === "user" ? (
                    <div className="mt-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E0B100] text-[#111827] shadow-[0_0_0_1px_rgba(224,177,0,0.25)]">
                      <User className="h-4 w-4" />
                    </div>
                  ) : null}
                </div>
                  );
                })}
              </>
            )}

            {loading ? (
              <div className="px-1 py-1 text-xs text-[#CBD5E1]">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E0B100]" />
                  {loadingText}
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {showJumpToBottom ? (
            <button
              type="button"
              data-testid="assistant-jump-to-bottom"
              aria-label="Перейти к последнему сообщению"
              title="Перейти к последнему сообщению"
              onClick={() => scrollToBottom("smooth")}
              className="absolute bottom-[92px] left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[#334058] bg-[#0B111B]/95 text-[#E0B100] shadow-[0_10px_28px_rgba(0,0,0,0.38)] backdrop-blur transition hover:-translate-y-0.5 hover:border-[#E0B100]/70 hover:bg-[#151C28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E0B100]/70"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          ) : null}

          <div className="border-t border-[#1F2937] bg-[#0D121B] px-1 pt-3">
            {voiceState === "recording" ? (
              <div
                data-testid="assistant-voice-status"
                className="mb-2 flex items-center gap-2 rounded-lg border border-[#3B465C] bg-[#151C28] px-2.5 py-1.5 text-xs text-[#E5E7EB]"
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
              className="flex items-end gap-2 rounded-2xl border border-[#2A3448] bg-[#0A0F18] p-2 shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition focus-within:border-[#E0B100]/60"
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
                className="min-h-[44px] resize-none border-0 bg-transparent px-2 py-2 text-sm text-[#F8FAFC] shadow-none placeholder:text-[#64748B] focus-visible:ring-0"
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
                className="h-9 w-9 shrink-0 rounded-xl border-0 bg-transparent text-[#CBD5E1] hover:bg-[#172033] hover:text-[#F8FAFC]"
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
              <Button
                type="submit"
                size="icon"
                disabled={!canSend}
                aria-label={loading ? "Ответ формируется" : "Отправить"}
                className="h-9 w-9 shrink-0 rounded-xl bg-[#E0B100] text-[#111827] hover:bg-[#C89F00] disabled:bg-[#1B2435] disabled:text-[#64748B] disabled:opacity-100"
              >
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

            <div className="rounded-md border border-[#2A3448] bg-[#141B29] px-3 py-2 text-sm">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#F8FAFC]">Личная память</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#94A3B8]">
                    Только для этого пользователя. Стиль и привычки не применяются к другим ролям и не считаются ERP-фактами.
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => void loadPersonalMemory()}
                  disabled={memoryLoading || !!disabledReason}
                  className="h-8 w-8 shrink-0 border-[#334058] bg-[#0F141E] text-[#CBD5E1] hover:bg-[#202738]"
                  aria-label="Обновить память"
                  title="Обновить память"
                >
                  {memoryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {memoryWarning ? (
                <div className="mb-2 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-100">
                  {memoryWarning}
                </div>
              ) : null}

              {memoryLoading && memoryRecords.length === 0 ? (
                <div className="flex items-center gap-2 py-2 text-xs text-[#94A3B8]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E0B100]" />
                  Загружаю память...
                </div>
              ) : memoryRecords.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#334058] px-2.5 py-3 text-xs text-[#94A3B8]">
                  Пока нет сохранённых личных предпочтений. Ассист запоминает только явные фразы вроде “запомни...” или “пиши мне коротко”.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {memoryRecords.slice(0, 8).map((memory) => (
                    <div key={memory.id} className="rounded-md border border-[#253044] bg-[#0F141E] px-2.5 py-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="rounded-full border border-[#334058] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#CBD5E1]">
                          {memoryCategoryLabel(memory.category)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void forgetPersonalMemory(memory.id)}
                          disabled={memoryBusyId === memory.id || memoryBusyId === "__all__"}
                          className="rounded-md p-1 text-[#94A3B8] transition hover:bg-[#1B2435] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Удалить запись памяти"
                          title="Удалить запись памяти"
                        >
                          {memoryBusyId === memory.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <div className="line-clamp-3 text-xs leading-relaxed text-[#E5E7EB]">{memory.value}</div>
                      <div className="mt-1 text-[10px] text-[#64748B]">обновлено: {formatThreadDate(memory.updated_at)}</div>
                    </div>
                  ))}
                  {memoryRecords.length > 8 ? (
                    <div className="text-[11px] text-[#94A3B8]">+ ещё {memoryRecords.length - 8} записей</div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void forgetPersonalMemory(null, true)}
                    disabled={memoryBusyId !== null || memoryRecords.length === 0}
                    className="mt-1 w-full justify-start border-[#334058] bg-[#0F141E] text-[#E5E7EB] hover:bg-[#202738] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {memoryBusyId === "__all__" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                    Очистить личную память
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onExportChat}
                disabled={!canExportChat}
                className="justify-start border-[#334058] bg-[#141B29] text-[#E5E7EB] hover:bg-[#202738] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="mr-2 h-4 w-4" />
                Экспортировать чат
              </Button>

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

      </Tabs>
    </div>
  );
}
