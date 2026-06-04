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
  buildParams: (args: Record<string, unknown>, message: string, runtimeContext: AssistantUiContext) => Record<string, string | number | boolean | null>;
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

const TOOL_MAP: Record<string, PlannerToolMapping> = {
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
    assistantTool: "get_operations",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.field) || text(args.query) || message,
      output_type: "list",
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
    assistantTool: "get_operations",
    intentName: "operations_recent",
    buildParams: (args, message) => ({
      query: text(args.field) || text(args.query) || message,
      output_type: "list",
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
  create_weighbridge_ticket_draft: {
    assistantTool: "create_weighbridge_ticket_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  create_operation_draft: {
    assistantTool: "create_operation_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  create_field_draft: {
    assistantTool: "create_field_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  create_meal_order_draft: {
    assistantTool: "create_meal_order_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
  create_warehouse_draft: {
    assistantTool: "create_warehouse_draft",
    intentName: "create_draft",
    buildParams: (args, message) => ({
      query: text(args.query) || message,
      output_type: "filtered_summary",
    }),
  },
};

export function getPlannerToolSchemas(): PlannerToolSchema[] {
  return [
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
          "Возвращает остатки по продукту/складу. Если пользователь указал овощной, семенной, зерновой, удобрения или СЗР склад, обязательно передайте это в warehouse.",
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
        description: "Возвращает сводку остатков по складам.",
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
        description: "Возвращает активные талоны весовой.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_recent_tickets",
        description: "Возвращает последние талоны весовой.",
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
        description: "Возвращает самый последний талон весовой.",
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
        name: "create_weighbridge_ticket_draft",
        description: "Готовит безопасный черновик талона весовой. Если данных не хватает, возвращает список недостающих полей.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
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
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "create_meal_order_draft",
        description: "Готовит безопасный черновик заявки питания/термосов. Если данных не хватает, возвращает список недостающих полей.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "create_warehouse_draft",
        description: "Готовит безопасный черновик склада. Если данных не хватает, возвращает список недостающих полей.",
        parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
      },
    },
  ];
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
    parameters: intentParams,
  };
}
