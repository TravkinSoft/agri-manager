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
      description: "Search company fields by typed name, field number, or area. Never treat a value followed by га/ha as a field number.",
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
      description: "Read current stock for an explicitly requested product and optional warehouse.",
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
      description: "Read active operations for the current company and active season.",
      parameters: {
        type: "object",
        properties: {
          field_id: { type: "string", description: "Selected field ID for a field-scoped follow-up." },
          season_id: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
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
