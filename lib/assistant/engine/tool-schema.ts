import type {
  AssistantIntent,
  AssistantIntentName,
  AssistantNavigationAction,
  AssistantToolName,
  AssistantUiContext,
} from "@/lib/assistant/engine/types";

export type PlannerToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type PlannerToolMapping = {
  assistantTool: AssistantToolName;
  intentName: AssistantIntentName;
  buildParams: (args: Record<string, unknown>, message: string, runtimeContext: AssistantUiContext) => Record<string, unknown>;
  buildNavigation?: (args: Record<string, unknown>, rows: Array<Record<string, unknown>>) => AssistantNavigationAction[];
};

function text(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw.length ? raw : null;
}

function int(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function numberValue(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toFiltersObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const normalized = text(item);
    if (normalized) out[key] = normalized;
  });
  return out;
}

function normalizeNavigationTarget(args: Record<string, unknown>, message?: string): {
  page: string;
  route: string;
  filters: Record<string, string>;
} {
  const filters = toFiltersObject(args.filters);
  const rawPage = text(args.page) || "dashboard";
  const rawRoute = text(args.route) || "/dashboard";
  const haystack = `${rawPage} ${rawRoute} ${message || ""}`.toLowerCase();

  if (/(my\s+tasks?|tasks?|мо[ия]\s+задач|задач[аиу]?)/i.test(haystack)) {
    return { page: "tasks", route: "/tasks", filters };
  }
  if (/(fields?-?map|field\s+map|карта\s+пол|карту\s+пол|карте\s+пол)/i.test(haystack)) {
    return { page: "fields-map", route: "/fields-map", filters };
  }
  if (/(meal-?orders?|meal-?thermoses|thermos|термос|питан|обед|ужин|завтрак)/i.test(haystack)) {
    return { page: "meal-thermoses", route: "/meal-thermoses", filters };
  }
  if (/(recent|latest|history|последн|истори)/i.test(haystack) && /(ticket|weighbridge|талон|весов)/i.test(haystack)) {
    return { page: "weighbridge-history", route: "/weighbridge/history", filters };
  }
  if (rawRoute === "/meal-orders") {
    return { page: "meal-thermoses", route: "/meal-thermoses", filters };
  }
  return { page: rawPage, route: rawRoute, filters };
}

const CREATE_OPERATION_DRAFT_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string" },
    field: { type: "string" },
    field_id: { type: "string" },
    field_label: { type: "string" },
    crop_structure: { type: "string" },
    crop_structure_id: { type: "string" },
    crop_structure_label: { type: "string" },
    operation_type: { type: "string" },
    area_ha: { type: "number" },
    date: { type: "string" },
    spray_volume_per_ha: { type: "number" },
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          product: { type: "string" },
          product_name: { type: "string" },
          rate_per_ha: { type: "number" },
          unit: { type: "string" },
        },
        additionalProperties: true,
      },
    },
    responsible: { type: "string" },
    comment: { type: "string" },
  },
  additionalProperties: false,
};

function buildEntityNavigationFromRows(rows: Array<Record<string, unknown>>): AssistantNavigationAction[] {
  const row = rows[0] || {};
  const entityType = text(row.entity_type);
  const entityId = text(row.entity_id);
  const entityName = text(row.entity_name);
  const route = text(row.route);
  const page = text(row.page) || "dashboard";
  const filters = toFiltersObject(row.filters);
  if (!entityType || !route || !entityId) return [];
  if (!["warehouse", "field", "fuel", "operation", "ticket", "crop_structure_line", "batch"].includes(entityType)) {
    return [];
  }
  return [
    {
      type: "open_entity",
      page,
      route,
      entityType: entityType as "warehouse" | "field" | "fuel" | "operation" | "ticket" | "crop_structure_line" | "batch",
      entityId,
      entityQuery: entityName,
      filters,
    },
  ];
}

