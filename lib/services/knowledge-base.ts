import { supabase } from "@/lib/supabase/client";
import { KNOWLEDGE_DOCUMENT_EXTENSIONS } from "@/lib/assistant/knowledge/document-types";

export interface KnowledgeBase {
  id: string;
  company_id: string;
  name: string;
  scope_type: "global" | "project" | "assistant";
  scope_project_id: string | null;
  scope_assistant_id: string | null;
  is_default: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocument {
  id: string;
  company_id: string;
  knowledge_base_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  file_url: string | null;
  extracted_text: string;
  metadata: Record<string, unknown>;
  status: "ready" | "uploaded" | "failed";
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

async function buildAuthHeaders(contentType: "json" | "none" = "none") {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {};
  if (contentType === "json") headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Knowledge base request failed (${response.status})`);
  }
  return payload as T;
}

export async function listGlobalKnowledgeDocuments(companyId: string): Promise<KnowledgeDocument[]> {
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/assistant/knowledge?companyId=${encodeURIComponent(companyId)}`, {
    method: "GET",
    headers,
  });
  const payload = await parseApiResponse<{ documents?: KnowledgeDocument[] }>(response);
  return payload.documents || [];
}

export async function uploadGlobalKnowledgeDocument(
  companyId: string,
  _userId: string | undefined,
  file: File
): Promise<KnowledgeDocument> {
  const headers = await buildAuthHeaders("none");
  const form = new FormData();
  form.append("companyId", companyId);
  form.append("file", file);
  const response = await fetch("/api/assistant/knowledge", {
    method: "POST",
    headers,
    body: form,
  });
  const payload = await parseApiResponse<{ document: KnowledgeDocument }>(response);
  return payload.document;
}

export async function archiveKnowledgeDocument(documentId: string): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/assistant/knowledge", {
    method: "DELETE",
    headers,
    body: JSON.stringify({ documentId }),
  });
  await parseApiResponse<{ ok: boolean }>(response);
}

export const KNOWLEDGE_SUPPORTED_FORMATS = {
  images: [],
  documents: [...KNOWLEDGE_DOCUMENT_EXTENSIONS],
};
