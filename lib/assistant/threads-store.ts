import type { SupabaseClient } from "@supabase/supabase-js";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

export type AssistantThreadRecord = {
  id: string;
  company_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  current_page_context: Record<string, unknown> | null;
};

export type AssistantThreadMessageRole = "user" | "assistant" | "tool" | "system";

export type AssistantThreadMessageRecord = {
  id: string;
  thread_id: string;
  role: AssistantThreadMessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ASSISTANT_PROJECT_NAME = "__assistant_panel__";

function cleanString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function isMissingRelationError(errorMessage: string): boolean {
  const text = String(errorMessage || "").toLowerCase();
  return text.includes("does not exist") || text.includes("schema cache");
}

function normalizeStoredRole(role: AssistantThreadMessageRole): "user" | "assistant" {
  return role === "user" ? "user" : "assistant";
}

function readRoleFromMessageRow(row: Record<string, unknown>): AssistantThreadMessageRole {
  const metadata = row.metadata as Record<string, unknown> | null;
  const fromMeta = cleanString(metadata?.message_role)?.toLowerCase();
  if (fromMeta === "tool") return "tool";
  if (fromMeta === "system") return "system";
  if (fromMeta === "user") return "user";
  return cleanString(row.role)?.toLowerCase() === "user" ? "user" : "assistant";
}

async function ensureAssistantProjectId(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
}): Promise<string | null> {
  const { supabase, companyId, userId } = params;
  const selectRes = await supabase
    .from("chat_projects")
    .select("id,name,archived")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("name", ASSISTANT_PROJECT_NAME)
    .limit(1)
    .maybeSingle();

  if (selectRes.error) {
    if (isMissingRelationError(selectRes.error.message)) return null;
    throw new Error(selectRes.error.message);
  }

  if (selectRes.data?.id) {
    const projectId = String(selectRes.data.id);
    if (selectRes.data.archived !== true) {
      const archiveRes = await supabase
        .from("chat_projects")
        .update({ archived: true, updated_at: new Date().toISOString() })
        .eq("id", projectId);
      if (archiveRes.error && !isMissingRelationError(archiveRes.error.message)) {
        throw new Error(archiveRes.error.message);
      }
    }
    return projectId;
  }

  const insertRes = await supabase
    .from("chat_projects")
    .insert({
      company_id: companyId,
      user_id: userId,
      name: ASSISTANT_PROJECT_NAME,
      archived: true,
    })
    .select("id")
    .single();

  if (insertRes.error) {
    if (isMissingRelationError(insertRes.error.message)) return null;
    throw new Error(insertRes.error.message);
  }

  return String(insertRes.data.id);
}

export async function listAssistantThreads(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  limit?: number;
}): Promise<AssistantThreadRecord[]> {
  const { supabase, companyId, userId } = params;
  const limit = Math.max(1, Math.min(Number(params.limit ?? 50), 100));
  const assistantProjectId = await ensureAssistantProjectId({ supabase, companyId, userId });

  let query = supabase
    .from("chats")
    .select("id,company_id,user_id,title,created_at,updated_at,project_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (assistantProjectId) {
    query = query.eq("project_id", assistantProjectId);
  }

  const res = await query;
  if (res.error) throw new Error(res.error.message);

  return (res.data || []).map((row: any) => ({
    id: String(row.id),
    company_id: String(row.company_id),
    user_id: String(row.user_id),
    title: cleanString(row.title) || "Новый чат",
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || new Date().toISOString()),
    current_page_context: null,
  }));
}

export async function createAssistantThread(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  title?: string | null;
  currentPageContext?: Record<string, unknown> | null;
}): Promise<AssistantThreadRecord> {
  const { supabase, companyId, userId } = params;
  const assistantProjectId = await ensureAssistantProjectId({ supabase, companyId, userId });
  const normalizedTitle = cleanString(params.title) || "Новый чат";
  const insertPayload: Record<string, unknown> = {
    company_id: companyId,
    user_id: userId,
    title: normalizedTitle,
  };
  if (assistantProjectId) {
    insertPayload.project_id = assistantProjectId;
  }

  const res = await supabase
    .from("chats")
    .insert(insertPayload)
    .select("id,company_id,user_id,title,created_at,updated_at")
    .single();
  if (res.error) throw new Error(res.error.message);

  return {
    id: String(res.data.id),
    company_id: String(res.data.company_id),
    user_id: String(res.data.user_id),
    title: cleanString(res.data.title) || "Новый чат",
    created_at: String(res.data.created_at || new Date().toISOString()),
    updated_at: String(res.data.updated_at || new Date().toISOString()),
    current_page_context: null,
  };
}

