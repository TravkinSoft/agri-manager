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
const MAX_CHUNKS = 8;

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
  return scoreText(filename, text, tokens);
}

function scoreText(filename: string, text: string, tokens: string[]): number {
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

function buildContextFromBlocks(params: {
  blocks: Array<{ filename: string; content: string; chunkIndex?: number | null }>;
  pendingCount: number;
  warning: string | null;
}): CompanyKnowledgeContext {
  const contextBlocks = params.blocks.map((block) => {
    const suffix = Number.isFinite(Number(block.chunkIndex)) ? ` #${Number(block.chunkIndex) + 1}` : "";
    return `[${block.filename}${suffix}]\n${block.content}`;
  });
  const rawContext = [
    "Company knowledge library context:",
    "Use these internal documents before generic model knowledge for agronomy, machinery, product instructions and local methods. Do not treat library text as live ERP balance/status data.",
    contextBlocks.join("\n\n"),
  ].join("\n\n");
  const contextText =
    rawContext.length > MAX_CONTEXT_CHARS ? `${rawContext.slice(0, MAX_CONTEXT_CHARS - 3).trim()}...` : rawContext;

  return {
    source: "knowledge_documents",
    documentCount: new Set(params.blocks.map((block) => block.filename)).size,
    pendingCount: params.pendingCount,
    fileNames: Array.from(new Set(params.blocks.map((block) => block.filename))),
    contextText,
    warning: params.warning,
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
  const chunkOrFilter = safeTokens.map((token) => `content.ilike.%${token}%`).join(",");

  const chunkQuery = params.supabase
    .from("knowledge_document_chunks")
    .select("id,knowledge_document_id,chunk_index,content,metadata")
    .eq("company_id", params.companyId)
    .eq("archived", false)
    .or(chunkOrFilter)
    .limit(40);

  const pendingQuery = params.supabase
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", params.companyId)
    .eq("archived", false)
    .neq("status", "ready");

  const [chunks, pending] = await Promise.all([chunkQuery, pendingQuery]);

  if (!chunks.error && Array.isArray(chunks.data) && chunks.data.length) {
    const docIds = Array.from(
      new Set(
        chunks.data
          .map((row: any) => cleanString(row.knowledge_document_id))
          .filter((value): value is string => Boolean(value))
      )
    );
    const docs = docIds.length
      ? await params.supabase
          .from("knowledge_documents")
          .select("id,filename,status,archived")
          .eq("company_id", params.companyId)
          .eq("archived", false)
          .eq("status", "ready")
          .in("id", docIds)
      : { data: [], error: null };

    const docById = new Map<string, Record<string, unknown>>();
    if (!docs.error && Array.isArray(docs.data)) {
      docs.data.forEach((doc: any) => docById.set(String(doc.id), doc));
    }

    const scored = chunks.data
      .map((row: any) => {
        const doc = docById.get(String(row.knowledge_document_id));
        const filename = cleanString(doc?.filename) || "knowledge-document";
        const content = cleanString(row.content) || "";
        return {
          filename,
          content,
          chunkIndex: Number.isFinite(Number(row.chunk_index)) ? Number(row.chunk_index) : null,
          score: scoreText(normalize(filename), normalize(content), safeTokens),
        };
      })
      .filter((item) => item.score > 0 && item.content)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CHUNKS)
      .map((item) => ({
        filename: item.filename,
        content: buildSnippet(item.content, safeTokens),
        chunkIndex: item.chunkIndex,
      }));

    if (scored.length) {
      return buildContextFromBlocks({
        blocks: scored,
        pendingCount: pending.count || 0,
        warning: pending.error ? pending.error.message : null,
      });
    }
  }

  const ready = await params.supabase
    .from("knowledge_documents")
    .select("id,filename,extracted_text,metadata,status,updated_at")
    .eq("company_id", params.companyId)
    .eq("archived", false)
    .eq("status", "ready")
    .or(orFilter)
    .limit(20);

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
    return { filename, content: snippet };
  });
  return buildContextFromBlocks({
    blocks,
    pendingCount: pending.count || 0,
    warning:
      (chunks.error && !String(chunks.error.message || "").toLowerCase().includes("does not exist")
        ? chunks.error.message
        : null) || (pending.error ? pending.error.message : null),
  });
}
