import type { AssistantIntent, AssistantSessionState, AssistantToolOutput } from "@/lib/assistant/engine/types";

export const EMPTY_ASSISTANT_SESSION_STATE: AssistantSessionState = {
  lastEntity: null,
  lastCrop: null,
  lastVariety: null,
  lastBatchClass: null,
  lastWarehouse: null,
  lastField: null,
  lastSeason: null,
  lastIntent: null,
  lastResultContext: null,
};

function cleanString(value: unknown): string | null {
  const raw = String(value || "").trim();
  return raw.length > 0 ? raw : null;
}

export function normalizeSessionState(input: Partial<AssistantSessionState> | null | undefined): AssistantSessionState {
  return {
    lastEntity: cleanString(input?.lastEntity),
    lastCrop: cleanString(input?.lastCrop),
    lastVariety: cleanString(input?.lastVariety),
    lastBatchClass: cleanString(input?.lastBatchClass),
    lastWarehouse: cleanString(input?.lastWarehouse),
    lastField: cleanString(input?.lastField),
    lastSeason: cleanString(input?.lastSeason),
    lastIntent: input?.lastIntent || null,
    lastResultContext: cleanString(input?.lastResultContext),
  };
}

function findValue(rows: Array<Record<string, unknown>>, keys: string[]): string | null {
  for (const row of rows) {
    for (const key of keys) {
      const value = cleanString(row[key]);
      if (value) return value;
    }
  }
  return null;
}

export function updateSessionStateFromToolOutput(params: {
  previous: AssistantSessionState;
  intent: AssistantIntent;
  output: AssistantToolOutput | null;
  seasonFromContext?: string | null;
}): AssistantSessionState {
  const { previous, intent, output, seasonFromContext } = params;
  const rows = output?.rows || [];

  return {
    ...previous,
    lastIntent: intent.name,
    lastEntity: findValue(rows, ["id", "ticket_id", "field_id", "warehouse_id", "batch_id"]) || previous.lastEntity,
    lastCrop: findValue(rows, ["crop_name", "product_name"]) || previous.lastCrop,
    lastVariety: findValue(rows, ["variety_name"]) || previous.lastVariety,
    lastBatchClass: findValue(rows, ["batch_class"]) || previous.lastBatchClass,
    lastWarehouse: findValue(rows, ["warehouse_name", "warehouse_from_name", "warehouse_to_name"]) || previous.lastWarehouse,
    lastField: findValue(rows, ["field_name"]) || previous.lastField,
    lastSeason: cleanString(seasonFromContext) || findValue(rows, ["season_year", "season"]) || previous.lastSeason,
    lastResultContext: output?.title || previous.lastResultContext,
  };
}

