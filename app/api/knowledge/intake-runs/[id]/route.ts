import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { buildProductPassport } from "@/lib/products/product-passport";

function normalizeRunForApi(row: any) {
  return {
    ...row,
    input_type: row?.input_type === "name" ? "text" : row?.input_type,
  };
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
    throw new SessionAuthError("Only global admin can use knowledge intake", 403);
  }
  return actor;
}

function normalizeMatch(row: any) {
  const product = row.products || {};
  const passport = product?.id ? buildProductPassport({ ...product, id: String(row.product_id || product.id || "") }) : null;
  return {
    id: row.id,
    run_id: row.run_id,
    product_id: row.product_id,
    display_name: passport?.displayName || product.trade_name || product.name || row.product_id,
    trade_name: passport?.tradeName || product.trade_name || product.name || "",
    manufacturer: passport?.manufacturer.name || product.manufacturer || null,
    product_type: passport?.classification.productType || product.product_type || product.type || null,
    subcategory: passport?.classification.subcategory || product.subcategory || product.pesticide_category || product.fertilizer_type || null,
    stock_unit: passport?.units.stockUnit === "unknown" ? null : passport?.units.stockUnit || product.stock_unit || null,
    default_rate_type: passport?.units.defaultRateType || product.default_rate_type || null,
    default_rate_unit: passport?.units.defaultRateUnit || product.default_rate_unit || null,
    metadata_review_required: Boolean(passport?.review.metadataReviewRequired),
    match_type: row.match_type,
    confidence: Number(row.confidence || 0),
    reason: row.reason || "",
    created_at: row.created_at,
  };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireGlobalAdmin(request);
    const id = String(params?.id || "").trim();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const supabase = getServiceClient();
    const { data: run, error: runError } = await supabase
      .from("knowledge_intake_runs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (runError) throw new Error(runError.message);
    if (!run) return NextResponse.json({ error: "Knowledge intake run not found" }, { status: 404 });

    const [matchesResult, sourcesResult, suggestionsResult] = await Promise.all([
      supabase
        .from("knowledge_intake_matches")
        .select(
          `
          id,
          run_id,
          product_id,
          match_type,
          confidence,
          reason,
          created_at,
          products:product_id(
            id,
            company_id,
            name,
            trade_name,
            normalized_name,
            manufacturer,
            product_type,
            type,
            category,
            subcategory,
            pesticide_category,
            fertilizer_type,
            unit,
            stock_unit,
            base_uom,
            default_unit,
            application_unit,
            default_rate_type,
            default_rate_unit,
            physical_state,
            metadata_review_required,
            metadata_confidence,
            metadata_source_url,
            notes
          )
        `
        )
        .eq("run_id", id)
        .order("confidence", { ascending: false }),
      supabase.from("knowledge_intake_sources").select("*").eq("run_id", id).order("created_at", { ascending: true }),
      supabase.from("product_metadata_suggestions").select("*").eq("run_id", id).order("created_at", { ascending: true }),
    ]);

    if (matchesResult.error) throw new Error(matchesResult.error.message);
    if (sourcesResult.error) throw new Error(sourcesResult.error.message);
    if (suggestionsResult.error) throw new Error(suggestionsResult.error.message);

    return NextResponse.json({
      run: normalizeRunForApi(run),
      matches: (matchesResult.data || []).map(normalizeMatch),
      sources: sourcesResult.data || [],
      suggestions: suggestionsResult.data || [],
    });
  } catch (error) {
    const authError = jsonAuthError(error);
    if (authError) return authError;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load intake run" }, { status: 500 });
  }
}

