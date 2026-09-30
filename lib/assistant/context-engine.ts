import type { AssistantToolContext } from "@/lib/assistant/engine/types";

export type AssistantResolvedEntityType =
  | "field"
  | "warehouse"
  | "operation"
  | "ticket"
  | "crop_structure_line"
  | "batch"
  | "crop"
  | "variety"
  | "page";

type EntityRow = Record<string, unknown>;

const DEFAULT_SEASON = "2026";

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[№#]/g, " ")
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUuidLike(value: string | null): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function includesAny(value: unknown, needles: string[]): boolean {
  const text = normalizeText(value);
  return needles.some((needle) => text.includes(needle));
}

function getFilterValue(context: AssistantToolContext, keys: string[]): string | null {
  const filters = context.runtimeContext.filters || {};
  for (const key of keys) {
    const value = (filters as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      const first = value.map(cleanString).find(Boolean);
      if (first) return first;
      continue;
    }
    const text = cleanString(value);
    if (text) return text;
  }
  return null;
}

function getContextQuery(context: AssistantToolContext, fallback?: string | null): string | null {
  return (
    cleanString(context.intent.parameters.query) ||
    cleanString(context.intent.parameters.entityQuery) ||
    cleanString(context.intent.parameters.field) ||
    cleanString(context.intent.parameters.warehouse) ||
    cleanString(context.intent.parameters.ticket) ||
    cleanString(context.intent.parameters.operation) ||
    cleanString(context.intent.parameters.batch) ||
    cleanString(fallback) ||
    null
  );
}

function extractFieldCode(value: unknown): string | null {
  const normalized = normalizeText(value);
  const prefixed = normalized.match(/(?:\u043f\u043e\u043b\u0435|field)\s*(\d{1,3}(?:-\d{1,3}){0,2})/i);
  if (prefixed?.[1]) return prefixed[1];
  const suffixed = normalized.match(/(\d{1,3}(?:-\d{1,3}){0,2})\s*(?:\u043f\u043e\u043b\u0435|field)/i);
  if (suffixed?.[1]) return suffixed[1];
  const plain = normalized.match(/\b\d{1,3}(?:-\d{1,3}){0,2}\b/);
  return cleanString(plain?.[0]);
}

function extractTicketNo(value: unknown): string | null {
  const text = String(value || "").trim();
  const match = text.match(/\bWR-\d{4}-\d{5,}\b/i);
  return cleanString(match?.[0]);
}

export function normalizeWarehouseAlias(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/(?:\u043e\u0432\u043e\u0449|\u043a\u0430\u0440\u0442\u043e\u0444|\u0445\u0440\u0430\u043d|vegetable|potato)/i.test(text)) return "\u043e\u0432\u043e\u0449\u043d\u043e\u0439";
  if (/(?:\u0441\u0435\u043c\u0435\u043d|seed)/i.test(text)) return "\u0441\u0435\u043c\u0435\u043d";
  if (/(?:\u0437\u0435\u0440\u043d|grain)/i.test(text)) return "\u0437\u0435\u0440\u043d";
  if (/(?:\u0443\u0434\u043e\u0431\u0440|fertiliz|dap|\u0434\u0438\u0430\u043c|\u0430\u043c\u043c\u043e\u0444)/i.test(text)) return "\u0443\u0434\u043e\u0431\u0440";
  if (/(?:\u0441\u0437\u0440|\u0445\u0438\u043c|pestic|fungic|herbic)/i.test(text)) return "\u0441\u0437\u0440";
  return cleanString(value);
}

function pageContextForRoute(route: string | null, moduleKey: string | null): string {
  const routeText = normalizeText(`${route || ""} ${moduleKey || ""}`);
  if (routeText.includes("crop-structure")) return "crop_structure";
  if (routeText.includes("operations")) return "operations";
  if (routeText.includes("warehouses")) return "warehouses";
  if (routeText.includes("weighbridge")) return "weighbridge_tickets";
  if (routeText.includes("fields-map")) return "field_map";
  if (routeText.includes("fields")) return "fields";
  if (routeText.includes("tasks")) return "role_tasks";
  return moduleKey || "dashboard";
}

