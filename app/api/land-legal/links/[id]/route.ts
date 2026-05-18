import { NextRequest, NextResponse } from "next/server";
import {
  FIELD_LINK_ALLOCATION_METHODS,
  FIELD_LINK_SOURCES,
  FIELD_LINK_STATUSES,
} from "@/lib/land-legal/constants";
import { isUuidLike, normalizeText, parsePositiveNumber } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

type RouteParams = { params: { id: string } };
const ALLOCATION_METHODS = new Set<string>(FIELD_LINK_ALLOCATION_METHODS);
const SOURCES = new Set<string>(FIELD_LINK_SOURCES);
const STATUSES = new Set<string>(FIELD_LINK_STATUSES);

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await resolveLandLegalContext(request, { write: true });
    const { companyId, supabase } = context;
    const id = String(params.id || "").trim();
    if (!isUuidLike(id)) return NextResponse.json({ error: "Некорректный id связи" }, { status: 400 });

    const body = await request.json();
    const patch: Record<string, any> = {};

    if (body.season_id !== undefined) patch.season_id = isUuidLike(body.season_id) ? body.season_id : null;
    if (body.field_id !== undefined) {
      if (body.field_id && !isUuidLike(body.field_id)) return NextResponse.json({ error: "Некорректный field_id" }, { status: 400 });
      patch.field_id = body.field_id || null;
    }
    if (body.cadastral_parcel_id !== undefined) {
      if (body.cadastral_parcel_id && !isUuidLike(body.cadastral_parcel_id)) {
        return NextResponse.json({ error: "Некорректный cadastral_parcel_id" }, { status: 400 });
      }
      patch.cadastral_parcel_id = body.cadastral_parcel_id || null;
    }
    if (body.crop_plan_allocation_id !== undefined) patch.crop_plan_allocation_id = isUuidLike(body.crop_plan_allocation_id) ? body.crop_plan_allocation_id : null;
    if (body.crop_id !== undefined) patch.crop_id = isUuidLike(body.crop_id) ? body.crop_id : null;
    if (body.variety_id !== undefined) patch.variety_id = isUuidLike(body.variety_id) ? body.variety_id : null;
    if (body.reproduction_id !== undefined) patch.reproduction_id = isUuidLike(body.reproduction_id) ? body.reproduction_id : null;
    if (body.area_ha !== undefined) {
      const area = parsePositiveNumber(body.area_ha);
      if (!area) return NextResponse.json({ error: "area_ha должен быть > 0" }, { status: 400 });
      patch.area_ha = area;
    }
    if (body.legal_entity_id !== undefined) patch.legal_entity_id = isUuidLike(body.legal_entity_id) ? body.legal_entity_id : null;
    if (body.owner_legal_entity_id !== undefined) patch.owner_legal_entity_id = isUuidLike(body.owner_legal_entity_id) ? body.owner_legal_entity_id : null;
    if (body.usage_legal_entity_id !== undefined) patch.usage_legal_entity_id = isUuidLike(body.usage_legal_entity_id) ? body.usage_legal_entity_id : null;
    if (body.allocation_method !== undefined) {
      const value = normalizeText(body.allocation_method);
      if (!ALLOCATION_METHODS.has(value)) return NextResponse.json({ error: "Некорректный allocation_method" }, { status: 400 });
      patch.allocation_method = value;
    }
    if (body.source !== undefined) {
      const value = normalizeText(body.source);
      if (!SOURCES.has(value)) return NextResponse.json({ error: "Некорректный source" }, { status: 400 });
      patch.source = value;
    }
    if (body.confidence !== undefined) {
      patch.confidence =
        body.confidence == null || body.confidence === ""
          ? null
          : Math.max(0, Math.min(100, Number(body.confidence || 0)));
    }
    if (body.status !== undefined) {
      const value = normalizeText(body.status);
      if (!STATUSES.has(value)) return NextResponse.json({ error: "Некорректный status" }, { status: 400 });
      patch.status = value;
    }
    if (body.valid_from !== undefined) patch.valid_from = normalizeText(body.valid_from) || null;
    if (body.valid_to !== undefined) patch.valid_to = normalizeText(body.valid_to) || null;
    if (body.notes !== undefined) patch.notes = normalizeText(body.notes) || null;

    const { data, error } = await supabase
      .from("field_cadastre_links")
      .update(patch)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ link: data });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

