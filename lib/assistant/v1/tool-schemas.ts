import type { PlannerToolSchema } from "@/lib/assistant/engine/tool-schema";

const FIELD_REFERENCE_PROPERTIES = {
  name: { type: "string", description: "Field name, for example Сад." },
  number: { type: "string", description: "Field number or segment, for example 28 or 28-1." },
  area_ha: { type: "number", description: "Field area in hectares. A phrase such as 22 га must use this parameter." },
  area_tolerance_ha: { type: "number", minimum: 0, maximum: 100, description: "Allowed area difference in hectares." },
  season_id: { type: "string", description: "Active season id or year when relevant." },
} as const;

const tools: PlannerToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_current_context",
      description: "Read the authenticated company, user, page, season, and structured focus context.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search_fields",
      description: "Search company fields by typed name, field number, or area. With no filter, return the concise field list with active-season crop and variety. Never treat a value followed by га/ha as a field number.",
      parameters: {
        type: "object",
        properties: {
          ...FIELD_REFERENCE_PROPERTIES,
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_field_card",
      description: "Read a field card. Use structured field focus for short follow-ups. If matching is ambiguous, return candidates and ask for clarification.",
      parameters: {
        type: "object",
        properties: { field_id: { type: "string" }, ...FIELD_REFERENCE_PROPERTIES },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_field_land_bank_summary",
      description: "Read the canonical company total field count and total hectares.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_field_materials",
      description: "Read materials for a field. For ‘А материалы?’ use the selected field from structured thread state.",
      parameters: {
        type: "object",
        properties: {
          field_id: { type: "string" },
          ...FIELD_REFERENCE_PROPERTIES,
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_warehouse_stock",
      description: "Read current stock for a product and optional warehouse. With no product, read the canonical active warehouse count/list.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string" },
          warehouse: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_crop_structure_summary",
      description: "Read crop structure totals for the active season.",
      parameters: {
        type: "object",
        properties: {
          crop: { type: "string" },
          crop_group: { type: "string" },
          variety: { type: "string" },
          season_id: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_operations_summary",
      description: "Read operation rows for the current company and active season. This tool resolves a field name/number itself; never call search_fields first. Use status=all for total/by-field/material/irrigation questions, active for operations running now, completed for finished, and planned for planned operations.",
      parameters: {
        type: "object",
        properties: {
          field_id: { type: "string", description: "Selected field ID for a field-scoped follow-up." },
          field: { type: "string", description: "Field name, number, or partial name such as 28 or Сад." },
          status: { type: "string", enum: ["all", "active", "completed", "planned"] },
          season_id: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_tickets",
      description: "Read active Weighbridge tickets for the authenticated company, including field, crop, route, transport, weights, moisture, operator, correction and review state.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 120 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_tickets",
      description: "Read recent Weighbridge tickets for the authenticated company. Use for latest or recent ticket questions.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 80 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ticket_details",
      description: "Read one Weighbridge ticket by its WB number, including the full agronomic and physical context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Ticket number, for example WB-..." },
        },
        additionalProperties: false,
      },
    },
  },
];

export function getReadOnlyModelToolSchemas(): PlannerToolSchema[] {
  return tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      parameters: { ...tool.function.parameters },
    },
  }));
}
