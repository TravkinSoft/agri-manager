import type { SupabaseClient } from "@supabase/supabase-js";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

export type AssistantMemoryCategory =
  | "communication_preference"
  | "workflow_preference"
  | "user_identity"
  | "assistant_goal"
  | "explicit_note";

export type AssistantMemorySignal = {
  category: AssistantMemoryCategory;
  memoryKey: string;
  value: string;
  confidence: number;
  source: "explicit_user_message" | "inferred_user_message";
};

export type AssistantMemoryContext = {
  count: number;
  contextText: string | null;
  latestUpdatedAt: string | null;
  warning: string | null;
};

export type AssistantMemoryWriteResult = {
  savedCount: number;
  skippedReason: string | null;
  warning: string | null;
};

export type AssistantMemoryRecord = {
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

const ASSISTANT_MEMORY_TABLE = "assistant_memories";
const MISSING_TABLE_RETRY_MS = 60_000;
let memoryTableUnavailableUntil = 0;

function cleanString(value: unknown): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

function clampText(value: unknown, maxLength: number): string | null {
  const text = cleanString(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function isMissingRelationError(errorMessage: string): boolean {
  const text = String(errorMessage || "").toLowerCase();
  return text.includes("does not exist") || text.includes("schema cache") || text.includes("not found");
}

function shouldSkipMissingTable(): boolean {
  return Date.now() < memoryTableUnavailableUntil;
}

function markMissingTable() {
  memoryTableUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_ -]+/gi, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function pushSignal(
  signals: AssistantMemorySignal[],
  signal: Omit<AssistantMemorySignal, "memoryKey"> & { memoryKey?: string }
) {
  const value = clampText(signal.value, 500);
  if (!value || hasQaDataMarker(value)) return;
  const memoryKey = normalizeKey(signal.memoryKey || signal.category);
  if (!memoryKey) return;
  if (signals.some((item) => item.category === signal.category && item.memoryKey === memoryKey)) return;
  signals.push({ ...signal, memoryKey, value });
}

export function extractAssistantMemorySignals(message: string): AssistantMemorySignal[] {
  const raw = cleanString(message) || "";
  if (!raw || hasQaDataMarker(raw)) return [];

  const lower = raw.toLowerCase();
  const signals: AssistantMemorySignal[] = [];

  if (/(говори|общайся|пиши|отвечай).{0,40}на\s+ты|можно\s+на\s+ты/.test(lower)) {
    pushSignal(signals, {
      category: "communication_preference",
      memoryKey: "address_style",
      value: "Пользователь предпочитает обращение на ты.",
      confidence: 0.98,
      source: "explicit_user_message",
    });
  }

  if (/(говори|общайся|пиши|отвечай).{0,40}на\s+вы|обращайся\s+на\s+вы/.test(lower)) {
    pushSignal(signals, {
      category: "communication_preference",
      memoryKey: "address_style",
      value: "Пользователь предпочитает обращение на вы.",
      confidence: 0.98,
      source: "explicit_user_message",
    });
  }

  const nameMatch = raw.match(/(?:называй|зови)\s+меня\s+([A-Za-zА-Яа-яЁё0-9 _.-]{2,40})/i);
  if (nameMatch?.[1]) {
    const preferredName = nameMatch[1].replace(/[.!?,;:]+$/g, "").trim();
    pushSignal(signals, {
      category: "user_identity",
      memoryKey: "preferred_name",
      value: `Пользователь просит обращаться к нему: ${preferredName}.`,
      confidence: 0.95,
      source: "explicit_user_message",
    });
  }

  const rememberMatch = raw.match(/(?:запомни|запоминай|remember this|remember)\s*[:,\-—]?\s*([^.!?\n]{6,260})/i);
  if (rememberMatch?.[1]) {
    pushSignal(signals, {
      category: "explicit_note",
      memoryKey: `note_${normalizeKey(rememberMatch[1]).slice(0, 32)}`,
      value: rememberMatch[1],
      confidence: 0.9,
      source: "explicit_user_message",
    });
  }

  const dontAskMatch = raw.match(/не\s+(?:спрашивай|переспрашивай)\s+(.{6,180})/i);
  if (dontAskMatch?.[1]) {
    pushSignal(signals, {
      category: "workflow_preference",
      memoryKey: `dont_ask_${normalizeKey(dontAskMatch[1]).slice(0, 32)}`,
      value: `Не переспрашивать: ${dontAskMatch[1].trim()}.`,
      confidence: 0.82,
      source: "explicit_user_message",
    });
  }

  const assistantGoalMatch = raw.match(/я\s+хочу\s*,?\s*(?:чтобы|чтоб)\s+ассист(?:ент)?\s+([^.!?\n]{8,260})/i);
  if (assistantGoalMatch?.[1]) {
    pushSignal(signals, {
      category: "assistant_goal",
      memoryKey: "assistant_product_goal",
      value: `Цель пользователя для ассистента: ассистент ${assistantGoalMatch[1].trim()}.`,
      confidence: 0.82,
      source: "explicit_user_message",
    });
  }

  return signals;
}

export async function buildAssistantLongTermMemoryContext(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  limit?: number;
}): Promise<AssistantMemoryContext> {
  if (shouldSkipMissingTable()) {
    return { count: 0, contextText: null, latestUpdatedAt: null, warning: "assistant_memories table unavailable" };
  }

  const limit = Math.max(1, Math.min(Number(params.limit ?? 16), 32));
  const res = await params.supabase
    .from(ASSISTANT_MEMORY_TABLE)
    .select("category,memory_key,value,confidence,updated_at")
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (res.error) {
    if (isMissingRelationError(res.error.message)) {
      markMissingTable();
      return { count: 0, contextText: null, latestUpdatedAt: null, warning: res.error.message };
    }
    return { count: 0, contextText: null, latestUpdatedAt: null, warning: res.error.message };
  }

  const rows = Array.isArray(res.data) ? res.data : [];
  const lines = rows
    .map((row: any) => {
      const category = cleanString(row.category);
      const key = cleanString(row.memory_key);
      const value = cleanString(row.value);
      if (!category || !key || !value || hasQaDataMarker(value)) return null;
      return `- ${category}.${key}: ${value}`;
    })
    .filter(Boolean) as string[];

  if (!lines.length) {
    return { count: 0, contextText: null, latestUpdatedAt: null, warning: null };
  }

  return {
    count: lines.length,
    latestUpdatedAt: cleanString((rows[0] as any)?.updated_at),
    warning: null,
    contextText: [
      "Durable user memory:",
      ...lines,
      "Memory rules: use this only for conversation style, preferences, and workflow continuity. Never treat memory as ERP source of truth.",
    ].join("\n"),
  };
}

export async function listAssistantMemoryRecords(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  limit?: number;
}): Promise<{ memories: AssistantMemoryRecord[]; warning: string | null }> {
  if (shouldSkipMissingTable()) return { memories: [], warning: "assistant_memories table unavailable" };

  const limit = Math.max(1, Math.min(Number(params.limit ?? 100), 300));
  const res = await params.supabase
    .from(ASSISTANT_MEMORY_TABLE)
    .select("id,scope,category,memory_key,value,confidence,source,active,created_at,updated_at")
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (res.error) {
    if (isMissingRelationError(res.error.message)) {
      markMissingTable();
      return { memories: [], warning: res.error.message };
    }
    return { memories: [], warning: res.error.message };
  }

  return {
    warning: null,
    memories: ((res.data || []) as any[]).map((row) => ({
      id: String(row.id),
      scope: String(row.scope || "user"),
      category: String(row.category || ""),
      memory_key: String(row.memory_key || ""),
      value: String(row.value || ""),
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
      source: cleanString(row.source),
      active: row.active !== false,
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
    })),
  };
}

export async function deactivateAssistantMemory(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  memoryId?: string | null;
  deactivateAll?: boolean;
}): Promise<{ count: number; warning: string | null }> {
  if (shouldSkipMissingTable()) return { count: 0, warning: "assistant_memories table unavailable" };
  const now = new Date().toISOString();
  let query = params.supabase
    .from(ASSISTANT_MEMORY_TABLE)
    .update({ active: false, updated_at: now })
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)
    .eq("active", true);

  if (!params.deactivateAll) {
    const memoryId = cleanString(params.memoryId);
    if (!memoryId) return { count: 0, warning: "memoryId is required" };
    query = query.eq("id", memoryId);
  }

  const res = await query.select("id");
  if (res.error) {
    if (isMissingRelationError(res.error.message)) {
      markMissingTable();
      return { count: 0, warning: res.error.message };
    }
    return { count: 0, warning: res.error.message };
  }

  return { count: Array.isArray(res.data) ? res.data.length : 0, warning: null };
}