const TOOL_MAP: Record<string, PlannerToolMapping> = {
  get_current_context: {
    assistantTool: "get_current_context",
    intentName: "company_context",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  resolve_entity: {
    assistantTool: "resolve_entity",
    intentName: "entity_resolution",
    buildParams: (args, message) => ({
      query: text(args.query) || text(args.entity) || message,
      entityType: text(args.entity_type) || text(args.entityType),
      limit: int(args.limit, 12),
      output_type: "list",
    }),
  },
  get_quick_insights: {
    assistantTool: "get_quick_insights",
    intentName: "fields_overview",
    buildParams: (args, message) => ({
      query: text(args.query) || text(args.entity) || message,
      entityType: text(args.entity_type) || text(args.entityType),
      output_type: "filtered_summary",
    }),
  },
  get_morning_report: {
    assistantTool: "get_morning_report",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "summary_total",
    }),
  },
  get_operation_insights: {
    assistantTool: "get_operation_insights",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.query) || text(args.operation) || message,
      entityType: "operation",
      output_type: "filtered_summary",
    }),
  },
  get_warehouse_insights: {
    assistantTool: "get_warehouse_insights",
    intentName: "inventory_balance",
    buildParams: (args, message) => ({
      query: text(args.query) || text(args.warehouse) || message,
      warehouse: text(args.warehouse),
      entityType: "warehouse",
      output_type: "filtered_summary",
    }),
  },
  get_weighbridge_insights: {
    assistantTool: "get_weighbridge_insights",
    intentName: "weighbridge_tickets",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  get_warehouse_count: {
    assistantTool: "get_warehouse_count",
    intentName: "warehouse_count",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "summary_total",
    }),
  },
  list_warehouses: {
    assistantTool: "get_warehouse_count",
    intentName: "warehouse_count",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "list",
    }),
  },
  get_warehouse_stock: {
    assistantTool: "get_warehouse_stock",
    intentName: "inventory_balance",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      product: text(args.product),
      warehouse_alias: text(args.warehouse),
      allWarehouses: text(args.warehouse) ? false : true,
      output_type: "balance",
    }),
  },
  get_warehouse_movements: {
    assistantTool: "get_warehouse_movements",
    intentName: "warehouse_movements",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      product: text(args.product),
      warehouse_alias: text(args.warehouse),
      limit: int(args.limit, 10),
      output_type: "movements",
    }),
  },
  get_warehouse_balance_summary: {
    assistantTool: "get_warehouse_summary",
    intentName: "inventory_balance",
    buildParams: (args, message) => {
      const query = text(args.query) || message;
      const warehouse = text(args.warehouse);
      return {
        query,
        product: text(args.product),
        warehouse_alias: warehouse,
        warehouse,
        allWarehouses: warehouse ? false : true,
        negative_only: /(\u043e\u0442\u0440\u0438\u0446\u0430\u0442|\u043c\u0438\u043d\u0443\u0441|negative|below\s+zero)/i.test(query),
        output_type: "balance",
      };
    },
  },
  get_field_land_bank_summary: {
    assistantTool: "get_field_land_bank_summary",
    intentName: "field_total_area",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "summary_total",
      source_of_truth: "fields",
    }),
  },
  get_field_card: {
    assistantTool: "get_field_card",
    intentName: "fields_overview",
    buildParams: (args, message) => ({
      query: text(args.field) || text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  list_fields: {
    assistantTool: "search_fields",
    intentName: "fields_overview",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "list",
    }),
  },
  get_field_materials: {
    assistantTool: "get_field_materials",
    intentName: "fields_overview",
    buildParams: (args, message) => ({
      query: text(args.field) || text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  get_field_operations: {
    assistantTool: "get_field_timeline",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.field) ? `field ${text(args.field)}` : text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  get_active_operations_summary: {
    assistantTool: "get_active_operations_summary",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      status: "active",
      limit: int(args.limit, 30),
      output_type: "summary_total",
    }),
  },
  get_crop_structure_summary: {
    assistantTool: "get_crop_structure_summary",
    intentName: "crop_structure_area",
    buildParams: (args, message, runtimeContext) => ({
      query: text(args.query) || message,
      crop_alias: text(args.crop),
      crop_group: text(args.crop_group),
      variety: text(args.variety),
      season: text(args.season) || runtimeContext.season || runtimeContext.defaultSeason || "2026",
      output_type: text(args.crop) || text(args.crop_group) ? "filtered_summary" : "summary_total",
    }),
  },
  get_crop_area_by_crop: {
    assistantTool: "get_crop_structure_summary",
    intentName: "crop_structure_area",
    buildParams: (args, message, runtimeContext) => ({
      query: text(args.crop) || text(args.query) || message,
      crop_alias: text(args.crop),
      season: text(args.season) || runtimeContext.season || runtimeContext.defaultSeason || "2026",
      output_type: "filtered_summary",
    }),
  },
  get_active_tickets: {
    assistantTool: "get_active_tickets",
    intentName: "weighbridge_tickets",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      status: "active",
      output_type: "filtered_summary",
    }),
  },
  get_recent_tickets: {
    assistantTool: "get_recent_tickets",
    intentName: "weighbridge_tickets",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      limit: int(args.limit, 5),
      output_type: "filtered_summary",
    }),
  },
  get_latest_ticket: {
    assistantTool: "get_recent_tickets",
    intentName: "weighbridge_tickets",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      limit: 1,
      output_type: "filtered_summary",
    }),
  },
  get_recent_operations: {
    assistantTool: "get_operations",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      limit: int(args.limit, 10),
      output_type: "list",
    }),
  },
  get_operations_by_field: {
    assistantTool: "get_field_timeline",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.field) ? `field ${text(args.field)}` : text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  navigate_to_page: {
    assistantTool: "navigate_to_page",
    intentName: "navigation_help",
    buildParams: (args, message) => {
      const target = normalizeNavigationTarget(args, message);
      return {
        action: "open_page",
        page: target.page,
        route: target.route,
        filters: JSON.stringify(target.filters),
        output_type: "action_navigation",
      };
    },
    buildNavigation: (args, rows) => {
      const row = rows[0] || {};
      const target = normalizeNavigationTarget(
        {
          page: text((row as any).page) || args.page,
          route: text((row as any).route) || args.route,
          filters: (row as any).filters || args.filters,
        },
        ""
      );
      const { page, route, filters } = target;
      if (!Object.keys(filters).length) return [{ type: "open_page", page, route }];
      return [{ type: "open_page_with_filter", page, route, filters }];
    },
  },
  open_field: {
    assistantTool: "resolve_field_by_number",
    intentName: "navigation_help",
    buildParams: (args, message) => ({
      query: text(args.field) || text(args.query) || message,
      output_type: "action_navigation",
    }),
    buildNavigation: (args, rows) => {
      const row = rows[0] || {};
      const entityId = text((row as any).entity_id);
      const entityName = text((row as any).entity_name) || text(args.field) || text(args.query);
      if (!entityId) return [];
      return [
        {
          type: "open_entity",
          page: "field-card",
          route: `/fields/${entityId}`,
          entityType: "field",
          entityId,
          entityQuery: entityName,
          filters: {
            tab: "summary",
            search: entityName || entityId,
            entityId,
            entityType: "field",
          },
        },
      ];
    },
  },
  open_warehouse: {
    assistantTool: "resolve_warehouse_by_name",
    intentName: "navigation_help",
    buildParams: (args, message) => ({
      query: text(args.warehouse) || text(args.query) || message,
      output_type: "action_navigation",
    }),
    buildNavigation: (args, rows) => {
      const row = rows[0] || {};
      const entityId = text((row as any).entity_id);
      const entityName = text((row as any).entity_name) || text(args.warehouse) || text(args.query);
      if (!entityId) return [];
      return [
        {
          type: "open_entity",
          page: "warehouses",
          route: "/warehouses",
          entityType: "warehouse",
          entityId,
          entityQuery: entityName,
          filters: {
            search: entityName || entityId,
            entityId,
            entityType: "warehouse",
            warehouseId: entityId,
          },
        },
      ];
    },
  },
  open_operation: {
    assistantTool: "resolve_entity",
    intentName: "navigation_help",
    buildParams: (args, message) => ({
      query: text(args.operation) || text(args.query) || message,
      entityType: "operation",
      output_type: "action_navigation",
    }),
    buildNavigation: (_args, rows) => buildEntityNavigationFromRows(rows),
  },
  open_ticket: {
    assistantTool: "resolve_entity",
    intentName: "navigation_help",
    buildParams: (args, message) => ({
      query: text(args.ticket) || text(args.query) || message,
      entityType: "ticket",
      output_type: "action_navigation",
    }),
    buildNavigation: (_args, rows) => buildEntityNavigationFromRows(rows),
  },
  open_crop_structure_section: {
    assistantTool: "resolve_entity",
    intentName: "navigation_help",
    buildParams: (args, message) => ({
      query: text(args.section) || text(args.field) || text(args.query) || message,
      entityType: "crop_structure_line",
      output_type: "action_navigation",
    }),
    buildNavigation: (_args, rows) => buildEntityNavigationFromRows(rows),
  },
  open_batch: {
    assistantTool: "resolve_entity",
    intentName: "navigation_help",
    buildParams: (args, message) => ({
      query: text(args.batch) || text(args.query) || message,
      entityType: "batch",
      output_type: "action_navigation",
    }),
    buildNavigation: (_args, rows) => buildEntityNavigationFromRows(rows),
  },
  create_weighbridge_ticket_draft: {
    assistantTool: "create_weighbridge_ticket_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      movement_type: text(args.movement_type) || text(args.direction),
      warehouse: text(args.warehouse),
      counterparty_or_source: text(args.counterparty_or_source) || text(args.counterparty) || text(args.supplier) || text(args.source),
      product_lines: text(args.product_lines) || text(args.products) || text(args.materials),
      document_number: text(args.document_number) || text(args.document),
      tool: "create_weighbridge_ticket_draft",
      output_type: "filtered_summary",
    }),
  },
  create_operation_draft: {
    assistantTool: "create_operation_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      field: text(args.field),
      field_id: text(args.field_id),
      field_label: text(args.field_label),
      crop_structure: text(args.crop_structure),
      crop_structure_id: text(args.crop_structure_id),
      crop_structure_label: text(args.crop_structure_label),
      operation_type: text(args.operation_type),
      area_ha: numberValue(args.area_ha),
      date: text(args.date),
      spray_volume_per_ha: numberValue(args.spray_volume_per_ha),
      materials: Array.isArray(args.materials) ? args.materials : undefined,
      responsible: text(args.responsible),
      comment: text(args.comment),
      tool: "create_operation_draft",
      output_type: "filtered_summary",
    }),
  },
  create_field_draft: {
    assistantTool: "create_field_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      name: text(args.name) || text(args.field),
      area_ha: numberValue(args.area_ha) || numberValue(args.area),
      crop: text(args.crop),
      location: text(args.location),
      tool: "create_field_draft",
      output_type: "filtered_summary",
    }),
  },
  create_meal_order_draft: {
    assistantTool: "create_meal_order_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      meal_date: text(args.meal_date) || text(args.date),
      meal_type: text(args.meal_type) || text(args.type),
      people: text(args.people) || text(args.persons) || text(args.count),
      location: text(args.location),
      comment: text(args.comment),
      tool: "create_meal_order_draft",
      output_type: "filtered_summary",
    }),
  },
  create_warehouse_draft: {
    assistantTool: "create_warehouse_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      name: text(args.name),
      warehouse_type: text(args.warehouse_type) || text(args.type),
      capacity: numberValue(args.capacity),
      location: text(args.location),
      tool: "create_warehouse_draft",
      output_type: "filtered_summary",
    }),
  },
  create_transfer_draft: {
    assistantTool: "create_transfer_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      source_warehouse: text(args.source_warehouse) || text(args.from_warehouse),
      destination_warehouse: text(args.destination_warehouse) || text(args.to_warehouse),
      product_lines: text(args.product_lines) || text(args.products) || text(args.materials),
      tool: "create_transfer_draft",
      output_type: "filtered_summary",
    }),
  },
  create_fuel_issue_draft: {
    assistantTool: "create_fuel_issue_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      fuel_source: text(args.fuel_source) || text(args.source),
      vehicle_or_machine: text(args.vehicle_or_machine) || text(args.vehicle) || text(args.machine),
      quantity: numberValue(args.quantity),
      unit: text(args.unit),
      tool: "create_fuel_issue_draft",
      output_type: "filtered_summary",
    }),
  },
  create_field_task_draft: {
    assistantTool: "create_field_task_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      field: text(args.field),
      crop_structure: text(args.crop_structure),
      task: text(args.task),
      date: text(args.date),
      responsible: text(args.responsible),
      tool: "create_field_task_draft",
      output_type: "filtered_summary",
    }),
  },
  create_material_issue_draft: {
    assistantTool: "create_material_issue_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      operation: text(args.operation),
      materials: text(args.materials) || text(args.product_lines) || text(args.products),
      warehouse: text(args.warehouse),
      date: text(args.date),
      tool: "create_material_issue_draft",
      output_type: "filtered_summary",
    }),
  },
};

