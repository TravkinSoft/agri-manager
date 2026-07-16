import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const USER_GLOBAL_MEMORY_TYPES = [
  "name",
  "preferred_address",
  "language",
  "response_style",
  "response_brevity",
  "durable_work_preference",
] as const;

export const COMPANY_MEMORY_TYPES = [
  "company_rule",
  "company_terminology",
  "company_process_preference",
] as const;

const LEGACY_MEMORY_TYPES = [
  "explanation_level",
  "preferred_format",
  "confirmed_role",
  "source_preference",
  "durable_work_rule",
] as const;

export const A105_MEMORY_TYPES = [
  ...USER_GLOBAL_MEMORY_TYPES,
  ...COMPANY_MEMORY_TYPES,
  ...LEGACY_MEMORY_TYPES,
] as const;

export type UserGlobalMemoryType = (typeof USER_GLOBAL_MEMORY_TYPES)[number];
export type CompanyMemoryType = (typeof COMPANY_MEMORY_TYPES)[number];
export type AssistantMemoryType = (typeof A105_MEMORY_TYPES)[number];
export type AssistantMemoryStatus = "candidate" | "approved" | "rejected";
export type AssistantMemoryScope = "user_global" | "company" | "user";
export type AssistantMemoryProvenance =
  | "user_explicit"
  | "assistant_inferred"
  | "company_explicit"
  | "legacy_candidate_v1";
export type AssistantMemoryApprovalMode =
  | "direct_user_explicit"
  | "model_inferred"
  | "company_authorized"
  | "legacy_v1";
export type AssistantMemorySource =
  | AssistantMemoryProvenance
  | "explicit_user_command"
  | "assistant_proposal";
export type AssistantMemoryActor = { companyId: string; userId: string };

export type AssistantMemoryRecord = {
  id: string;
  company_id: string;
  user_id: string;
  scope: AssistantMemoryScope;
  source_message_id: string;
  created_by: string;
  approved_by: string | null;
  memory_type: AssistantMemoryType;
  memory_key: string;
  content: string;
  normalized_fact: string;
  confidence: number;
  source: AssistantMemorySource;
  provenance: AssistantMemoryProvenance;
  approval_mode: AssistantMemoryApprovalMode;
  status: AssistantMemoryStatus;
  active: boolean;
  approved_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type AssistantApprovedMemoryInput = {
  company_id: string;
  user_id: string;
  scope: "user_global" | "company";
  source_message_id: string;
  memory_type: UserGlobalMemoryType | CompanyMemoryType;
  memory_key: string;
  content: string;
  normalized_fact: string;
  confidence: number;
  provenance: "user_explicit" | "assistant_inferred" | "company_explicit";
  expires_at?: string | null;
};

// Kept only as a compile-time compatibility shape for the archived V1 QA script.
// Contract 0.4 runtime never inserts this shape.
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
  deletedCount?: number;
  action?: "save" | "delete" | "noop";
  provenance?: AssistantMemoryProvenance | null;
  ids?: string[];
};

export type ForgottenMemoryContext = {
  memoryIds: string[];
  sourceMessageIds: string[];
  terms: string[];
  warning: string | null;
};