export async function captureAssistantMemorySignals(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  message: string;
}): Promise<AssistantMemoryWriteResult> {
  const signals = extractAssistantMemorySignals(params.message);
  if (!signals.length) return { savedCount: 0, skippedReason: "no_explicit_memory_signal", warning: null };
  if (shouldSkipMissingTable()) {
    return { savedCount: 0, skippedReason: "memory_table_unavailable", warning: "assistant_memories table unavailable" };
  }

  let savedCount = 0;
  for (const signal of signals) {
    const existing = await params.supabase
      .from(ASSISTANT_MEMORY_TABLE)
      .select("id")
      .eq("company_id", params.companyId)
      .eq("user_id", params.userId)
      .eq("scope", "user")
      .eq("category", signal.category)
      .eq("memory_key", signal.memoryKey)
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      if (isMissingRelationError(existing.error.message)) {
        markMissingTable();
        return { savedCount, skippedReason: "memory_table_unavailable", warning: existing.error.message };
      }
      return { savedCount, skippedReason: "memory_read_failed", warning: existing.error.message };
    }

    const payload = {
      company_id: params.companyId,
      user_id: params.userId,
      scope: "user",
      category: signal.category,
      memory_key: signal.memoryKey,
      value: signal.value,
      confidence: signal.confidence,
      source: signal.source,
      active: true,
      metadata: { updated_from: "assistant_query" },
      updated_at: new Date().toISOString(),
    };

    const write = existing.data?.id
      ? await params.supabase.from(ASSISTANT_MEMORY_TABLE).update(payload).eq("id", String(existing.data.id))
      : await params.supabase.from(ASSISTANT_MEMORY_TABLE).insert(payload);

    if (write.error) {
      if (isMissingRelationError(write.error.message)) {
        markMissingTable();
        return { savedCount, skippedReason: "memory_table_unavailable", warning: write.error.message };
      }
      return { savedCount, skippedReason: "memory_write_failed", warning: write.error.message };
    }

    savedCount += 1;
  }

  return { savedCount, skippedReason: null, warning: null };
}
