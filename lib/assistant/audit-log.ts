import type { SupabaseClient } from "@supabase/supabase-js";

export type AssistantAuditLogPayload = {
  actor_user_id: string;
  company_id: string;
  role: string;
  chat_id?: string | null;
  session_id?: string | null;
  intent: string;
  tool_calls: Array<Record<string, unknown>>;
  runtime_context?: Record<string, unknown>;
  request_excerpt?: string | null;
  response_excerpt?: string | null;
  error_text?: string | null;
};

function truncate(value: string | null | undefined, max = 2000): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export async function writeAssistantAuditLog(
  supabase: SupabaseClient,
  payload: AssistantAuditLogPayload,
  options: { required?: boolean } = {}
): Promise<void> {
  const row = {
    actor_user_id: payload.actor_user_id,
    company_id: payload.company_id,
    role: payload.role,
    chat_id: payload.chat_id || null,
    session_id: payload.session_id || null,
    intent: payload.intent,
    tool_calls: payload.tool_calls || [],
    runtime_context: payload.runtime_context || {},
    request_excerpt: truncate(payload.request_excerpt, 1500),
    response_excerpt: truncate(payload.response_excerpt, 1500),
    error_text: truncate(payload.error_text, 1500),
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("assistant_audit_logs").insert([row]);
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (!options.required && (msg.includes("does not exist") || msg.includes("schema cache"))) {
      return;
    }
    throw new Error(error.message);
  }
}

