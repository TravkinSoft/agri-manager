import { NextRequest, NextResponse } from "next/server";
import { isUuidLike, normalizeText, parsePositiveNumber } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

type RouteParams = { params: { id: string } };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await resolveLandLegalContext(request, { write: true });
    const { companyId, supabase } = context;
    const cadastreId = String(params.id || "").trim();
    if (!isUuidLike(cadastreId)) {
      return NextResponse.json({ error: "Некорректный id кадастра" }, { status: 400 });
    }

    const body = await request.json();
    const patch: Record<string, any> = {};

    if (body.cadastral_number !== undefined) patch.cadastral_number = normalizeText(body.cadastral_number);
    if (body.region !== undefined) patch.region = normalizeText(body.region) || null;
    if (body.district !== undefined) patch.district = normalizeText(body.district) || null;
    if (body.rural_district !== undefined) patch.rural_district = normalizeText(body.rural_district) || null;
    if (body.locality !== undefined) patch.locality = normalizeText(body.locality) || null;
    if (body.declared_area_ha !== undefined) {
      const area = parsePositiveNumber(body.declared_area_ha);
      if (!area) return NextResponse.json({ error: "declared_area_ha должен быть > 0" }, { status: 400 });
      patch.declared_area_ha = area;
    }
    if (body.land_category !== undefined) patch.land_category = normalizeText(body.land_category) || null;
    if (body.land_use_purpose !== undefined) patch.land_use_purpose = normalizeText(body.land_use_purpose) || null;
    if (body.ownership_status !== undefined) patch.ownership_status = normalizeText(body.ownership_status) || null;
    if (body.owner_legal_entity_id !== undefined) patch.owner_legal_entity_id = normalizeText(body.owner_legal_entity_id) || null;
    if (body.current_user_legal_entity_id !== undefined) patch.current_user_legal_entity_id = normalizeText(body.current_user_legal_entity_id) || null;
    if (body.notes !== undefined) patch.notes = normalizeText(body.notes) || null;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.archived !== undefined) patch.archived = Boolean(body.archived);

    const { data, error } = await supabase
      .from("cadastral_parcels")
      .update(patch)
      .eq("id", cadastreId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ cadastre: data });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

