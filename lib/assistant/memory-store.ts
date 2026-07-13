import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const A105_MEMORY_TYPES = [
  "language",
  "response_brevity",
  "explanation_level",
  "preferred_format",
  "confirmed_role",
  "source_preference",
  "durable_work_rule",
] as const;

export type AssistantMemoryType = (typeof A105_MEMORY_TYPES)[number];
export type AssistantMemoryStatus = "candidate" | "approved" | "rejected";
export type AssistantMemorySource = "explicit_user_command" | "assistant_proposal";
export type AssistantMemoryActor = { companyId: string; userId: string };

export type AssistantMemoryRecord = {
  id: string;
  company_id: string;
  user_id: string;
  scope: "user";
  source_message_id: string;
  created_by: string;
  approved_by: string | null;
  memory_type: AssistantMemoryType;
  memory_key: string;
  content: string;
  confidence: number;
  source: AssistantMemorySource;
  status: AssistantMemoryStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type AssistantMemoryCandidate = Omit<AssistantMemoryRecord, "id">;

export type AssistantMemoryContext = {
  count: number;
  contextText: string | null;
  latestUpdatedAt: string | null;
  warning: string | null;
  ids: string[];
  categories: AssistantMemoryType[];
};

export type AssistantMemoryWriteResult = {
  savedCount: number;
  skippedReason: string | null;
  warning: string | null;
};

export class AssistantMemoryPolicyError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AssistantMemoryPolicyError";
    this.code = code;
    this.status = status;
  }
}

const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk|proj)-[a-z0-9_-]{16,}\b/i,
  /\bBearer\s+[a-z0-9._~+/=-]{12,}\b/i,
  /\b(?:OPENAI_API_KEY|A102_TEST_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE_KEY)\s*=/i,
  /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/,
];
const FORBIDDEN_EPHEMERAL = /(?:остат(?:ок|ки)?|складск(?:ой|ие) остат|текущ(?:ий|ая) статус|операци[яи] сейчас|сегодня на складе|урожайность сейчас|inventory balance)/i;
const FORBIDDEN_UNCONFIRMED = /(?:кажется|возможно|наверное|модель сказала|ассистент сказал|неподтвержд[её]н)/i;
const FORBIDDEN_POLICY_OVERRIDE = /(?:игнорируй|отмени|обойди).{0,50}(?:system|security|безопас|правил|policy|read.?only)/i;
const MEMORY_COMMAND = /^\s*(?:запомни(?:,|:)?|запоминай(?:,|:)?|remember(?: that)?(?:,|:)?)\s+(.+)$/i;
const MEMORY_METADATA_KEY = "a105_memory_v1";

function clean(value: unknown, max = 500): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trim() : text;
}

function hasPotentialSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeKey(type: AssistantMemoryType, value: string): string {
  const suffix = value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${type}:${suffix || "preference"}`;
}

function classifyMemoryType(value: string): AssistantMemoryType | null {
  if (/(?:русск|казахск|английск|язык)/i.test(value)) return "language";
  if (/(?:коротк|кратк|сжато|без воды)/i.test(value)) return "response_brevity";
  if (/(?:подробн|детальн|уровень объяснен|объясняй)/i.test(value)) return "explanation_level";
  if (/(?:таблиц|спис(ок|ком)|формат|markdown|csv)/i.test(value)) return "preferred_format";
  if (/(?:моя роль|я\s+(?:агроном|директор|администратор|менеджер|кладовщик))/i.test(value)) return "confirmed_role";
  if (/(?:источник|ссылк|официальн|сначала данные)/i.test(value)) return "source_preference";
  if (/(?:всегда|никогда|не спрашивай|рабоч(?:ее|ий) правил|перед .* провер)/i.test(value)) return "durable_work_rule";
  return null;
}

export function isAssistantMemoryV1RuntimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ASSISTANT_MEMORY_V1_ENABLED === "1";
}

export function extractExplicitMemoryCandidate(params: {
  message: string;
  sourceMessageId: string;
  actor: AssistantMemoryActor;
  now?: string;
}): AssistantMemoryCandidate | null {
  const command = clean(params.message);
  const sourceMessageId = clean(params.sourceMessageId, 100);
  if (!command || !sourceMessageId) return null;
  const match = command.match(MEMORY_COMMAND);
  const content = clean(match?.[1]);
  if (!content) return null;
  if (hasPotentialSecret(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_SECRET_REJECTED", "Secrets cannot be saved as assistant memory.");
  }
  if (FORBIDDEN_EPHEMERAL.test(content) || FORBIDDEN_UNCONFIRMED.test(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_CONTENT_NOT_DURABLE", "Only stable confirmed user preferences can be saved.");
  }
  if (FORBIDDEN_POLICY_OVERRIDE.test(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_POLICY_OVERRIDE_REJECTED", "Memory cannot override system or security rules.", 403);
  }
  const memoryType = classifyMemoryType(content);
  if (!memoryType) {
    throw new AssistantMemoryPolicyError("MEMORY_TYPE_NOT_ALLOWED", "This is not an allowed durable user preference.");
  }
  const now = params.now || new Date().toISOString();
  return {
    company_id: params.actor.companyId,
    user_id: params.actor.userId,
    scope: "user",
    source_message_id: sourceMessageId,
    created_by: params.actor.userId,
    approved_by: null,
    memory_type: memoryType,
    memory_key: normalizeKey(memoryType, content),
    content,
    confidence: 0.75,
    source: "explicit_user_command",
    status: "candidate",
    created_at: now,
    updated_at: now,
    expires_at: null,
  };
}

export function createProposedMemoryCandidate(params: {
  content: string;
  memoryType: AssistantMemoryType;
  sourceMessageId: string;
  actor: AssistantMemoryActor;
  now?: string;
}): AssistantMemoryCandidate {
  const content = clean(params.content);
  if (!content || !A105_MEMORY_TYPES.includes(params.memoryType)) {
    throw new AssistantMemoryPolicyError("MEMORY_TYPE_NOT_ALLOWED", "Only supported preference types may be proposed.");
  }
  if (hasPotentialSecret(content) || FORBIDDEN_EPHEMERAL.test(content) || FORBIDDEN_UNCONFIRMED.test(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_CONTENT_NOT_DURABLE", "Only stable non-secret preferences may be proposed.");
  }
  if (FORBIDDEN_POLICY_OVERRIDE.test(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_POLICY_OVERRIDE_REJECTED", "Memory cannot override system or security rules.", 403);
  }
  const now = params.now || new Date().toISOString();
  return {
    company_id: params.actor.companyId,
    user_id: params.actor.userId,
    scope: "user",
    source_message_id: params.sourceMessageId,
    created_by: params.actor.userId,
    approved_by: null,
    memory_type: params.memoryType,
    memory_key: normalizeKey(params.memoryType, content),
    content,
    confidence: 0.6,
    source: "assistant_proposal",
    status: "candidate",
    created_at: now,
    updated_at: now,
    expires_at: null,
  };
}

function assertOwned(record: AssistantMemoryRecord, actor: AssistantMemoryActor): void {
  if (record.company_id !== actor.companyId || record.user_id !== actor.userId || record.scope !== "user") {
    throw new AssistantMemoryPolicyError("MEMORY_SCOPE_DENIED", "Memory is outside the current user/company scope.", 403);
  }
}

export function approveAssistantMemoryRecord(
  record: AssistantMemoryRecord,
  actor: AssistantMemoryActor,
  now = new Date().toISOString()
): AssistantMemoryRecord {
  assertOwned(record, actor);
  if (record.status !== "candidate") {
    throw new AssistantMemoryPolicyError("MEMORY_NOT_CANDIDATE", "Only a candidate can be approved.", 409);
  }
  return { ...record, status: "approved", approved_by: actor.userId, updated_at: now };
}

export function rejectAssistantMemoryRecord(
  record: AssistantMemoryRecord,
  actor: AssistantMemoryActor,
  now = new Date().toISOString()
): AssistantMemoryRecord {
  assertOwned(record, actor);
  if (record.status !== "candidate") {
    throw new AssistantMemoryPolicyError("MEMORY_NOT_CANDIDATE", "Only a candidate can be rejected.", 409);
  }
  return { ...record, status: "rejected", approved_by: null, updated_at: now };
}

export function assertAssistantMemoryDeleteAllowed(record: AssistantMemoryRecord, actor: AssistantMemoryActor): void {
  assertOwned(record, actor);
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9а-яё]+/i).filter((item) => item.length >= 3));
}

export function selectRelevantApprovedMemories(params: {
  records: AssistantMemoryRecord[];
  actor: AssistantMemoryActor;
  query: string;
  now?: string;
  limit?: number;
}): AssistantMemoryRecord[] {
  const now = Date.parse(params.now || new Date().toISOString());
  const queryTokens = tokens(params.query);
  const limit = Math.max(1, Math.min(Number(params.limit || 5), 5));
  return params.records
    .filter((record) =>
      record.scope === "user" &&
      record.company_id === params.actor.companyId &&
      record.user_id === params.actor.userId &&
      record.status === "approved" &&
      (!record.expires_at || Date.parse(record.expires_at) > now)
    )
    .map((record) => {
      const overlap = Array.from(tokens(record.content)).filter((token) => queryTokens.has(token)).length;
      const generalPreference = record.memory_type === "language" || record.memory_type === "response_brevity" || record.memory_type === "preferred_format";
      return { record, score: overlap * 10 + (generalPreference ? 3 : 0) + Date.parse(record.updated_at) / 1e15 };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.record);
}

function categoryForType(type: AssistantMemoryType): "communication_preference" | "workflow_preference" | "user_identity" {
  if (type === "confirmed_role") return "user_identity";
  if (type === "durable_work_rule") return "workflow_preference";
  return "communication_preference";
}

function metadataFor(record: AssistantMemoryRecord | AssistantMemoryCandidate): Record<string, unknown> {
  return {
    [MEMORY_METADATA_KEY]: {
      version: 1,
      source_message_id: record.source_message_id,
      created_by: record.created_by,
      approved_by: record.approved_by,
      memory_type: record.memory_type,
      status: record.status,
      expires_at: record.expires_at,
    },
  };
}

function normalizeDbRow(row: Record<string, any>): AssistantMemoryRecord | null {
  const meta = row.metadata?.[MEMORY_METADATA_KEY];
  if (!meta || typeof meta !== "object") return null;
  const memoryType = clean(meta.memory_type) as AssistantMemoryType | null;
  const status = clean(meta.status) as AssistantMemoryStatus | null;
  if (!memoryType || !A105_MEMORY_TYPES.includes(memoryType) || !status || !["candidate", "approved", "rejected"].includes(status)) return null;
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    user_id: String(row.user_id),
    scope: "user",
    source_message_id: String(meta.source_message_id || ""),
    created_by: String(meta.created_by || ""),
    approved_by: clean(meta.approved_by, 100),
    memory_type: memoryType,
    memory_key: String(row.memory_key || ""),
    content: String(row.value || ""),
    confidence: Number(row.confidence || 0),
    source: row.source === "assistant_proposal" ? "assistant_proposal" : "explicit_user_command",
    status,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    expires_at: clean(meta.expires_at, 100),
  };
}

const SELECT_COLUMNS = "id,company_id,user_id,scope,category,memory_key,value,confidence,source,metadata,active,created_at,updated_at";

export async function createAssistantMemoryCandidate(params: {
  supabase: SupabaseClient;
  candidate: AssistantMemoryCandidate;
}): Promise<AssistantMemoryRecord> {
  const payload = {
    company_id: params.candidate.company_id,
    user_id: params.candidate.user_id,
    scope: "user",
    category: categoryForType(params.candidate.memory_type),
    memory_key: `${params.candidate.memory_key}:${params.candidate.source_message_id}`.slice(0, 120),
    value: params.candidate.content,
    confidence: params.candidate.confidence,
    source: params.candidate.source,
    metadata: metadataFor(params.candidate),
    active: false,
    created_at: params.candidate.created_at,
    updated_at: params.candidate.updated_at,
  };
  const result = await params.supabase.from("assistant_memories").insert(payload).select(SELECT_COLUMNS).single();
  if (result.error) throw new Error(result.error.message);
  const record = normalizeDbRow(result.data as Record<string, any>);
  if (!record) throw new Error("Invalid A105 memory record returned by storage");
  return record;
}

export async function listAssistantMemoryRecords(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  limit?: number;
}): Promise<{ memories: AssistantMemoryRecord[]; warning: string | null }> {
  const limit = Math.max(1, Math.min(Number(params.limit || 100), 300));
  const result = await params.supabase
    .from("assistant_memories")
    .select(SELECT_COLUMNS)
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)
    .eq("scope", "user")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (result.error) return { memories: [], warning: result.error.message };
  return {
    memories: ((result.data || []) as Record<string, any>[]).map(normalizeDbRow).filter((item): item is AssistantMemoryRecord => Boolean(item)),
    warning: null,
  };
}

async function getOwnedMemory(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  memoryId: string;
}): Promise<AssistantMemoryRecord> {
  const result = await params.supabase
    .from("assistant_memories")
    .select(SELECT_COLUMNS)
    .eq("id", params.memoryId)
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)
    .eq("scope", "user")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const record = result.data ? normalizeDbRow(result.data as Record<string, any>) : null;
  if (!record) throw new AssistantMemoryPolicyError("MEMORY_NOT_FOUND", "Memory not found in current scope.", 404);
  return record;
}

export async function setAssistantMemoryStatus(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  memoryId: string;
  action: "approve" | "reject";
}): Promise<AssistantMemoryRecord> {
  const actor = { companyId: params.companyId, userId: params.userId };
  const existing = await getOwnedMemory({ ...params });
  const next = params.action === "approve"
    ? approveAssistantMemoryRecord(existing, actor)
    : rejectAssistantMemoryRecord(existing, actor);
  const update = await params.supabase
    .from("assistant_memories")
    .update({ metadata: metadataFor(next), active: next.status === "approved", updated_at: next.updated_at })
    .eq("id", next.id)
    .eq("company_id", next.company_id)
    .eq("user_id", next.user_id)
    .eq("scope", "user")
    .select(SELECT_COLUMNS)
    .single();
  if (update.error) throw new Error(update.error.message);
  const record = normalizeDbRow(update.data as Record<string, any>);
  if (!record) throw new Error("Invalid A105 memory record after status update");
  return record;
}

export async function deleteAssistantMemory(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  memoryId: string;
  beforeDelete?: (record: AssistantMemoryRecord) => Promise<void>;
}): Promise<AssistantMemoryRecord> {
  const record = await getOwnedMemory(params);
  assertAssistantMemoryDeleteAllowed(record, { companyId: params.companyId, userId: params.userId });
  if (params.beforeDelete) await params.beforeDelete(record);
  const result = await params.supabase
    .from("assistant_memories")
    .delete()
    .eq("id", record.id)
    .eq("company_id", record.company_id)
    .eq("user_id", record.user_id)
    .eq("scope", "user");
  if (result.error) throw new Error(result.error.message);
  return record;
}

export async function buildAssistantLongTermMemoryContext(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  query: string;
  limit?: number;
}): Promise<AssistantMemoryContext> {
  const listed = await listAssistantMemoryRecords({
    supabase: params.supabase,
    companyId: params.companyId,
    userId: params.userId,
    limit: 100,
  });
  if (listed.warning) {
    return { count: 0, contextText: null, latestUpdatedAt: null, warning: listed.warning, ids: [], categories: [] };
  }
  const selected = selectRelevantApprovedMemories({
    records: listed.memories,
    actor: { companyId: params.companyId, userId: params.userId },
    query: params.query,
    limit: params.limit || 5,
  });
  return {
    count: selected.length,
    contextText: selected.length
      ? selected.map((record) => `- ${record.memory_type}: ${record.content}`).join("\n")
      : null,
    latestUpdatedAt: selected[0]?.updated_at || null,
    warning: null,
    ids: selected.map((record) => record.id),
    categories: Array.from(new Set(selected.map((record) => record.memory_type))),
  };
}

export function createInMemoryRecord(candidate: AssistantMemoryCandidate, id = randomUUID()): AssistantMemoryRecord {
  return { id, ...candidate };
}