function roleFocus(role: string | null): string {
  switch (role) {
    case "warehouse_operator":
      return "warehouse_requests_and_stock";
    case "weighman":
      return "weighbridge_tickets";
    case "specialist":
    case "brigadier":
      return "assigned_tasks_execution";
    case "agronomist":
      return "crop_structure_operations_fields";
    case "director":
    case "company_admin":
    case "global_admin":
      return "farm_overview_and_decisions";
    default:
      return "read_only_context";
  }
}

function selectedEntities(context: AssistantToolContext): Record<string, Record<string, string | null>> {
  const runtime = context.runtimeContext;
  return {
    field: {
      id: runtime.selectedFieldId || getFilterValue(context, ["fieldId", "field"]),
      label: runtime.selectedFieldLabel || getFilterValue(context, ["fieldLabel"]),
    },
    crop_structure_section: {
      id: runtime.selectedCropStructureSectionId || getFilterValue(context, ["cropStructureId", "crop_structure_id", "sectionId", "structureId"]),
      label: runtime.selectedCropStructureSectionLabel || getFilterValue(context, ["cropStructureLabel", "sectionLabel"]),
    },
    operation: {
      id: runtime.selectedOperationId || getFilterValue(context, ["operationId", "operation_id"]),
      label: runtime.selectedOperationLabel || getFilterValue(context, ["operationLabel"]),
    },
    warehouse: {
      id: runtime.selectedWarehouseId || getFilterValue(context, ["warehouseId", "warehouse"]),
      label: runtime.selectedWarehouseLabel || getFilterValue(context, ["warehouseLabel"]),
    },
    ticket: {
      id: runtime.selectedTicketId || getFilterValue(context, ["ticketId", "ticket_id"]),
      label: runtime.selectedTicketLabel || getFilterValue(context, ["ticketNo", "ticketLabel"]),
    },
    batch: {
      id: runtime.selectedBatchId || getFilterValue(context, ["batchId", "batch_id"]),
      label: runtime.selectedBatchLabel || getFilterValue(context, ["batchCode", "batchLabel"]),
    },
    crop: {
      id: null,
      label: runtime.selectedCrop || getFilterValue(context, ["crop", "culture"]),
    },
  };
}

export function collectAssistantContextRows(context: AssistantToolContext): EntityRow[] {
  const runtime = context.runtimeContext;
  const selected = selectedEntities(context);
  return [
    {
      context_version: "copilot-v1-context-engine",
      company_id: context.companyId,
      company_name: runtime.companyName || null,
      season: runtime.season || runtime.defaultSeason || DEFAULT_SEASON,
      current_page: runtime.currentPage,
      current_module: runtime.currentModule || runtime.currentPage,
      current_route: runtime.currentRoute,
      page_context: pageContextForRoute(runtime.currentRoute, runtime.currentModule),
      user_id: runtime.userId || context.actor.id,
      user_role: context.actor.role,
      role_focus: roleFocus(context.actor.role),
      selected_entities: selected,
      selected_field_id: selected.field.id,
      selected_field_label: selected.field.label,
      selected_crop_structure_section_id: selected.crop_structure_section.id,
      selected_crop_structure_section_label: selected.crop_structure_section.label,
      selected_operation_id: selected.operation.id,
      selected_operation_label: selected.operation.label,
      selected_warehouse_id: selected.warehouse.id,
      selected_warehouse_label: selected.warehouse.label,
      selected_ticket_id: selected.ticket.id,
      selected_ticket_label: selected.ticket.label,
      selected_batch_id: selected.batch.id,
      selected_batch_label: selected.batch.label,
      selected_crop: selected.crop.label,
      selected_filters: runtime.filters || {},
      selected_rows: runtime.selectedRows || [],
      context_lock_rule: "page context is a hint only; explicit user text has priority",
    },
  ];
}

function scoreMatch(name: unknown, query: string | null, exactId?: string | null): number {
  const q = normalizeText(query);
  const n = normalizeText(name);
  if (!q || !n) return 0;
  let score = 0;
  if (exactId && n === normalizeText(exactId)) score += 1000;
  if (n === q) score += 500;
  if (n.startsWith(q)) score += 220;
  if (n.includes(q)) score += 120;
  q.split(" ").filter(Boolean).forEach((part) => {
    if (n.includes(part)) score += 20;
  });
  return score;
}

