import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  chunkKnowledgeText,
  extractKnowledgeDocument,
} from "@/lib/assistant/knowledge/document-processing";
import {
  KNOWLEDGE_DOCUMENT_EXTENSIONS,
  getKnowledgeExtension,
  isSupportedKnowledgeExtension,
} from "@/lib/assistant/knowledge/document-types";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function asText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function requireKnowledgeAdmin(role: string | null | undefined) {
  if (role !== "global_admin" && role !== "company_admin") {
    throw new SessionAuthError("Knowledge base management is available only for admins", 403);
  }
}

async function getOrCreateGlobalKnowledgeBase(supabase: ReturnType<typeof getServiceClient>, companyId: string, userId: string) {
  const existing = await supabase
    .from("knowledge_bases")
    .select("*")
    .eq("company_id", companyId)
    .eq("scope_type", "global")
    .eq("archived", false)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") throw existing.error;
  if (existing.data) return existing.data as Record<string, unknown>;

  const created = await supabase
    .from("knowledge_bases")
    .insert({
      company_id: companyId,
      name: "Global Knowledge Base",
      scope_type: "global",
      is_default: true,
      created_by: userId,
    })
    .select("*")
    .single();

  if (created.error) throw created.error;
  return created.data as Record<string, unknown>;
}

function jsonError(error: unknown, fallback = "Knowledge base request failed") {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    requireKnowledgeAdmin(actor.role);
    const requestedCompanyId = asText(request.nextUrl.searchParams.get("companyId"));
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();
    const base = await getOrCreateGlobalKnowledgeBase(supabase, companyId, actor.authUserId || actor.id);

    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("company_id", companyId)
      .eq("knowledge_base_id", String(base.id))
      .eq("archived", false)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ documents: data || [] });
  } catch (error) {
    return jsonError(error, "Failed to load knowledge documents");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    requireKnowledgeAdmin(actor.role);
    const form = await request.formData();
    const requestedCompanyId = asText(form.get("companyId"));
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "File is too large. Max size is 25 MB." }, { status: 413 });
    }

    const extension = getKnowledgeExtension(file.name);
    if (!isSupportedKnowledgeExtension(extension)) {
      return NextResponse.json(
        { error: `Unsupported format .${extension || "unknown"}. Supported: ${KNOWLEDGE_DOCUMENT_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const base = await getOrCreateGlobalKnowledgeBase(supabase, companyId, actor.authUserId || actor.id);
    const buffer = Buffer.from(await file.arrayBuffer());
    let extractionError: string | null = null;
    const extracted = await extractKnowledgeDocument({
      filename: file.name,
      mimeType: file.type,
      buffer,
    }).catch((error) => {
      extractionError = error instanceof Error ? error.message : String(error);
      return {
        text: "",
        metadata: {
          extractor: "failed",
          error: extractionError,
        },
      };
    });
    const chunks = chunkKnowledgeText(extracted.text);
    const status = !extractionError && extracted.text.trim() && chunks.length ? "ready" : "failed";

    const inserted = await supabase
      .from("knowledge_documents")
      .insert({
        company_id: companyId,
        knowledge_base_id: String(base.id),
        filename: file.name,
        file_type: file.type || extension,
        file_size: file.size,
        file_url: null,
        extracted_text: extracted.text,
        metadata: {
          extension,
          source: "manual_upload",
          extraction: extracted.metadata,
          text_extracted: Boolean(extracted.text.trim()),
          chunks_count: chunks.length,
          extraction_error: extractionError,
        },
        status,
        created_by: actor.authUserId || actor.id,
      })
      .select("*")
      .single();

    if (inserted.error) throw inserted.error;

    if (status === "ready" && chunks.length) {
      const chunkRows = chunks.map((chunk) => ({
        company_id: companyId,
        knowledge_base_id: String(base.id),
        knowledge_document_id: String(inserted.data.id),
        chunk_index: chunk.index,
        content: chunk.content,
        metadata: chunk.metadata,
      }));
      const chunkInsert = await supabase.from("knowledge_document_chunks").insert(chunkRows);
      if (chunkInsert.error) {
        await supabase
          .from("knowledge_documents")
          .update({
            metadata: {
              ...(inserted.data.metadata || {}),
              chunks_count: 0,
              chunk_insert_warning: chunkInsert.error.message,
            },
          })
          .eq("id", inserted.data.id);
      }
    }

    return NextResponse.json({ document: inserted.data });
  } catch (error) {
    return jsonError(error, "Failed to upload knowledge document");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    requireKnowledgeAdmin(actor.role);
    const payload = await request.json().catch(() => ({}));
    const documentId = asText(payload?.documentId);
    if (!documentId) {
      return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    }
    const supabase = getServiceClient();
    const now = new Date().toISOString();
    const updated = await supabase
      .from("knowledge_documents")
      .update({ archived: true, updated_at: now })
      .eq("id", documentId)
      .select("company_id")
      .single();
    if (updated.error) throw updated.error;

    await supabase
      .from("knowledge_document_chunks")
      .update({ archived: true, updated_at: now })
      .eq("knowledge_document_id", documentId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Failed to archive knowledge document");
  }
}
