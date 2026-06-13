import type { SupabaseClient } from "@supabase/supabase-js";
import { applySemanticExpansions } from "@/lib/assistant/knowledge/semantic-memory";

export type CompanyKnowledgeContext = {
  source: "knowledge_documents";
  documentCount: number;
  pendingCount: number;
  fileNames: string[];
  contextText: string | null;
  warning: string | null;
};

const MAX_DOCS = 8;
const MAX_TOKENS = 7;
const MAX_SNIPPET_CHARS = 700;
const MAX_CONTEXT_CHARS = 2600;

function cleanString(value: unknown): string | null {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const tokens = normalize(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token));
  return Array.from(new Set(tokens)).slice(0, MAX_TOKENS);
}

function escapePostgrestLike(value: string): string {
  return value.replace(/[%*,()]/g, " ").replace(/\s+/g, " ").trim();
}

function scoreDocument(row: Record<string, unknown>, tokens: string[]): number {
  const filename = normalize(String(row.filename || ""));
  const text = normalize(String(row.extracted_text || "").slice(0, 12000));
  return tokens.reduce((score, token) => {
    let next = score;
    if (filename.includes(token)) next += 6;
    if (text.includes(token)) next += 2;
    return next;
  }, 0);
}

function buildSnippet(text: string, tokens: string[]): string {
  const source = cleanString(text) || "";
  if (!source) return "";
  const normalized = normalize(source);
  const matchToken = tokens.find((token) => normalized.includes(token));
  if (!matchToken) return source.slice(0, MAX_SNIPPET_CHARS).trim();

  const index = normalized.indexOf(matchToken);
  const start = Math.max(0, index - 220);
  const end = Math.min(source.length, start + MAX_SNIPPET_CHARS);
  return source.slice(start, end).trim();
}

function emptyContext(warning: string | null = null): CompanyKnowledgeContext {
  return {
    source: "knowledge_documents",
    documentCount: 0,
    pendingCount: 0,
    fileNames: [],
    contextText: null,
    warning,
  };
}

export async function buildCompanyKnowledgeContext(params: {
  supabase: SupabaseClient;
  companyId: string;
  message: string;
}): Promise<CompanyKnowledgeContext> {
  const expandedMessage = applySemanticExpansions(params.message);
  const tokens = tokenize(expandedMessage);
  if (!tokens.length) return emptyContext();

  const safeTokens = tokens.map(escapePostgrestLike).filter(Boolean);
  if (!safeTokens.length) return emptyContext();

  const orFilter = safeTokens
    .flatMap((token) => [`filename.ilike.%${token}%`, `extracted_text.ilike.%${token}%`])
    .join(",");

  const readyQuery = params.supabase
    .from("knowledge_documents")
    .select("id,filename,extracted_text,metadata,status,updated_at")
    .eq("company_id", params.companyId)
    .eq("archived", false)
    .eq("status", "ready")
    .or(orFilter)
    .limit(20);

  const pendingQuery = params.supabase
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", params.companyId)
    .eq("archived", false)
    .neq("status", "ready");

  const [ready, pending] = await Promise.all([readyQuery, pendingQuery]);

  if (ready.error) {
    const text = String(ready.error.message || "");
    if (text.toLowerCase().includes("does not exist") || text.toLowerCase().includes("schema cache")) {
      return emptyContext(text);
    }
    return emptyContext(text);
  }

  const rows = Array.isArray(ready.data) ? ready.data : [];
  const scored = rows
    .map((row) => ({
      row: row as Record<string, unknown>,
      score: scoreDocument(row as Record<string, unknown>, safeTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DOCS);

  if (!scored.length) {
    return {
      ...emptyContext(pending.error ? pending.error.message : null),
      pendingCount: pending.count || 0,
    };
  }

  const blocks = scored.map(({ row }) => {
    const filename = cleanString(row.filename) || "knowledge-document";
    const snippet = buildSnippet(String(row.extracted_text || ""), safeTokens);
    return `[${filename}]\n${snippet}`;
  });
  const rawContext = [
    "Company knowledge library context:",
    "Use these internal documents before generic model knowledge for agronomy, machinery, product instructions and local methods. Do not treat library text as live ERP balance/status data.",
    blocks.join("\n\n"),
  ].join("\n\n");
  const contextText =
    rawContext.length > MAX_CONTEXT_CHARS ? `${rawContext.slice(0, MAX_CONTEXT_CHARS - 3).trim()}...` : rawContext;

  return {
    source: "knowledge_documents",
    documentCount: scored.length,
    pendingCount: pending.count || 0,
    fileNames: scored.map(({ row }) => cleanString(row.filename) || "knowledge-document"),
    contextText,
    warning: pending.error ? pending.error.message : null,
  };
}