export async function getAssistantThreadById(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  threadId: string;
}): Promise<AssistantThreadRecord | null> {
  const { supabase, companyId, userId, threadId } = params;
  const res = await supabase
    .from("chats")
    .select("id,company_id,user_id,title,created_at,updated_at")
    .eq("id", threadId)
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) return null;
  return {
    id: String(res.data.id),
    company_id: String(res.data.company_id),
    user_id: String(res.data.user_id),
    title: cleanString(res.data.title) || "Новый чат",
    created_at: String(res.data.created_at || new Date().toISOString()),
    updated_at: String(res.data.updated_at || new Date().toISOString()),
    current_page_context: null,
  };
}

export async function updateAssistantThreadTitle(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  threadId: string;
  title: string;
}): Promise<void> {
  const { supabase, companyId, userId, threadId, title } = params;
  const normalized = cleanString(title);
  if (!normalized) return;
  const res = await supabase
    .from("chats")
    .update({ title: normalized, updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("company_id", companyId)
    .eq("user_id", userId);
  if (res.error) throw new Error(res.error.message);
}

export async function listAssistantThreadMessages(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  threadId: string;
  limit?: number;
}): Promise<AssistantThreadMessageRecord[]> {
  const { supabase, companyId, userId, threadId } = params;
  const thread = await getAssistantThreadById({ supabase, companyId, userId, threadId });
  if (!thread) return [];

  const limit = Math.max(1, Math.min(Number(params.limit ?? 300), 1000));
  const res = await supabase
    .from("chat_messages")
    .select("id,chat_id,role,content,metadata,created_at")
    .eq("chat_id", threadId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (res.error) throw new Error(res.error.message);

  return (res.data || [])
    .map((row: any) => {
      const messageRow = row as Record<string, unknown>;
      return {
        id: String(row.id),
        thread_id: String(row.chat_id),
        role: readRoleFromMessageRow(messageRow),
        content: String(row.content || ""),
        metadata: (row.metadata as Record<string, unknown> | null) || null,
        created_at: String(row.created_at || new Date().toISOString()),
      };
    })
    .filter((message) => !hasQaDataMarker(`${message.content} ${JSON.stringify(message.metadata || {})}`));
}

export async function appendAssistantThreadMessage(params: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  threadId: string;
  role: AssistantThreadMessageRole;
  content: string;
  metadata?: Record<string, unknown> | null;
}): Promise<AssistantThreadMessageRecord> {
  const { supabase, companyId, userId, threadId, role } = params;
  const content = String(params.content || "").trim();
  if (!content) throw new Error("Message content is required");

  const thread = await getAssistantThreadById({ supabase, companyId, userId, threadId });
  if (!thread) throw new Error("Thread not found in current company scope");

  const inputMetadata: Record<string, unknown> =
    params.metadata && typeof params.metadata === "object" ? { ...params.metadata } : {};
  inputMetadata.message_role = role;

  const insertRes = await supabase
    .from("chat_messages")
    .insert({
      chat_id: threadId,
      role: normalizeStoredRole(role),
      content,
      metadata: inputMetadata,
    })
    .select("id,chat_id,role,content,metadata,created_at")
    .single();
  if (insertRes.error) throw new Error(insertRes.error.message);

  const updateRes = await supabase
    .from("chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("company_id", companyId)
    .eq("user_id", userId);
  if (updateRes.error) throw new Error(updateRes.error.message);

  const row = insertRes.data as Record<string, unknown>;
  return {
    id: String(row.id),
    thread_id: String(row.chat_id),
    role: readRoleFromMessageRow(row),
    content: String(row.content || ""),
    metadata: (row.metadata as Record<string, unknown> | null) || null,
    created_at: String(row.created_at || new Date().toISOString()),
  };
}
