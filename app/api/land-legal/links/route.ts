import { NextRequest, NextResponse } from "next/server";
import {
  FIELD_LINK_ALLOCATION_METHODS,
  FIELD_LINK_SOURCES,
  FIELD_LINK_STATUSES,
} from "@/lib/land-legal/constants";
import { isUuidLike, normalizeText, parsePositiveNumber } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

const ALLOCATION_METHODS = new Set<string>(FIELD_LINK_ALLOCATION_METHODS);
const SOURCES = new Set<string>(FIELD_LINK_SOURCES);
const STATUSES = new Set<string>(FIELD_LINK_STATUSES);

export async function GET(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: false });
    const { companyId, supabase } = context;

    const seasonId = normalizeText(request.nextUrl.searchParams.get("seasonId"));
    const fieldId = normalizeText(request.nextUrl.searchParams.get("fieldId"));
    const cadastralParcelId = normalizeText(request.nextUrl.searchParams.get("cadastralParcelId"));
    const cropId = normalizeText(request.nextUrl.searchParams.get("cropId"));
    const status = normalizeText(request.nextUrl.searchParams.get("status"));

    let query = supabase
      .from("field_cadastre_links")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (seasonId && isUuidLike(seasonId)) query = query.eq("season_id", seasonId);
    if (fieldId && isUuidLike(fieldId)) query = query.eq("field_id", fieldId);
    if (cadastralParcelId && isUuidLike(cadastralParcelId)) query = query.eq("cadastral_parcel_id", cadastralParcelId);
    if (cropId && isUuidLike(cropId)) query = query.eq("crop_id", cropId);
    if (status && STATUSES.has(status)) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ links: data || [] });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: true });
    const { companyId, supabase } = context;
    const body = await request.json();

    const fieldId = normalizeText(body.field_id);
    const cadastralParcelId = normalizeText(body.cadastral_parcel_id);
    const area = parsePositiveNumber(body.area_ha);

    if (!isUuidLike(fieldId) || !isUuidLike(cadastralParcelId) || !area) {
      return NextResponse.json(
        { error: "field_id, cadastral_parcel_id и area_ha (>0) обязательны" },
        { status: 400 }
      );
    }

    const allocationMethod = normalizeText(body.allocation_method || "manual_adjusted");
    const source = normalizeText(body.source || "manual");
    const status = normalizeText(body.status || "active");
    if (!ALLOCATION_METHODS.has(allocationMethod)) {
      return NextResponse.json({ error: "Некорректный allocation_method" }, { status: 400 });
    }
    if (!SOURCES.has(source)) {
      return NextResponse.json({ error: "Некорректный source" }, { status: 400 });
    }
    if (!STATUSES.has(status)) {
      return NextResponse.json({ error: "Некорректный status" }, { status: 400 });
    }

    const payload = {
      company_id: companyId,
      season_id: isUuidLike(body.season_id) ? body.season_id : null,
      field_id: fieldId,
      cadastral_parcel_id: cadastralParcelId,
      crop_plan_allocation_id: isUuidLike(body.crop_plan_allocation_id) ? body.crop_plan_allocation_id : null,
      crop_id: isUuidLike(body.crop_id) ? body.crop_id : null,
      variety_id: isUuidLike(body.variety_id) ? body.variety_id : null,
      reproduction_id: isUuidLike(body.reproduction_id) ? body.reproduction_id : null,
      area_ha: area,
      legal_entity_id: isUuidLike(body.legal_entity_id) ? body.legal_entity_id : null,
      owner_legal_entity_id: isUuidLike(body.owner_legal_entity_id) ? body.owner_legal_entity_id : null,
      usage_legal_entity_id: isUuidLike(body.usage_legal_entity_id) ? body.usage_legal_entity_id : null,
      allocation_method: allocationMethod,
      source,
      confidence:
        body.confidence == null || body.confidence === ""
          ? null
          : Math.max(0, Math.min(100, Number(body.confidence || 0))),
      status,
      valid_from: normalizeText(body.valid_from) || null,
      valid_to: normalizeText(body.valid_to) || null,
      notes: normalizeText(body.notes) || null,
    };

    const { data, error } = await supabase.from("field_cadastre_links").insert(payload).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ link: data });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

