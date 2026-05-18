import type { AssistantUiContext } from "@/lib/assistant/engine/types";

function cleanString(value: unknown): string | null {
  const raw = String(value || "").trim();
  return raw.length > 0 ? raw : null;
}

function normalizeFilters(raw: unknown): Record<string, string | string[]> {
  if (!raw || typeof raw !== "object") return {};
  const filters: Record<string, string | string[]> = {};

  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    const filterKey = String(key || "").trim();
    if (!filterKey) return;
    if (Array.isArray(value)) {
      const items = value.map((x) => String(x || "").trim()).filter(Boolean);
      if (items.length) filters[filterKey] = items;
      return;
    }
    const single = cleanString(value);
    if (single) filters[filterKey] = single;
  });

  return filters;
}

export function normalizeAssistantUiContext(input: Partial<AssistantUiContext> | null | undefined): AssistantUiContext {
  const entity = input?.entity;
  const entityType = cleanString(entity?.type);
  const entityId = cleanString(entity?.id);

  return {
    currentPage: cleanString(input?.currentPage) || "dashboard",
    currentRoute: cleanString(input?.currentRoute) || "/dashboard",
    entity: entityType && entityId
      ? {
          type: entityType,
          id: entityId,
          label: cleanString(entity?.label),
        }
      : null,
    selectedRows: Array.isArray(input?.selectedRows)
      ? input!.selectedRows.map((x) => String(x || "").trim()).filter(Boolean)
      : [],
    filters: normalizeFilters(input?.filters),
    season: cleanString(input?.season),
    companyId: cleanString(input?.companyId),
    companyName: cleanString(input?.companyName),
    locale:
      input?.locale === "en" || input?.locale === "kz" || input?.locale === "ru"
        ? input.locale
        : "ru",
  };
}
