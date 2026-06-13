import type { AssistantUiContext } from "@/lib/assistant/engine/types";

const DEFAULT_SEASON = "2026";

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
  const filters = normalizeFilters(input?.filters);
  const selectedSeason = cleanString(input?.season) || cleanString((filters as any).season) || cleanString((filters as any).year);
  const selectedEntityType = cleanString(input?.selectedEntityType) || entityType;
  const selectedEntityId = cleanString(input?.selectedEntityId) || entityId;
  const selectedFieldId =
    cleanString(input?.selectedFieldId) ||
    cleanString((filters as any).field) ||
    cleanString((filters as any).fieldId) ||
    (selectedEntityType?.toLowerCase() === "field" ? selectedEntityId : null);
  const selectedFieldLabel =
    cleanString(input?.selectedFieldLabel) ||
    cleanString((filters as any).fieldLabel) ||
    (selectedEntityType?.toLowerCase() === "field" ? cleanString(entity?.label) : null);
  const selectedWarehouseId =
    cleanString(input?.selectedWarehouseId) ||
    cleanString((filters as any).warehouse) ||
    cleanString((filters as any).warehouseId) ||
    (selectedEntityType?.toLowerCase() === "warehouse" ? selectedEntityId : null);
  const selectedWarehouseLabel =
    cleanString(input?.selectedWarehouseLabel) ||
    cleanString((filters as any).warehouseLabel) ||
    (selectedEntityType?.toLowerCase() === "warehouse" ? cleanString(entity?.label) : null);
  const selectedCropStructureSectionId =
    cleanString(input?.selectedCropStructureSectionId) ||
    cleanString((filters as any).cropStructureId) ||
    cleanString((filters as any).crop_structure_id) ||
    cleanString((filters as any).sectionId) ||
    cleanString((filters as any).structureId) ||
    (selectedEntityType?.toLowerCase() === "crop_structure_line" ? selectedEntityId : null);
  const selectedCropStructureSectionLabel =
    cleanString(input?.selectedCropStructureSectionLabel) ||
    cleanString((filters as any).cropStructureLabel) ||
    cleanString((filters as any).sectionLabel) ||
    (selectedEntityType?.toLowerCase() === "crop_structure_line" ? cleanString(entity?.label) : null);
  const selectedOperationId =
    cleanString(input?.selectedOperationId) ||
    cleanString((filters as any).operationId) ||
    cleanString((filters as any).operation_id) ||
    (selectedEntityType?.toLowerCase() === "operation" ? selectedEntityId : null);
  const selectedOperationLabel =
    cleanString(input?.selectedOperationLabel) ||
    cleanString((filters as any).operationLabel) ||
    (selectedEntityType?.toLowerCase() === "operation" ? cleanString(entity?.label) : null);
  const selectedTicketId =
    cleanString(input?.selectedTicketId) ||
    cleanString((filters as any).ticketId) ||
    cleanString((filters as any).ticket_id) ||
    (selectedEntityType?.toLowerCase() === "ticket" ? selectedEntityId : null);
  const selectedTicketLabel =
    cleanString(input?.selectedTicketLabel) ||
    cleanString((filters as any).ticketNo) ||
    cleanString((filters as any).ticketLabel) ||
    (selectedEntityType?.toLowerCase() === "ticket" ? cleanString(entity?.label) : null);
  const selectedBatchId =
    cleanString(input?.selectedBatchId) ||
    cleanString((filters as any).batchId) ||
    cleanString((filters as any).batch_id) ||
    (selectedEntityType?.toLowerCase() === "batch" ? selectedEntityId : null);
  const selectedBatchLabel =
    cleanString(input?.selectedBatchLabel) ||
    cleanString((filters as any).batchCode) ||
    cleanString((filters as any).batchLabel) ||
    (selectedEntityType?.toLowerCase() === "batch" ? cleanString(entity?.label) : null);
  const currentPage = cleanString(input?.currentPage) || "dashboard";
  const currentModule = cleanString(input?.currentModule) || currentPage;
  const locale =
    input?.locale === "en" || input?.locale === "kz" || input?.locale === "ru"
      ? input.locale
      : "ru";
  const language =
    input?.language === "en" || input?.language === "kz" || input?.language === "ru"
      ? input.language
      : locale;

  return {
    currentPage,
    currentRoute: cleanString(input?.currentRoute) || "/dashboard",
    currentModule,
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
    filters,
    season: selectedSeason || DEFAULT_SEASON,
    defaultSeason: cleanString(input?.defaultSeason) || DEFAULT_SEASON,
    companyId: cleanString(input?.companyId),
    companyName: cleanString(input?.companyName),
    userId: cleanString(input?.userId),
    userRole: cleanString(input?.userRole),
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
    selectedCrop: cleanString(input?.selectedCrop) || cleanString((filters as any).crop) || cleanString((filters as any).culture),
    language,
    locale,
  };
}