function entityRow(params: {
  type: AssistantResolvedEntityType;
  id: string | null;
  name: string | null;
  route: string;
  page: string;
  filters?: Record<string, string>;
  confidence?: number;
  summary?: string | null;
  extra?: Record<string, unknown>;
}): EntityRow | null {
  if (!params.id && params.type !== "page") return null;
  return {
    entity_type: params.type,
    entity_id: params.id,
    entity_name: params.name || params.id,
    page: params.page,
    route: params.route,
    filters: params.filters || {},
    confidence: params.confidence ?? 0.75,
    summary: params.summary || null,
    ...(params.extra || {}),
  };
}

async function resolveFields(context: AssistantToolContext, query: string | null): Promise<EntityRow[]> {
  const code = extractFieldCode(query);
  const exactId = isUuidLike(query) ? query : null;
  const needle = code || query || context.runtimeContext.selectedFieldLabel || context.runtimeContext.selectedFieldId;
  if (!needle) return [];

  let q = context.supabase
    .from("fields")
    .select("id,name,area,notes")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .limit(120);
  if (exactId) q = q.eq("id", exactId);
  const res = await q;
  if (res.error) return [];

  return (res.data || [])
    .map((row: any) => {
      const name = String(row.name || row.id);
      const score = Math.max(scoreMatch(name, needle, exactId), code && normalizeText(name) === code ? 900 : 0);
      if (score <= 0 && !exactId) return null;
      return entityRow({
        type: "field",
        id: String(row.id),
        name,
        page: "field-card",
        route: `/fields/${row.id}`,
        filters: {
          fieldId: String(row.id),
          entityId: String(row.id),
          entityType: "field",
          search: name,
        },
        confidence: Math.min(1, score / 900),
        summary: `${name}: ${Number(row.area || 0)} ha`,
        extra: { area_ha: Number(row.area || 0), notes: cleanString(row.notes) },
      });
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 8) as EntityRow[];
}

async function resolveWarehouses(context: AssistantToolContext, query: string | null): Promise<EntityRow[]> {
  const alias = normalizeWarehouseAlias(query || context.runtimeContext.selectedWarehouseLabel || context.runtimeContext.selectedWarehouseId);
  const exactId = isUuidLike(query) ? query : null;
  if (!alias && !exactId) return [];

  let res: any = await context.supabase
    .from("warehouses")
    .select("id,name,archived,is_archived")
    .eq("company_id", context.companyId)
    .order("name", { ascending: true })
    .limit(300);
  if (res.error && String(res.error.message || "").toLowerCase().includes("is_archived")) {
    res = await context.supabase
      .from("warehouses")
      .select("id,name,archived")
      .eq("company_id", context.companyId)
      .order("name", { ascending: true })
      .limit(300);
  }
  if (res.error) return [];

  return (res.data || [])
    .filter((row: any) => !(row.archived || row.is_archived))
    .map((row: any) => {
      const id = String(row.id);
      const name = String(row.name || id);
      const score = Math.max(scoreMatch(name, alias, exactId), exactId && id === exactId ? 1000 : 0);
      if (score <= 0 && !exactId) return null;
      return entityRow({
        type: "warehouse",
        id,
        name,
        page: "warehouses",
        route: "/warehouses",
        filters: { warehouseId: id, entityId: id, entityType: "warehouse", search: name },
        confidence: Math.min(1, score / 500),
      });
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 8) as EntityRow[];
}

async function resolveOperations(context: AssistantToolContext, query: string | null): Promise<EntityRow[]> {
  const exactId = isUuidLike(query) || isUuidLike(context.runtimeContext.selectedOperationId) ? (query || context.runtimeContext.selectedOperationId) : null;
  const needle = cleanString(query) || context.runtimeContext.selectedOperationLabel || context.runtimeContext.selectedOperationId;
  if (!needle && !exactId) return [];

  let q = context.supabase
    .from("operations")
    .select("id,date,operation_type,operation_type_slug,status,work_status,field_id,crop_structure_id,fields:field_id(name)")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .order("date", { ascending: false })
    .limit(180);
  if (exactId) q = q.eq("id", exactId);
  const res = await q;
  if (res.error) return [];

  return (res.data || [])
    .map((row: any) => {
      const id = String(row.id);
      const fieldName = cleanString(row.fields?.name);
      const name = [cleanString(row.operation_type) || cleanString(row.operation_type_slug) || "operation", fieldName].filter(Boolean).join(" - ");
      const blob = `${id} ${name} ${row.status || ""} ${row.work_status || ""} ${row.date || ""}`;
      const score = Math.max(scoreMatch(blob, needle, exactId), exactId && id === exactId ? 1000 : 0);
      if (score <= 0 && !exactId) return null;
      return entityRow({
        type: "operation",
        id,
        name,
        page: "operations",
        route: "/operations",
        filters: { operationId: id, entityId: id, entityType: "operation", search: name },
        confidence: Math.min(1, score / 500),
        summary: `${name}: ${row.status || "-"} / ${row.work_status || "-"}`,
        extra: {
          status: cleanString(row.status),
          work_status: cleanString(row.work_status),
          field_id: cleanString(row.field_id),
          field_name: fieldName,
          crop_structure_id: cleanString(row.crop_structure_id),
        },
      });
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 8) as EntityRow[];
}

async function resolveTickets(context: AssistantToolContext, query: string | null): Promise<EntityRow[]> {
  const ticketNo = extractTicketNo(query) || cleanString(context.runtimeContext.selectedTicketLabel);
  const exactId = isUuidLike(query) || isUuidLike(context.runtimeContext.selectedTicketId) ? (query || context.runtimeContext.selectedTicketId) : null;
  const needle = ticketNo || cleanString(query) || context.runtimeContext.selectedTicketId;
  if (!needle && !exactId) return [];

  let q = context.supabase
    .from("tickets")
    .select("id,ticket_no,status,op_type,created_at,net_weight_kg,field_id")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(180);
  if (exactId) q = q.eq("id", exactId);
  const res = await q;
  if (res.error) return [];

  return (res.data || [])
    .map((row: any) => {
      const id = String(row.id);
      const number = cleanString(row.ticket_no) || id;
      const blob = `${id} ${number} ${row.status || ""} ${row.op_type || ""}`;
      const score = Math.max(scoreMatch(blob, needle, exactId), ticketNo && normalizeText(number) === normalizeText(ticketNo) ? 1000 : 0);
      if (score <= 0 && !exactId) return null;
      return entityRow({
        type: "ticket",
        id,
        name: number,
        page: "weighbridge",
        route: "/weighbridge",
        filters: { ticketId: id, entityId: id, entityType: "ticket", search: number },
        confidence: Math.min(1, score / 500),
        summary: `${number}: ${row.op_type || "-"} / ${row.status || "-"}`,
        extra: { status: cleanString(row.status), op_type: cleanString(row.op_type), net_kg: Number(row.net_weight_kg || 0) },
      });
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 8) as EntityRow[];
}

async function resolveCropStructureLines(context: AssistantToolContext, query: string | null): Promise<EntityRow[]> {
  const exactId = isUuidLike(query) || isUuidLike(context.runtimeContext.selectedCropStructureSectionId)
    ? (query || context.runtimeContext.selectedCropStructureSectionId)
    : null;
  const fieldCode = extractFieldCode(query || context.runtimeContext.selectedFieldLabel || context.runtimeContext.selectedFieldId);
  const season = context.runtimeContext.season || context.runtimeContext.defaultSeason || DEFAULT_SEASON;
  if (!exactId && !fieldCode && !cleanString(query) && !context.runtimeContext.selectedCrop) return [];

  let q = context.supabase
    .from("crop_structure")
    .select("id,field_id,crop_id,variety_id,reproduction_id,area,season_year,season,archived")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .limit(220);
  if (exactId) q = q.eq("id", exactId);
  const res = await q;
  if (res.error) return [];

  const fieldIds = Array.from(new Set((res.data || []).map((row: any) => cleanString(row.field_id)).filter(Boolean)));
  const cropIds = Array.from(new Set((res.data || []).map((row: any) => cleanString(row.crop_id)).filter(Boolean)));
  const varietyIds = Array.from(new Set((res.data || []).map((row: any) => cleanString(row.variety_id)).filter(Boolean)));
  const [fieldsRes, cropsRes, varietiesRes] = await Promise.all([
    fieldIds.length ? context.supabase.from("fields").select("id,name").in("id", fieldIds as string[]) : Promise.resolve({ data: [], error: null } as any),
    cropIds.length ? context.supabase.from("crops").select("id,name,name_ru").in("id", cropIds as string[]) : Promise.resolve({ data: [], error: null } as any),
    varietyIds.length ? context.supabase.from("varieties").select("id,name").in("id", varietyIds as string[]) : Promise.resolve({ data: [], error: null } as any),
  ]);
  const byField = new Map<string, string>((fieldsRes.data || []).map((row: any) => [String(row.id), String(row.name || row.id)]));
  const byCrop = new Map<string, string>((cropsRes.data || []).map((row: any) => [String(row.id), String(row.name_ru || row.name || row.id)]));
  const byVariety = new Map<string, string>((varietiesRes.data || []).map((row: any) => [String(row.id), String(row.name || row.id)]));

  return (res.data || [])
    .map((row: any) => {
      const id = String(row.id);
      const fieldName = byField.get(String(row.field_id || "")) || "";
      const cropName = byCrop.get(String(row.crop_id || "")) || "";
      const varietyName = byVariety.get(String(row.variety_id || "")) || "";
      const label = [fieldName, cropName, varietyName, `${Number(row.area || 0)} ha`].filter(Boolean).join(" - ");
      const blob = `${id} ${fieldName} ${cropName} ${varietyName} ${row.season_year || row.season || ""}`;
      const score = Math.max(scoreMatch(blob, query || context.runtimeContext.selectedCrop, exactId), exactId && id === exactId ? 1000 : 0);
      if (!exactId && fieldCode && !normalizeText(fieldName).includes(fieldCode)) return null;
      if (!exactId && season && cleanString(row.season_year) && String(row.season_year) !== String(season)) return null;
      if (score <= 0 && !fieldCode && !exactId) return null;
      return entityRow({
        type: "crop_structure_line",
        id,
        name: label || id,
        page: "crop-structure",
        route: "/crop-structure",
        filters: { sectionId: id, cropStructureId: id, entityId: id, entityType: "crop_structure_line", search: fieldName || cropName || id },
        confidence: Math.min(1, (score || 250) / 500),
        summary: label,
        extra: { field_id: cleanString(row.field_id), field_name: fieldName, crop_name: cropName, variety_name: varietyName, area_ha: Number(row.area || 0) },
      });
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 8) as EntityRow[];
}

async function resolveBatches(context: AssistantToolContext, query: string | null): Promise<EntityRow[]> {
  const exactId = isUuidLike(query) || isUuidLike(context.runtimeContext.selectedBatchId) ? (query || context.runtimeContext.selectedBatchId) : null;
  const needle = cleanString(query) || context.runtimeContext.selectedBatchLabel || context.runtimeContext.selectedBatchId;
  if (!needle && !exactId) return [];

  let q = context.supabase
    .from("inventory_batches")
    .select("id,batch_code,batch_class,origin_type,supplier_lot,created_at")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(180);
  if (exactId) q = q.eq("id", exactId);
  const res = await q;
  if (res.error) return [];

  return (res.data || [])
    .map((row: any) => {
      const id = String(row.id);
      const name = cleanString(row.batch_code) || cleanString(row.supplier_lot) || id;
      const blob = `${id} ${name} ${row.batch_class || ""} ${row.origin_type || ""}`;
      const score = Math.max(scoreMatch(blob, needle, exactId), exactId && id === exactId ? 1000 : 0);
      if (score <= 0 && !exactId) return null;
      return entityRow({
        type: "batch",
        id,
        name,
        page: "warehouses",
        route: "/warehouses",
        filters: { batchId: id, entityId: id, entityType: "batch", search: name },
        confidence: Math.min(1, score / 500),
        summary: `${name}: ${row.batch_class || "-"}`,
      });
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 8) as EntityRow[];
}

export async function resolveAssistantEntityRows(
  context: AssistantToolContext,
  params?: { query?: string | null; entityType?: string | null; limit?: number }
): Promise<EntityRow[]> {
  const query = getContextQuery(context, params?.query);
  const requestedType = cleanString(params?.entityType || context.intent.parameters.entityType)?.toLowerCase();
  const resolvers: Array<[AssistantResolvedEntityType, () => Promise<EntityRow[]>]> = [
    ["field", () => resolveFields(context, query)],
    ["warehouse", () => resolveWarehouses(context, query)],
    ["operation", () => resolveOperations(context, query)],
    ["ticket", () => resolveTickets(context, query)],
    ["crop_structure_line", () => resolveCropStructureLines(context, query)],
    ["batch", () => resolveBatches(context, query)],
  ];
  const selectedResolvers = requestedType
    ? resolvers.filter(([type]) => type === requestedType || (requestedType === "crop_structure_section" && type === "crop_structure_line"))
    : resolvers;
  const batches = await Promise.all(selectedResolvers.map(([, run]) => run().catch(() => [])));
  const rows = batches
    .flat()
    .sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, params?.limit || 12);
  return rows;
}

export async function buildQuickInsightRows(context: AssistantToolContext): Promise<EntityRow[]> {
  const explicitType = cleanString(context.intent.parameters.entityType);
  const resolved = await resolveAssistantEntityRows(context, {
    entityType: explicitType,
    limit: 1,
  });
  const entity = resolved[0];
  if (!entity) {
    return collectAssistantContextRows(context);
  }

  const entityType = cleanString(entity.entity_type);
  const entityId = cleanString(entity.entity_id);
  if (!entityType || !entityId) return [entity];

  if (entityType === "field") {
    const [operationsRes, structureRes] = await Promise.all([
      context.supabase
        .from("operations")
        .select("id,status,work_status")
        .eq("company_id", context.companyId)
        .eq("field_id", entityId)
        .eq("archived", false)
        .limit(120),
      context.supabase
        .from("crop_structure")
        .select("id,area,crop_id,season_year,season")
        .eq("company_id", context.companyId)
        .eq("field_id", entityId)
        .eq("archived", false)
        .limit(80),
    ]);
    const operations = operationsRes.error ? [] : operationsRes.data || [];
    const structure = structureRes.error ? [] : structureRes.data || [];
    return [
      {
        ...entity,
        active_operations: operations.filter((row: any) => ["active", "in_progress", "ready_to_close", "paused"].includes(normalizeText(row.work_status || row.status))).length,
        crop_structure_sections: structure.length,
        planned_area_ha: Number(structure.reduce((sum: number, row: any) => sum + Number(row.area || 0), 0).toFixed(2)),
        risk_hint: operations.some((row: any) => normalizeText(row.work_status || row.status).includes("paused")) ? "paused_operations" : "none_detected",
      },
    ];
  }

  if (entityType === "operation") {
    const [progressRes, materialsRes] = await Promise.all([
      context.supabase
        .from("operation_progress")
        .select("id,area_ha,progress_status,reason,created_at")
        .eq("company_id", context.companyId)
        .eq("operation_id", entityId)
        .order("created_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("operation_materials")
        .select("id,product_id,planned_quantity,issued_quantity,consumed_quantity,returned_quantity,unit")
        .eq("operation_id", entityId)
        .limit(50),
    ]);
    const progressRows = progressRes.error ? [] : progressRes.data || [];
    const materialRows = materialsRes.error ? [] : materialsRes.data || [];
    return [
      {
        ...entity,
        progress_entries: progressRows.length,
        done_area_ha: Number(progressRows.reduce((sum: number, row: any) => sum + Number(row.area_ha || 0), 0).toFixed(2)),
        last_progress_status: cleanString(progressRows[0]?.progress_status),
        stop_reason: cleanString(progressRows[0]?.reason),
        materials_count: materialRows.length,
      },
    ];
  }

  if (entityType === "warehouse") {
    const balanceRes = await context.supabase
      .from("v_stock_balance_identity")
      .select("quantity,warehouse_id,product_id,batch_class")
      .eq("company_id", context.companyId)
      .eq("warehouse_id", entityId)
      .limit(500);
    const balances = balanceRes.error ? [] : balanceRes.data || [];
    return [
      {
        ...entity,
        stock_rows: balances.length,
        total_quantity: Number(balances.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0).toFixed(3)),
        problem_items: balances.filter((row: any) => Number(row.quantity || 0) < 0).length,
      },
    ];
  }

  return [entity];
}

export async function buildMorningReportRows(context: AssistantToolContext): Promise<EntityRow[]> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yyyy = yesterday.getFullYear();
  const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
  const dd = String(yesterday.getDate()).padStart(2, "0");
  const yesterdayDate = `${yyyy}-${mm}-${dd}`;

  const [operationsRes, ticketsRes, balancesRes] = await Promise.all([
    context.supabase
      .from("operations")
      .select("id,date,status,work_status,operation_type,field_id")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .limit(400),
    context.supabase
      .from("tickets")
      .select("id,ticket_no,status,op_type,created_at")
      .eq("company_id", context.companyId)
      .order("created_at", { ascending: false })
      .limit(80),
    context.supabase
      .from("v_stock_balance_identity")
      .select("quantity,product_id,warehouse_id")
      .eq("company_id", context.companyId)
      .limit(800),
  ]);

  const operations = operationsRes.error ? [] : operationsRes.data || [];
  const tickets = ticketsRes.error ? [] : ticketsRes.data || [];
  const balances = balancesRes.error ? [] : balancesRes.data || [];
  const activeOps = operations.filter((row: any) => ["active", "in_progress", "paused", "ready_to_close"].includes(normalizeText(row.work_status || row.status)));
  const doneYesterday = operations.filter((row: any) => String(row.date || "").slice(0, 10) === yesterdayDate && ["completed", "done"].includes(normalizeText(row.work_status || row.status)));

  return [
    {
      report_type: "morning_report",
      company_id: context.companyId,
      season: context.runtimeContext.season || context.runtimeContext.defaultSeason || DEFAULT_SEASON,
      yesterday: yesterdayDate,
      operations_done_yesterday: doneYesterday.length,
      active_operations: activeOps.length,
      paused_operations: activeOps.filter((row: any) => normalizeText(row.work_status || row.status) === "paused").length,
      tickets_open: tickets.filter((row: any) => ["active", "draft", "ready_to_close"].includes(normalizeText(row.status))).length,
      last_tickets: tickets.slice(0, 5).map((row: any) => cleanString(row.ticket_no) || cleanString(row.id)),
      negative_stock_rows: balances.filter((row: any) => Number(row.quantity || 0) < 0).length,
      low_stock_rows: balances.filter((row: any) => Number(row.quantity || 0) > 0 && Number(row.quantity || 0) <= 100).length,
    },
  ];
}

export async function buildWarehouseInsightRows(context: AssistantToolContext): Promise<EntityRow[]> {
  const rows = await resolveWarehouses(context, getContextQuery(context));
  const scopedRows = rows.length ? rows.slice(0, 5) : [entityRow({ type: "warehouse", id: null, name: "all warehouses", page: "warehouses", route: "/warehouses" })].filter(Boolean) as EntityRow[];
  const balanceRes = await context.supabase
    .from("v_stock_balance_identity")
    .select("quantity,warehouse_id,product_id,batch_class")
    .eq("company_id", context.companyId)
    .limit(1200);
  const balances = balanceRes.error ? [] : balanceRes.data || [];
  return scopedRows.map((row) => {
    const warehouseId = cleanString(row.entity_id);
    const scopedBalances = warehouseId ? balances.filter((item: any) => String(item.warehouse_id) === warehouseId) : balances;
    return {
      ...row,
      insight_type: "warehouse",
      stock_rows: scopedBalances.length,
      total_quantity: Number(scopedBalances.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0).toFixed(3)),
      awaiting_issue: null,
      awaiting_return: null,
      negative_rows: scopedBalances.filter((item: any) => Number(item.quantity || 0) < 0).length,
    };
  });
}

export async function buildWeighbridgeInsightRows(context: AssistantToolContext): Promise<EntityRow[]> {
  const res = await context.supabase
    .from("tickets")
    .select("id,ticket_no,status,op_type,created_at,finalized_at,net_weight_kg,accepted_weight_kg,field_id,requires_review,review_reason,is_voided,correction_of_ticket_id,linked_processing_id,processing_output_role,lines:ticket_lines(product_name_snapshot,moisture_percent)")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = res.error ? [] : res.data || [];
  const active = rows.filter((row: any) => ["active", "draft", "ready_to_close"].includes(normalizeText(row.status)));
  const now = Date.now();
  const stale = active.filter((row: any) => {
    const openedAt = Date.parse(String(row.created_at || ""));
    return Number.isFinite(openedAt) && now - openedAt >= 6 * 60 * 60 * 1000;
  });
  const today = new Date().toISOString().slice(0, 10);
  const todayHarvest = rows.filter((row: any) =>
    !row.is_voided &&
    normalizeText(row.status) === "finalized" &&
    includesAny(row.op_type, ["harvest", "field", "урожай", "поле"]) &&
    String(row.finalized_at || row.created_at || "").slice(0, 10) === today
  );
  const todayMoisture = todayHarvest
    .flatMap((row: any) => Array.isArray(row.lines) ? row.lines : [])
    .map((line: any) => Number(line.moisture_percent))
    .filter((value: number) => Number.isFinite(value) && value >= 0);
  const receipts = rows.filter((row: any) => includesAny(row.op_type, ["supplier", "receipt", "incoming", "\u043f\u0440\u0438\u0445\u043e\u0434", "\u043f\u043e\u0441\u0442\u0430\u0432"]));
  const shipments = rows.filter((row: any) => includesAny(row.op_type, ["outbound", "shipment", "\u043e\u0442\u0433\u0440\u0443\u0437"]));
  return [
    {
      insight_type: "weighbridge",
      active_tickets: active.length,
      unclosed_tickets: active.length,
      stale_over_6h: stale.length,
      stale_ticket_numbers: stale.slice(0, 8).map((row: any) => cleanString(row.ticket_no) || cleanString(row.id)),
      requires_review: rows.filter((row: any) => Boolean(row.requires_review) && !row.is_voided).length,
      review_ticket_numbers: rows
        .filter((row: any) => Boolean(row.requires_review) && !row.is_voided)
        .slice(0, 8)
        .map((row: any) => cleanString(row.ticket_no) || cleanString(row.id)),
      today_harvest_trips: todayHarvest.length,
      today_harvest_accepted_kg: Number(todayHarvest.reduce(
        (sum: number, row: any) => sum + Number(row.accepted_weight_kg ?? row.net_weight_kg ?? 0),
        0
      ).toFixed(3)),
      today_harvest_fields: new Set(todayHarvest.map((row: any) => cleanString(row.field_id)).filter(Boolean)).size,
      today_average_moisture_percent: todayMoisture.length
        ? Number((todayMoisture.reduce((sum: number, value: number) => sum + value, 0) / todayMoisture.length).toFixed(2))
        : null,
      corrections_recent: rows.filter((row: any) => Boolean(row.correction_of_ticket_id)).length,
      voided_recent: rows.filter((row: any) => Boolean(row.is_voided) || normalizeText(row.status) === "voided").length,
      processing_tickets_recent: rows.filter((row: any) => Boolean(row.linked_processing_id || row.processing_output_role)).length,
      recent_receipts: receipts.slice(0, 5).map((row: any) => cleanString(row.ticket_no) || cleanString(row.id)),
      recent_shipments: shipments.slice(0, 5).map((row: any) => cleanString(row.ticket_no) || cleanString(row.id)),
      recent_tickets: rows.slice(0, 5).map((row: any) => ({
        ticket_no: cleanString(row.ticket_no) || cleanString(row.id),
        status: cleanString(row.status),
        op_type: cleanString(row.op_type),
        net_kg: Number(row.net_weight_kg || 0),
      })),
    },
  ];
}
