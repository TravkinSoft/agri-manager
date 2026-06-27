import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import {
  KNOWLEDGE_EXTRACTION_TEXT_REQUIRED_ERROR,
  KNOWLEDGE_OPENAI_MISSING_ENV_ERROR,
  buildKnowledgeSourceContexts,
  buildProductMetadataSuggestionRows,
  extractKnowledgeProductMetadataDraft,
} from "@/lib/knowledge/extraction";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function jsonAuthError(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

async function requireGlobalAdmin(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (actor.role !== "global_admin") {
    throw new SessionAuthError("Only global admin can run knowledge extraction", 403);
  }
  return actor;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireGlobalAdmin(request);

    const runId = text(params?.id);
    if (!runId) return NextResponse.json({ error: "run_id is required" }, { status: 400 });

    const supabase = getServiceClient();

    const { data: run, error: runError } = await supabase
      .from("knowledge_intake_runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle();

    if (runError) throw new Error(runError.message);
    if (!run) return NextResponse.json({ error: "Knowledge intake run not found" }, { status: 404 });

    const [sourcesResult, matchesResult] = await Promise.all([
      supabase.from("knowledge_intake_sources").select("*").eq("run_id", runId).order("created_at", { ascending: true }),
      supabase
        .from("knowledge_intake_matches")
        .select("id,product_id,confidence,products:product_id(*)")
        .eq("run_id", runId)
        .order("confidence", { ascending: false })
        .limit(1),
    ]);

    if (sourcesResult.error) throw new Error(sourcesResult.error.message);
    if (matchesResult.error) throw new Error(matchesResult.error.message);

    const sources = sourcesResult.data || [];
    if (!sources.length) {
      return NextResponse.json({ error: "Добавьте источник перед извлечением данных." }, { status: 400 });
    }

    const sourceContexts = buildKnowledgeSourceContexts(sources as Array<Record<string, unknown>>);
    if (!sourceContexts.length) {
      return NextResponse.json({ error: KNOWLEDGE_EXTRACTION_TEXT_REQUIRED_ERROR }, { status: 400 });
    }

    const primaryMatch = matchesResult.data?.[0] || null;
    const currentProduct = primaryMatch?.products
      ? Array.isArray(primaryMatch.products)
        ? primaryMatch.products[0] || null
        : primaryMatch.products
      : null;
    const productId = primaryMatch?.product_id ? String(primaryMatch.product_id) : null;
    const primarySource = sourceContexts[0] || null;
    const sourceUrl = sourceContexts.find((source) => source.url)?.url || null;

    const extraction = await extractKnowledgeProductMetadataDraft({
      runInput: text(run.input_value),
      runManufacturer: text(run.input_manufacturer) || null,
      sources: sourceContexts,
    });

    const { error: deleteError } = await supabase
      .from("product_metadata_suggestions")
      .delete()
      .eq("run_id", runId)
      .in("status", ["draft", "needs_review"]);
    if (deleteError) throw new Error(deleteError.message);

    const suggestionRows = buildProductMetadataSuggestionRows({
      runId,
      productId,
      sourceId: primarySource?.sourceId || null,
      sourceIds: sourceContexts.map((source) => source.sourceId),
      sourceUrl,
      currentProduct: (currentProduct as Record<string, unknown> | null) || null,
      draft: extraction,
    });

    const { data: suggestions, error: suggestionsError } = await supabase
      .from("product_metadata_suggestions")
      .insert(suggestionRows)
      .select("*")
      .order("created_at", { ascending: true });

    if (suggestionsError) throw new Error(suggestionsError.message);

    const { data: updatedRun, error: updateError } = await supabase
      .from("knowledge_intake_runs")
      .update({ status: "extracted", completed_at: new Date().toISOString() })
      .eq("id", runId)
      .select("*")
      .single();

    if (updateError || !updatedRun) {
      throw new Error(updateError?.message || "Failed to update knowledge intake run");
    }

    return NextResponse.json({
      run: {
        ...updatedRun,
        input_type: updatedRun?.input_type === "name" ? "text" : updatedRun?.input_type,
      },
      extraction,
      suggestions: suggestions || [],
    });
  } catch (error) {
    const authError = jsonAuthError(error);
    if (authError) return authError;
    const message = error instanceof Error ? error.message : "Failed to extract product metadata";
    const status = message === KNOWLEDGE_OPENAI_MISSING_ENV_ERROR ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