export type AssistantMemoryDeleteIntent = {
  scope: "user_global" | "company";
  memoryTypes: Array<UserGlobalMemoryType | CompanyMemoryType>;
  memoryKey: string | null;
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
  /\b(?:OPENAI_API_KEY|A102_TEST_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL)\s*=/i,
  /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/,
];
const FORBIDDEN_EPHEMERAL = /(?:остат(?:ок|ки)?|складск(?:ой|ие)\s+остат|текущ(?:ий|ая)\s+статус|операци[яи]\s+сейчас|сегодня\s+на\s+складе|урожайность\s+сейчас|inventory\s+balance|current\s+stock|live\s+stock)/i;
const FORBIDDEN_UNCONFIRMED = /(?:кажется|возможно|наверное|модель\s+сказала|ассистент\s+сказал|неподтвержд[её]н|I\s+(?:guess|think|suppose))/i;
const FORBIDDEN_POLICY_OVERRIDE = /(?:игнорируй|отмени|обойди).{0,50}(?:system|security|безопас|правил|policy|read.?only)/i;
const FORBIDDEN_SENSITIVE_ID = /(?:парол|password|api.?key|секрет|secret|токен|token|service.?role|database.?url|ИИН|паспорт|bank\s+account|credit\s+card)/i;
const EXPLICIT_PREFIX = /^\s*(?:запомни(?:те)?|запоминай|remember(?:\s+that)?)(?:\s*[,;:]\s*|\s+)(.+)$/i;
const EXPLICIT_SUFFIX = /^\s*(.+?)(?:\s*[,;:]\s*|\s+)(?:запомни(?:те)?\s+это|remember\s+(?:this|that))(?:\s+на\s+будущее)?[.!]?\s*$/i;
const COMPANY_PREFIX = /^\s*(?:для\s+компании|company(?:-wide)?)(?:\s*[,;:]\s*|\s+)(.+)$/i;
const DELETE_COMMAND = /(?:^|\s)(?:забудь|не\s+учитывай(?:\s+это)?\s+больше|удали(?:\s+это)?\s+из\s+памяти|forget|remove\s+from\s+memory)(?:\s+|$)(.*)$/i;
const MEMORY_METADATA_KEY = "assistant_memory_policy_v2";
const A106_BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const A106_DISABLED_SECRET_SENTINEL = "__A106_DISABLED__";

function clean(value: unknown, max = 500): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trim() : text;
}

function hasPotentialSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value)) || FORBIDDEN_SENSITIVE_ID.test(value);
}