export function getPlannerToolSchemas(): PlannerToolSchema[] {
  const schemas: PlannerToolSchema[] = [
    {
      type: "function",
      function: {
        name: "get_current_context",
        description:
          "Returns current UI context: company, season, page, route, user role, selected field, crop structure section, operation, warehouse, ticket, batch, and filters.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "resolve_entity",
        description:
          "Resolve user text to real ERP entity candidates: field, warehouse, operation, ticket, crop structure section, or batch. Use for phrases like Field 28, WR-2026-000025, Gala, vegetable warehouse, SZR warehouse.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            entity_type: {
              type: "string",
              enum: ["field", "warehouse", "operation", "ticket", "crop_structure_line", "batch"],
            },
            limit: { type: "integer", minimum: 1, maximum: 30 },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_quick_insights",
        description:
          "Quick context-aware read-only summary for the current/resolved entity. Use for short follow-ups like 'how much left?', 'what is here?', 'what are the risks?' when page/entity context matters.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            entity_type: {
              type: "string",
              enum: ["field", "warehouse", "operation", "ticket", "crop_structure_line", "batch"],
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_morning_report",
        description:
          "Read-only morning report foundation: yesterday done operations, active/paused operations, open tickets, low/negative stock rows.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_operation_insights",
        description: "Read-only operation insight: status, progress entries, done area, stop reason and material count.",
        parameters: { type: "object", properties: { query: { type: "string" }, operation: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_warehouse_insights",
        description: "Read-only warehouse insight: balances, problem rows, issued/return placeholders.",
        parameters: { type: "object", properties: { query: { type: "string" }, warehouse: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_weighbridge_insights",
        description: "Read-only weighbridge insight: active/unclosed tickets, recent receipts and shipments.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_warehouse_count",
        description: "Считает количество складов компании.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "list_warehouses",
        description: "Возвращает список складов компании.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_warehouse_stock",
        description:
          "Возвращает остатки по продукту/складу. Используйте только если пользователь явно просит остаток/наличие/склад/stock/balance. Не используйте для голого названия продукта или короткого неоднозначного слова без запроса данных. Если пользователь указал овощной, семенной, зерновой, удобрения или СЗР склад, обязательно передайте это в warehouse.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            product: { type: "string" },
            warehouse: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_warehouse_movements",
        description:
          "Возвращает последние складские движения/ledger. Используйте для follow-up 'последние движения' после вопроса про остатки или склад.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            product: { type: "string" },
            warehouse: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 30 },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_warehouse_balance_summary",
        description:
          "Возвращает сводку остатков по складам. Используйте только для явного вопроса об остатках/наличии/складах, а не для короткого неоднозначного слова.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_field_land_bank_summary",
        description:
          "Source of Truth for company land bank totals: total fields and total hectares. Use only this tool for total fields, total hectares, overall farm area, land bank, and company field area. Do not use list_fields/search_fields for totals.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_field_card",
        description: "Возвращает сводную карточку поля.",
        parameters: { type: "object", properties: { field: { type: "string" }, query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "list_fields",
        description: "Возвращает список полей.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_field_materials",
        description: "Возвращает материалы по полю.",
        parameters: { type: "object", properties: { field: { type: "string" }, query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_field_operations",
        description: "Возвращает операции по полю.",
        parameters: { type: "object", properties: { field: { type: "string" }, query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_crop_structure_summary",
        description: "Возвращает структуру посевов и площадь по сезону.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            crop: { type: "string" },
            crop_group: { type: "string" },
            variety: { type: "string" },
            season: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_crop_area_by_crop",
        description: "Возвращает площадь по конкретной культуре.",
        parameters: {
          type: "object",
          properties: {
            crop: { type: "string" },
            season: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_active_tickets",
        description: "Возвращает активные талоны весовой с полем, культурой, сортом, репродукцией, маршрутом, машиной, водителем, весовщиком, весами, влажностью и признаками проверки.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_recent_tickets",
        description: "Возвращает последние талоны весовой. Используйте для фактических вопросов агронома о рейсах, урожае, весе, влажности, маршруте, исправлениях и аннулированиях.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 30 },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_latest_ticket",
        description: "Возвращает самый последний талон весовой со всей доступной агрономической и весовой идентичностью.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_active_operations_summary",
        description: "Canonical Source of Truth for active/current operations. Use for questions like: how many active operations, show active operations, operations in work.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_recent_operations",
        description: "Возвращает последние операции.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 30 },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_operations_by_field",
        description: "Возвращает операции по указанному полю.",
        parameters: { type: "object", properties: { field: { type: "string" }, query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "navigate_to_page",
        description: "Открывает страницу ERP (только по явной команде пользователя).",
        parameters: {
          type: "object",
          properties: {
            page: { type: "string" },
            route: { type: "string" },
            filters: { type: "object" },
          },
          required: ["page", "route"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_field",
        description: "Открывает поле по номеру или названию (только по явной команде).",
        parameters: {
          type: "object",
          properties: {
            field: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_warehouse",
        description: "Открывает склад по названию (только по явной команде).",
        parameters: {
          type: "object",
          properties: {
            warehouse: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_operation",
        description: "Prepares navigation to an operation by name, id, field, crop, or status. Use only for explicit open/navigation commands.",
        parameters: {
          type: "object",
          properties: {
            operation: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_ticket",
        description: "Prepares navigation to a weighbridge ticket by ticket number/id, for example WR-2026-000025. Use only for explicit open/navigation commands.",
        parameters: {
          type: "object",
          properties: {
            ticket: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_crop_structure_section",
        description: "Prepares navigation to a crop-structure section/row by field, crop, variety, reproduction, or section id. Use only for explicit open/navigation commands.",
        parameters: {
          type: "object",
          properties: {
            section: { type: "string" },
            field: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_batch",
        description: "Prepares navigation to an inventory batch/lot by batch code, product, or warehouse. Use only for explicit open/navigation commands.",
        parameters: {
          type: "object",
          properties: {
            batch: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_weighbridge_ticket_draft",
        description: "Готовит безопасный черновик талона весовой. Если данных не хватает, возвращает список недостающих полей.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            movement_type: { type: "string" },
            warehouse: { type: "string" },
            counterparty_or_source: { type: "string" },
            product_lines: { type: "string" },
            document_number: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_operation_draft",
        description: "Готовит безопасный черновик операции. Если данных не хватает, возвращает список недостающих полей.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "create_field_draft",
        description: "Готовит безопасный черновик поля. Если данных не хватает, возвращает список недостающих полей.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            name: { type: "string" },
            area_ha: { type: "number" },
            crop: { type: "string" },
            location: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_meal_order_draft",
        description: "Готовит безопасный черновик заявки питания/термосов. Если данных не хватает, возвращает список недостающих полей.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            meal_date: { type: "string" },
            meal_type: { type: "string" },
            people: { type: "string" },
            location: { type: "string" },
            comment: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_warehouse_draft",
        description: "Готовит безопасный черновик склада. Если данных не хватает, возвращает список недостающих полей.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            name: { type: "string" },
            warehouse_type: { type: "string" },
            capacity: { type: "number" },
            location: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_transfer_draft",
        description: "Готовит безопасный черновик межскладского перемещения. Не создаёт ledger и не меняет остатки.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            source_warehouse: { type: "string" },
            destination_warehouse: { type: "string" },
            product_lines: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_fuel_issue_draft",
        description: "Готовит безопасный черновик выдачи ГСМ на машину или технику. Не списывает топливо.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            fuel_source: { type: "string" },
            vehicle_or_machine: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_field_task_draft",
        description: "Готовит безопасный черновик полевого задания без создания операции.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            field: { type: "string" },
            crop_structure: { type: "string" },
            task: { type: "string" },
            date: { type: "string" },
            responsible: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_material_issue_draft",
        description: "Готовит безопасный черновик выдачи материала под операцию. Не списывает склад и не создаёт заявку без подтверждения.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            operation: { type: "string" },
            materials: { type: "string" },
            warehouse: { type: "string" },
            date: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
  ];

  return schemas.map((schema) =>
    schema.function.name === "create_operation_draft"
      ? {
          ...schema,
          function: {
            ...schema.function,
            parameters: CREATE_OPERATION_DRAFT_PARAMETERS,
          },
        }
      : schema
  );
}

export function resolvePlannerToolCall(name: string): PlannerToolMapping | null {
  return TOOL_MAP[name] || null;
}

export function buildPlannerIntent(params: {
  mapping: PlannerToolMapping;
  args: Record<string, unknown>;
  message: string;
  runtimeContext: AssistantUiContext;
}): AssistantIntent {
  const intentParams = params.mapping.buildParams(params.args, params.message, params.runtimeContext);
  return {
    name: params.mapping.intentName,
    confidence: 1,
    needsData: true,
    parameters: intentParams as AssistantIntent["parameters"],
  };
}
