import { NextRequest, NextResponse } from "next/server";
import {
  getUserScopedClientFromRequest,
  SessionAuthError,
} from "@/lib/auth/server-session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
function apiError(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Не удалось загрузить карточку препарата";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const productId = String(params.id || "").trim();
    if (!UUID_RE.test(productId)) {
      return NextResponse.json({ error: "Некорректный идентификатор препарата" }, { status: 400 });
    }

    const supabase = await getUserScopedClientFromRequest(request);
    const { data: product, error: productError } = await supabase
      .from("products")
      .select(
        "id,trade_name,name,name_ru,name_en,manufacturer,manufacturer_id,formulation,formulation_id,pesticide_category,subcategory,is_active,archived",
      )
      .eq("id", productId)
      .is("company_id", null)
      .eq("type", "pesticide")
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product) {
      return NextResponse.json({ error: "Глобальная карточка препарата не найдена" }, { status: 404 });
    }

    const [aliasesResult, linksResult, sourcesResult, registrationsResult, rulesResult, safetyResult] = await Promise.all([
      supabase.from("global_product_aliases").select("alias").eq("product_id", productId).order("alias"),
      supabase
        .from("glbd_product_components")
        .select("id,component_id,role_in_product,concentration_value,concentration_unit,concentration_text,equivalent_basis,is_primary_active,sort_order")
        .eq("product_id", productId)
        .eq("review_status", "approved")
        .order("sort_order"),
      supabase
        .from("glbd_product_sources")
        .select("id,source_type,source_url,source_title,claim_fields,checked_on,confidence,verification_status")
        .eq("product_id", productId)
        .order("checked_on", { ascending: false }),
      supabase
        .from("glbd_product_registrations")
        .select("id,country_code,registration_number,registration_status,valid_from,valid_until,registrant,source_id")
        .eq("product_id", productId)
        .order("valid_until", { ascending: false }),
      supabase
        .from("glbd_product_usage_rules")
        .select("id,crop_id,variety_id,target_type,disease_id,pest_id,weed_id,target_text,rate_min,rate_max,rate_unit,working_fluid_min,working_fluid_max,working_fluid_unit,application_method,crop_stage,target_stage,timing_condition,max_treatments,harvest_interval_days,reentry_hours,restrictions,notes,source_id")
        .eq("product_id", productId)
        .order("rule_key"),
      supabase
        .from("glbd_product_assistant_safety")
        .select("read_allowed,recommendation_allowed,missing_critical_fields,blocked_reason,verified_at")
        .eq("product_id", productId)
        .maybeSingle(),
    ]);

    const firstError = [aliasesResult, linksResult, sourcesResult, registrationsResult, rulesResult, safetyResult]
      .map((result) => result.error)
      .find(Boolean);
    if (firstError) throw new Error(firstError.message);

    const links = linksResult.data || [];
    const rules = rulesResult.data || [];
    const componentIds = unique(links.map((row) => row.component_id));
    const cropIds = unique(rules.map((row) => row.crop_id));
    const diseaseIds = unique(rules.map((row) => row.disease_id));
    const pestIds = unique(rules.map((row) => row.pest_id));
    const weedIds = unique(rules.map((row) => row.weed_id));

    const [componentsResult, cropsResult, diseasesResult, pestsResult, weedsResult, manufacturerResult, formulationResult] = await Promise.all([
      componentIds.length
        ? supabase.from("glbd_components").select("id,name_ru,name_en,component_type").in("id", componentIds)
        : Promise.resolve({ data: [], error: null }),
      cropIds.length
        ? supabase.from("crops").select("id,name_ru,name_en").in("id", cropIds)
        : Promise.resolve({ data: [], error: null }),
      diseaseIds.length
        ? supabase.from("diseases").select("id,name_ru,name_en").in("id", diseaseIds)
        : Promise.resolve({ data: [], error: null }),
      pestIds.length
        ? supabase.from("pests").select("id,name_ru,name_en").in("id", pestIds)
        : Promise.resolve({ data: [], error: null }),
      weedIds.length
        ? supabase.from("weeds").select("id,name_ru,name_en").in("id", weedIds)
        : Promise.resolve({ data: [], error: null }),
      product.manufacturer_id
        ? supabase.from("agrochem_manufacturers").select("id,name").eq("id", product.manufacturer_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      product.formulation_id
        ? supabase.from("agrochem_formulations").select("id,code,name_ru").eq("id", product.formulation_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const relatedError = [componentsResult, cropsResult, diseasesResult, pestsResult, weedsResult, manufacturerResult, formulationResult]
      .map((result) => result.error)
      .find(Boolean);
    if (relatedError) throw new Error(relatedError.message);

    const byId = (rows: any[]) => new Map(rows.map((row) => [row.id, row]));
    const componentsById = byId(componentsResult.data || []);
    const cropsById = byId(cropsResult.data || []);
    const diseasesById = byId(diseasesResult.data || []);
    const pestsById = byId(pestsResult.data || []);
    const weedsById = byId(weedsResult.data || []);

    return NextResponse.json({
      product: {
        id: product.id,
        tradeName: product.trade_name || product.name,
        nameRu: product.name_ru,
        nameEn: product.name_en,
        manufacturer: manufacturerResult.data?.name || product.manufacturer || null,
        formulation: formulationResult.data
          ? `${formulationResult.data.name_ru} (${formulationResult.data.code})`
          : product.formulation || null,
        category: product.pesticide_category || null,
        subcategory: product.subcategory || null,
        active: Boolean(product.is_active) && !Boolean(product.archived),
        aliases: (aliasesResult.data || []).map((row) => row.alias),
      },
      composition: links.map((row) => ({
        ...row,
        component: componentsById.get(row.component_id) || null,
      })),
      registrations: registrationsResult.data || [],
      usageRules: rules.map((row) => ({
        ...row,
        crop: cropsById.get(row.crop_id) || null,
        target:
          (row.disease_id && diseasesById.get(row.disease_id))
          || (row.pest_id && pestsById.get(row.pest_id))
          || (row.weed_id && weedsById.get(row.weed_id))
          || (row.target_text ? { name_ru: row.target_text, name_en: null } : null),
      })),
      sources: sourcesResult.data || [],
      safety: safetyResult.data || null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