export function isDurableMemoryContentSafe(value: string): boolean {
  const content = clean(value);
  return Boolean(
    content &&
    !hasPotentialSecret(content) &&
    !FORBIDDEN_EPHEMERAL.test(content) &&
    !FORBIDDEN_UNCONFIRMED.test(content) &&
    !FORBIDDEN_POLICY_OVERRIDE.test(content)
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "preference";
}

export function memoryKeyFor(type: UserGlobalMemoryType | CompanyMemoryType, value: string): string {
  if (type === "durable_work_preference" || type.startsWith("company_")) {
    return `${type}:${slug(value)}`.slice(0, 120);
  }
  return type;
}

function assertSafeMemoryContent(content: string): void {
  if (hasPotentialSecret(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_SECRET_REJECTED", "Secrets cannot be saved as assistant memory.");
  }
  if (FORBIDDEN_EPHEMERAL.test(content) || FORBIDDEN_UNCONFIRMED.test(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_CONTENT_NOT_DURABLE", "Temporary operational state and unconfirmed assumptions cannot be saved.");
  }
  if (FORBIDDEN_POLICY_OVERRIDE.test(content)) {
    throw new AssistantMemoryPolicyError("MEMORY_POLICY_OVERRIDE_REJECTED", "Memory cannot override system or security rules.", 403);
  }
}

function classifyUserGlobalFact(value: string): { type: UserGlobalMemoryType; fact: string } | null {
  const name = value.match(/(?:меня\s+зовут|мо[её]\s+имя|my\s+name\s+is)\s+([\p{L}][\p{L}'’-]{1,79})/iu);
  if (name) return { type: "name", fact: name[1] };

  const address = value.match(/(?:обращайся\s+ко\s+мне|называй\s+меня|call\s+me)\s+(.{1,100})$/i);
  if (address) return { type: "preferred_address", fact: address[1].replace(/[.!]+$/, "").trim() };

  const language = value.match(/(?:язык|отвечай|говори|общайся|language|reply|speak).{0,40}\b(русск(?:ом|ий)|казахск(?:ом|ий)|английск(?:ом|ий)|russian|kazakh|english)\b/i);
  if (language) return { type: "language", fact: language[1] };

  if (/(?:коротк|кратк|сжато|без\s+воды|brief|concise)/i.test(value)) {
    return { type: "response_brevity", fact: value };
  }
  if (/(?:стиль\s+ответ|отвечай\s+(?:делов|дружелюб|формаль)|response\s+style)/i.test(value)) {
    return { type: "response_style", fact: value };
  }
  if (/(?:предпочитаю|мне\s+удобнее|всегда|устойчив|рабоч(?:ее|ий)\s+предпочтение|I\s+prefer)/i.test(value)) {
    return { type: "durable_work_preference", fact: value };
  }
  return null;
}

function classifyCompanyFact(value: string): { type: CompanyMemoryType; fact: string } {
  if (/(?:термин|называем|обозначаем|terminology|call\s+it)/i.test(value)) {
    return { type: "company_terminology", fact: value };
  }
  if (/(?:процесс|порядок|workflow|process)/i.test(value)) {
    return { type: "company_process_preference", fact: value };
  }
  return { type: "company_rule", fact: value };
}

export function isAssistantMemoryV2RuntimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = String(env.NEXT_PUBLIC_SUPABASE_URL || env.A106_SUPABASE_URL || "");
  const explicitlyLocal = env.NODE_ENV !== "production" || env.A106_LOCAL_RUNTIME === "1";
  const serviceRole = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const serviceRoleCredentialAbsent = !serviceRole ||
    (env.A106_LOCAL_RUNTIME === "1" && serviceRole === A106_DISABLED_SECRET_SENTINEL);
  return explicitlyLocal &&
    (env.ASSISTANT_MEMORY_V2_ENABLED === "1" || env.ASSISTANT_MEMORY_V1_ENABLED === "1") &&
    env.A106_BRANCH_REF === A106_BRANCH_REF &&
    url.includes(A106_BRANCH_REF) &&
    !url.includes(PRODUCTION_REF) &&
    serviceRoleCredentialAbsent;
}

/** @deprecated Use isAssistantMemoryV2RuntimeEnabled. */
export const isAssistantMemoryV1RuntimeEnabled = isAssistantMemoryV2RuntimeEnabled;

export function hasExplicitMemoryIntent(message: string): boolean {
  const command = clean(message);
  if (!command) return false;
  return EXPLICIT_PREFIX.test(command) ||
    EXPLICIT_SUFFIX.test(command) ||
    /^(?:обращайся\s+(?:ко\s+мне|как|со\s+мной\s+как)|называй\s+меня|отвечай\s+мне|говори\s+со\s+мной|reply\s+to\s+me|call\s+me)(?:\s|$)/i.test(command);
}

export function extractExplicitApprovedMemories(params: {
  message: string;
  sourceMessageId: string;
  actor: AssistantMemoryActor;
}): AssistantApprovedMemoryInput[] {
  const command = clean(params.message);
  const sourceMessageId = clean(params.sourceMessageId, 100);
  if (!command || !sourceMessageId) return [];

  const prefixed = command.match(EXPLICIT_PREFIX);
  const suffixed = command.match(EXPLICIT_SUFFIX);
  const directCommand = /^(?:обращайся\s+(?:ко\s+мне|как|со\s+мной\s+как)|называй\s+меня|отвечай\s+мне|говори\s+со\s+мной|reply\s+to\s+me|call\s+me)(?:\s|$)/i.test(command);
  if (!prefixed && !suffixed && !directCommand) return [];

  let content = clean(prefixed?.[1] || suffixed?.[1] || command);
  if (!content) return [];
  const companyMatch = content.match(COMPANY_PREFIX);
  const scope = companyMatch ? "company" : "user_global";
  if (companyMatch) content = clean(companyMatch[1]);
  if (!content) return [];
  assertSafeMemoryContent(content);

  const classifiedFacts: Array<{
    type: UserGlobalMemoryType | CompanyMemoryType;
    fact: string;
  }> = [];
  if (scope === "company") {
    classifiedFacts.push(classifyCompanyFact(content));
  } else {
    const name = content.match(/(?:меня\s+зовут|мо[её]\s+имя|my\s+name\s+is)\s+([\p{L}][\p{L}'’-]{1,79})/iu);
    if (name) classifiedFacts.push({ type: "name", fact: name[1] });
    const address = content.match(/(?:обращайся\s+(?:ко\s+мне|как|со\s+мной\s+как)|называй\s+меня|call\s+me)\s+([^,;.!]{1,100})/i);
    if (address) classifiedFacts.push({ type: "preferred_address", fact: address[1].trim() });
    const fallback = classifyUserGlobalFact(content);
    if (fallback && !classifiedFacts.some((item) => item.type === fallback.type)) classifiedFacts.push(fallback);
  }
  if (!classifiedFacts.length) {
    throw new AssistantMemoryPolicyError("MEMORY_TYPE_NOT_ALLOWED", "The explicit command does not contain an approved durable memory type.");
  }
  return classifiedFacts.flatMap((classified) => {
    const fact = clean(classified.fact);
    return fact ? [{
      company_id: params.actor.companyId,
      user_id: params.actor.userId,
      scope,
      source_message_id: sourceMessageId,
      memory_type: classified.type,
      memory_key: memoryKeyFor(classified.type, fact),
      content: fact,
      normalized_fact: fact,
      confidence: 1,
      provenance: scope === "company" ? "company_explicit" as const : "user_explicit" as const,
      expires_at: null,
    }] : [];
  });
}

export function extractExplicitApprovedMemory(params: {
  message: string;
  sourceMessageId: string;
  actor: AssistantMemoryActor;
}): AssistantApprovedMemoryInput | null {
  return extractExplicitApprovedMemories(params)[0] || null;
}

export function extractMemoryDeleteIntent(message: string): AssistantMemoryDeleteIntent | null {
  const command = clean(message);
  if (!command) return null;
  const match = command.match(DELETE_COMMAND);
  if (!match) return null;
  const target = clean(match[1] || "", 200) || "";
  const company = /(?:компан|company)/i.test(target);
  const memoryTypes: AssistantMemoryDeleteIntent["memoryTypes"] = [];
  if (/(?:имя|name)/i.test(target)) memoryTypes.push("name");
  if (/(?:обращени|обращаться|называй|address)/i.test(target)) memoryTypes.push("preferred_address");
  if (/(?:язык|language)/i.test(target)) memoryTypes.push("language");
  if (/(?:стиль|style)/i.test(target)) memoryTypes.push("response_style");
  if (/(?:кратк|коротк|brevity)/i.test(target)) memoryTypes.push("response_brevity");
  if (company && /(?:термин|terminology)/i.test(target)) memoryTypes.push("company_terminology");
  if (company && /(?:процесс|process)/i.test(target)) memoryTypes.push("company_process_preference");
  if (company && !memoryTypes.length) memoryTypes.push("company_rule");
  return { scope: company ? "company" : "user_global", memoryTypes, memoryKey: null };
}

function categoryForType(type: AssistantMemoryType): "communication_preference" | "workflow_preference" | "user_identity" | "company_context" {
  if (type === "name" || type === "preferred_address" || type === "confirmed_role") return "user_identity";
  if (type.startsWith("company_")) return "company_context";
  if (type === "durable_work_preference" || type === "durable_work_rule") return "workflow_preference";
  return "communication_preference";
}

function metadataFor(input: AssistantApprovedMemoryInput): Record<string, unknown> {
  return {
    [MEMORY_METADATA_KEY]: {
      version: 2,
      scope: input.scope,
      provenance: input.provenance,
      source_message_id: input.source_message_id,
      memory_type: input.memory_type,
    },
  };
}

function normalizeDbRow(row: Record<string, any>): AssistantMemoryRecord | null {
  const memoryType = clean(row.memory_type) as AssistantMemoryType | null;
  const status = clean(row.status) as AssistantMemoryStatus | null;
  const scope = clean(row.scope) as AssistantMemoryScope | null;
  if (!memoryType || !A105_MEMORY_TYPES.includes(memoryType) || !status || !["candidate", "approved", "rejected"].includes(status)) return null;
  if (!scope || !["user", "user_global", "company"].includes(scope)) return null;
  const provenance = clean(row.provenance) as AssistantMemoryProvenance | null;
  const normalizedProvenance: AssistantMemoryProvenance = provenance && ["user_explicit", "assistant_inferred", "company_explicit", "legacy_candidate_v1"].includes(provenance)
    ? provenance
    : row.source === "explicit_user_command" ? "user_explicit" : "legacy_candidate_v1";
  const approvalMode = clean(row.approval_mode) as AssistantMemoryApprovalMode | null;
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    user_id: String(row.user_id),
    scope,
    source_message_id: String(row.source_message_id || ""),
    created_by: String(row.created_by || ""),
    approved_by: clean(row.approved_by, 100),
    memory_type: memoryType,
    memory_key: String(row.memory_key || ""),
    content: String(row.value || ""),
    normalized_fact: String(row.normalized_fact || row.value || ""),
    confidence: Number(row.confidence || 0),
    source: (clean(row.source) as AssistantMemorySource | null) || normalizedProvenance,
    provenance: normalizedProvenance,
    approval_mode: approvalMode || "legacy_v1",
    status,
    active: Boolean(row.active),
    approved_at: clean(row.approved_at, 100),
    rejected_at: clean(row.rejected_at, 100),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    expires_at: clean(row.expires_at, 100),
  };
}

const SELECT_COLUMNS = "id,company_id,user_id,scope,category,memory_key,value,normalized_fact,confidence,source,provenance,approval_mode,metadata,active,created_at,updated_at,source_message_id,created_by,approved_by,memory_type,status,approved_at,rejected_at,expires_at";

function insertPayload(input: AssistantApprovedMemoryInput): Record<string, unknown> {
  return {
    company_id: input.company_id,
    user_id: input.user_id,
    scope: input.scope,
    category: categoryForType(input.memory_type),
    memory_key: input.memory_key.slice(0, 120),
    value: input.content,
    normalized_fact: input.normalized_fact,
    confidence: input.confidence,
    source: input.provenance,
    provenance: input.provenance,
    approval_mode: input.provenance === "assistant_inferred"
      ? "model_inferred"
      : input.provenance === "company_explicit"
        ? "company_authorized"
        : "direct_user_explicit",
    metadata: metadataFor(input),
    active: true,
    source_message_id: input.source_message_id,
    created_by: input.user_id,
    approved_by: input.provenance === "assistant_inferred" ? null : input.user_id,
    memory_type: input.memory_type,
    status: "approved",
    approved_at: new Date().toISOString(),
    rejected_at: null,
    expires_at: input.expires_at || null,
  };
}

async function findActiveByIdentity(params: {
  supabase: SupabaseClient;
  input: AssistantApprovedMemoryInput;
}): Promise<AssistantMemoryRecord[]> {
  let query = params.supabase
    .from("assistant_memories")
    .select(SELECT_COLUMNS)
    .eq("scope", params.input.scope)
    .eq("memory_type", params.input.memory_type)
    .ilike("memory_key", params.input.memory_key)
    .eq("status", "approved")
    .eq("active", true);
  query = params.input.scope === "user_global"
    ? query.eq("user_id", params.input.user_id)
    : query.eq("company_id", params.input.company_id);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return ((result.data || []) as Record<string, any>[]).map(normalizeDbRow).filter((item): item is AssistantMemoryRecord => Boolean(item));
}

export async function upsertApprovedAssistantMemory(params: {
  supabase: SupabaseClient;
  input: AssistantApprovedMemoryInput;
}): Promise<AssistantMemoryRecord> {
  assertSafeMemoryContent(params.input.content);
  if (params.input.provenance === "assistant_inferred" && params.input.confidence < 0.85) {
    throw new AssistantMemoryPolicyError("MEMORY_CONFIDENCE_TOO_LOW", "Assistant-inferred memory confidence must be at least 0.850.");
  }
  const active = await findActiveByIdentity(params);
  const exact = active.find((record) =>
    record.provenance === params.input.provenance &&
    record.normalized_fact.toLowerCase() === params.input.normalized_fact.toLowerCase()
  );
  if (exact) return exact;
  for (const record of active) {
    const deletion = await params.supabase.from("assistant_memories").delete().eq("id", record.id);
    if (deletion.error) throw new Error(deletion.error.message);
  }
  const result = await params.supabase
    .from("assistant_memories")
    .insert(insertPayload(params.input))
    .select(SELECT_COLUMNS)
    .single();
  if (result.error) throw new Error(result.error.message);
  const record = normalizeDbRow(result.data as Record<string, any>);
  if (!record) throw new Error("Invalid Contract 0.4 memory record returned by storage");
  return record;
}

export async function listAssistantMemoryRecords(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  limit?: number;
}): Promise<{ memories: AssistantMemoryRecord[]; warning: string | null }> {
  const limit = Math.max(1, Math.min(Number(params.limit || 100), 300));
  const [globalResult, companyResult] = await Promise.all([
    params.supabase
      .from("assistant_memories")
      .select(SELECT_COLUMNS)
      .eq("user_id", params.userId)
      .eq("scope", "user_global")
      .order("updated_at", { ascending: false })
      .limit(limit),
    params.supabase
      .from("assistant_memories")
      .select(SELECT_COLUMNS)
      .eq("company_id", params.companyId)
      .eq("scope", "company")
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);
  const warnings = [globalResult.error?.message, companyResult.error?.message].filter(Boolean);
  const rows = [...(globalResult.data || []), ...(companyResult.data || [])] as Record<string, any>[];
  return {
    memories: rows.map(normalizeDbRow).filter((item): item is AssistantMemoryRecord => Boolean(item)).slice(0, limit),
    warning: warnings.length ? warnings.join("; ") : null,
  };
}

export async function listForgottenUserGlobalMemoryContext(params: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<ForgottenMemoryContext> {
  const result = await params.supabase
    .from("assistant_memory_events")
    .select("memory_id,source_message_id,event_type,memory_scope")
    .eq("user_id", params.userId)
    .eq("memory_scope", "user_global")
    .eq("event_type", "memory_deleted");
  if (result.error) return { memoryIds: [], sourceMessageIds: [], terms: [], warning: result.error.message };
  const rows = (result.data || []) as Array<Record<string, unknown>>;
  const sourceMessageIds = Array.from(new Set(rows.map((row) => clean(row.source_message_id, 100)).filter((id): id is string => Boolean(id))));
  let terms: string[] = [];
  if (sourceMessageIds.length) {
    const sources = await params.supabase.from("chat_messages").select("id,content").in("id", sourceMessageIds.slice(0, 100));
    if (!sources.error) {
      const collected: string[] = [];
      for (const row of (sources.data || []) as Array<Record<string, unknown>>) {
        const content = clean(row.content, 1_000) || "";
        const name = content.match(/(?:меня\s+зовут|мо[её]\s+имя|my\s+name\s+is)\s+([\p{L}][\p{L}'’-]{1,79})/iu);
        const address = content.match(/(?:обращайся\s+(?:ко\s+мне|как|со\s+мной\s+как)|называй\s+меня|call\s+me)\s+([^,;.!]{1,100})/i);
        if (name?.[1]) collected.push(name[1].trim());
        if (address?.[1]) collected.push(address[1].trim());
      }
      terms = Array.from(new Set(collected.filter((term) => term.length >= 2)));
    }
  }
  return {
    memoryIds: Array.from(new Set(rows.map((row) => clean(row.memory_id, 100)).filter((id): id is string => Boolean(id)))),
    sourceMessageIds,
    terms,
    warning: null,
  };
}

function assertOwned(record: AssistantMemoryRecord, actor: AssistantMemoryActor): void {
  const allowed = record.scope === "user_global"
    ? record.user_id === actor.userId
    : record.scope === "company" && record.company_id === actor.companyId;
  if (!allowed) throw new AssistantMemoryPolicyError("MEMORY_SCOPE_DENIED", "Memory is outside the current scope.", 403);
}

async function getOwnedMemory(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  memoryId: string;
}): Promise<AssistantMemoryRecord> {
  const result = await params.supabase.from("assistant_memories").select(SELECT_COLUMNS).eq("id", params.memoryId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const record = result.data ? normalizeDbRow(result.data as Record<string, any>) : null;
  if (!record) throw new AssistantMemoryPolicyError("MEMORY_NOT_FOUND", "Memory not found in current scope.", 404);
  assertOwned(record, { companyId: params.companyId, userId: params.userId });
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
  if (params.beforeDelete) await params.beforeDelete(record);
  const result = await params.supabase.from("assistant_memories").delete().eq("id", record.id);
  if (result.error) throw new Error(result.error.message);
  return record;
}

export async function deleteMatchingAssistantMemories(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  intent: AssistantMemoryDeleteIntent;
}): Promise<AssistantMemoryRecord[]> {
  const listed = await listAssistantMemoryRecords(params);
  if (listed.warning) throw new Error(listed.warning);
  const matches = listed.memories.filter((record) =>
    record.scope === params.intent.scope &&
    (!params.intent.memoryTypes.length || params.intent.memoryTypes.includes(record.memory_type as UserGlobalMemoryType | CompanyMemoryType)) &&
    (!params.intent.memoryKey || record.memory_key.toLowerCase() === params.intent.memoryKey.toLowerCase())
  );
  const deleted: AssistantMemoryRecord[] = [];
  for (const record of matches) {
    deleted.push(await deleteAssistantMemory({ ...params, memoryId: record.id }));
  }
  return deleted;
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
  const limit = Math.max(1, Math.min(Number(params.limit || 12), 20));
  return params.records
    .filter((record) =>
      ((record.scope === "user_global" && record.user_id === params.actor.userId) ||
        (record.scope === "company" && record.company_id === params.actor.companyId)) &&
      record.status === "approved" && record.active &&
      (!record.expires_at || Date.parse(record.expires_at) > now)
    )
    .map((record) => {
      const overlap = Array.from(tokens(record.normalized_fact)).filter((token) => queryTokens.has(token)).length;
      const globalPreference = ["name", "preferred_address", "language", "response_style", "response_brevity"].includes(record.memory_type);
      return { record, score: overlap * 10 + (globalPreference ? 20 : 0) + Date.parse(record.updated_at) / 1e15 };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.record);
}

export async function buildAssistantLongTermMemoryContext(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  query: string;
  limit?: number;
}): Promise<AssistantMemoryContext> {
  const listed = await listAssistantMemoryRecords({ ...params, limit: 100 });
  if (listed.warning) {
    return { count: 0, contextText: null, latestUpdatedAt: null, warning: listed.warning, ids: [], categories: [] };
  }
  const selected = selectRelevantApprovedMemories({
    records: listed.memories,
    actor: { companyId: params.companyId, userId: params.userId },
    query: params.query,
    limit: params.limit || 12,
  });
  return {
    count: selected.length,
    contextText: selected.length
      ? selected.map((record) => `- [${record.scope}] ${record.memory_type}: ${record.normalized_fact}`).join("\n")
      : null,
    latestUpdatedAt: selected[0]?.updated_at || null,
    warning: null,
    ids: selected.map((record) => record.id),
    categories: Array.from(new Set(selected.map((record) => record.memory_type))),
  };
}

// Archived V1 helpers now fail closed if old code accidentally reaches them.
export function extractExplicitMemoryCandidate(..._args: any[]): AssistantMemoryCandidate | null {
  throw new AssistantMemoryPolicyError("MEMORY_CANDIDATES_DISABLED", "Contract 0.4 forbids candidate creation.", 409);
}

export function createProposedMemoryCandidate(..._args: any[]): AssistantMemoryCandidate {
  throw new AssistantMemoryPolicyError("MEMORY_CANDIDATES_DISABLED", "Contract 0.4 forbids candidate creation.", 409);
}

export async function createAssistantMemoryCandidate(..._args: any[]): Promise<AssistantMemoryRecord> {
  throw new AssistantMemoryPolicyError("MEMORY_CANDIDATES_DISABLED", "Contract 0.4 forbids candidate creation.", 409);
}

export async function setAssistantMemoryStatus(..._args: any[]): Promise<AssistantMemoryRecord> {
  throw new AssistantMemoryPolicyError("MEMORY_CANDIDATES_DISABLED", "Contract 0.4 has no approve/reject transition.", 409);
}

export function approveAssistantMemoryRecord(..._args: any[]): AssistantMemoryRecord {
  throw new AssistantMemoryPolicyError("MEMORY_CANDIDATES_DISABLED", "Contract 0.4 has no candidate approval.", 409);
}

export function rejectAssistantMemoryRecord(..._args: any[]): AssistantMemoryRecord {
  throw new AssistantMemoryPolicyError("MEMORY_CANDIDATES_DISABLED", "Contract 0.4 has no candidate rejection.", 409);
}

export function assertAssistantMemoryDeleteAllowed(record: AssistantMemoryRecord, actor: AssistantMemoryActor): void {
  assertOwned(record, actor);
}

export function createInMemoryRecord(candidate: AssistantMemoryCandidate, id = randomUUID()): AssistantMemoryRecord {
  return { id, ...candidate };
}
