import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import {
  getServerActorFromSession,
  SessionAuthError,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { buildHumanPesticideCard } from "@/lib/glbd/human-pesticide-card";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function referenceLabel(name: string | null | undefined, code: string | null | undefined): string | null {
  const cleanName = String(name || "").trim();
  const cleanCode = String(code || "").trim();
  if (!cleanName) return cleanCode || null;
  if (!cleanCode || cleanName.toLocaleLowerCase("ru-RU").includes(cleanCode.toLocaleLowerCase("ru-RU"))) {
    return cleanName;
  }
  return `${cleanName} (${cleanCode})`;
}

function apiError(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Не удалось загрузить карточку препарата";
  return NextResponse.json({ error: message }, { status: 500 });
}

const getCachedPesticideCard = unstable_cache(
  async (productId: string) => {
    const supabase = getServiceClient();
    const [
      productResult,
      aliasesResult,
      linksResult,
      rulesResult,
      safetyResult,
      componentsResult,
      cropsResult,
      diseasesResult,
      pestsResult,
      weedsResult,
      manufacturersResult,
      formulationsResult,
      modesResult,
    ] = await Promise.all([
      supabase
        .from("products")
        .select("id,trade_name,name,name_ru,name_en,description,manufacturer,manufacturer_id,formulation,formulation_id,pesticide_category,category,subcategory,mode_of_action_type,mode_of_action_type_id,is_active,archived")
        .eq("id", productId)
        .is("company_id", null)
        .eq("type", "pesticide")
        .maybeSingle(),
      supabase.from("global_product_aliases").select("alias").eq("product_id", productId).order("alias"),
      supabase
        .from("glbd_product_components")
        .select("id,component_id,role_in_product,concentration_value,concentration_unit,concentration_text,is_primary_active,sort_order,review_status")
        .eq("product_id", productId)
        .in("review_status", ["approved", "needs_owner_review"])
        .order("sort_order"),
      supabase
        .from("glbd_product_usage_rules")
        .select("id,rule_key,crop_id,variety_id,target_type,disease_id,pest_id,weed_id,target_text,rate_min,rate_max,rate_unit,working_fluid_min,working_fluid_max,working_fluid_unit,application_method,crop_stage,target_stage,timing_condition,max_treatments,harvest_interval_days,restrictions,notes,crop_name_raw,crop_group_raw,crop_name_original,target_names_raw,target_text_original,original_rate_value_text,original_rate_unit_text,original_rate_text,application_timing,restrictions_raw,usage_summary,source_text_raw,original_source_text")
        .eq("product_id", productId)
        .order("rule_key"),
      supabase.from("glbd_product_assistant_safety").select("read_allowed,recommendation_allowed,missing_critical_fields").eq("product_id", productId).maybeSingle(),
      supabase.from("glbd_components").select("id,name_ru,name_en,component_type").eq("is_active", true).is("archived_at", null),
      supabase.from("crops").select("id,name_ru,name_en"),
      supabase.from("diseases").select("id,name_ru,name_en"),
      supabase.from("pests").select("id,name_ru,name_en"),
      supabase.from("weeds").select("id,name_ru,name_en"),
      supabase.from("agrochem_manufacturers").select("id,name").eq("archived", false),
      supabase.from("agrochem_formulations").select("id,code,name_ru").eq("archived", false),
      supabase.from("agrochem_mode_of_actions").select("id,slug,name_ru").eq("archived", false),
    ]);

    const firstError = [productResult, aliasesResult, linksResult, rulesResult, safetyResult, componentsResult,
      cropsResult, diseasesResult, pestsResult, weedsResult, manufacturersResult, formulationsResult, modesResult]
      .map((result) => result.error)
      .find(Boolean);
    if (firstError) throw new Error(firstError.message);

    const product = productResult.data;
    if (!product) return null;
    const links = linksResult.data || [];
    const rules = rulesResult.data || [];
    const byId = (rows: any[]) => new Map(rows.map((row) => [row.id, row]));
    const componentsById = byId(componentsResult.data || []);
    const cropsById = byId(cropsResult.data || []);
    const diseasesById = byId(diseasesResult.data || []);
    const pestsById = byId(pestsResult.data || []);
    const weedsById = byId(weedsResult.data || []);
    const manufacturer = byId(manufacturersResult.data || []).get(product.manufacturer_id);
    const formulation = byId(formulationsResult.data || []).get(product.formulation_id);
    const modeOfAction = byId(modesResult.data || []).get(product.mode_of_action_type_id);

    return buildHumanPesticideCard({
      product,
      aliases: (aliasesResult.data || []).map((row) => row.alias),
      composition: links.map((row) => ({ ...row, component: componentsById.get(row.component_id) || null })),
      usageRules: rules.map((row) => ({
        ...row,
        crop: cropsById.get(row.crop_id) || null,
        target: (row.disease_id && diseasesById.get(row.disease_id))
          || (row.pest_id && pestsById.get(row.pest_id))
          || (row.weed_id && weedsById.get(row.weed_id))
          || null,
      })),
      manufacturerName: manufacturer?.name || null,
      formulationName: formulation ? referenceLabel(formulation.name_ru, formulation.code) : null,
      modeOfActionName: modeOfAction?.name_ru || null,
      safety: safetyResult.data || null,
    });
  },
  ["global-admin-pesticide-card-v1"],
  { revalidate: 300, tags: ["global-pesticide-catalog-v1"] },
);

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") {
      throw new SessionAuthError("Доступ только для глобального администратора", 403);
    }

    const productId = String(params.id || "").trim();
    if (!UUID_RE.test(productId)) {
      return NextResponse.json({ error: "Некорректный идентификатор препарата" }, { status: 400 });
    }

    const card = await getCachedPesticideCard(productId);
    if (!card) return NextResponse.json({ error: "Глобальная карточка препарата не найдена" }, { status: 404 });
    return NextResponse.json(card, {
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return apiError(error);
  }
}
