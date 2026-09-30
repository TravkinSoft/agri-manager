import { NextRequest, NextResponse } from "next/server";
import { FIELD_LINK_STATUSES } from "@/lib/land-legal/constants";
import { normalizeCadastreNumber, normalizeText, parsePositiveNumber } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

const OWNERSHIP_FALLBACK = "unknown";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: false });
    const { companyId, supabase } = context;
    const search = normalizeText(request.nextUrl.searchParams.get("search"));
    const seasonId = normalizeText(request.nextUrl.searchParams.get("seasonId"));

    let query = supabase
      .from("cadastral_parcels")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("cadastral_number");

    if (search) {
      query = query.or(`cadastral_number.ilike.%${search}%,region.ilike.%${search}%,district.ilike.%${search}%,rural_district.ilike.%${search}%,locality.ilike.%${search}%`);
    }

    const [{ data: cadastres, error }, { data: links }] = await Promise.all([
      query,
      (() => {
        let linksQuery = supabase
          .from("field_cadastre_links")
          .select("cadastral_parcel_id, field_id, area_ha, status, season_id")
          .eq("company_id", companyId)
          .in("status", [...FIELD_LINK_STATUSES]);
        if (seasonId) linksQuery = linksQuery.eq("season_id", seasonId);
        return linksQuery;
      })(),
    ]);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const linkMap = new Map<string, { fields: Set<string>; area: number }>();
    (links || []).forEach((row: any) => {
      if (String(row.status) === "archived") return;
      const key = String(row.cadastral_parcel_id || "");
      if (!key) return;
      const current = linkMap.get(key) || { fields: new Set<string>(), area: 0 };
      if (row.field_id) current.fields.add(String(row.field_id));
      current.area += Number(row.area_ha || 0);
      linkMap.set(key, current);
    });

    const payload = (cadastres || []).map((row: any) => {
      const stats = linkMap.get(String(row.id));
      return {
        ...row,
        linked_fields_count: stats?.fields.size || 0,
        linked_area_ha: stats?.area || 0,
      };
    });

    return NextResponse.json({ cadastres: payload });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await resolveLandLegalContext(request, { write: true });
    const { companyId, supabase } = context;

    const cadastralNumber = normalizeText(body.cadastral_number);
    const declaredArea = parsePositiveNumber(body.declared_area_ha);
    if (!cadastralNumber || !declaredArea) {
      return NextResponse.json(
        { error: "cadastral_number и declared_area_ha (> 0) обязательны" },
        { status: 400 }
      );
    }

    const payload = {
      company_id: companyId,
      cadastral_number: cadastralNumber,
      region: normalizeText(body.region) || null,
      district: normalizeText(body.district) || null,
      rural_district: normalizeText(body.rural_district) || null,
      locality: normalizeText(body.locality) || null,
      declared_area_ha: declaredArea,
      land_category: normalizeText(body.land_category) || null,
      land_use_purpose: normalizeText(body.land_use_purpose) || null,
      ownership_status: normalizeText(body.ownership_status) || OWNERSHIP_FALLBACK,
      owner_legal_entity_id: normalizeText(body.owner_legal_entity_id) || null,
      current_user_legal_entity_id: normalizeText(body.current_user_legal_entity_id) || null,
      notes: normalizeText(body.notes) || null,
      is_active: body.is_active !== false,
      archived: false,
    };

    const { data, error } = await supabase
      .from("cadastral_parcels")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      if (String(error.message || "").toLowerCase().includes("duplicate")) {
        return NextResponse.json(
          { error: `Кадастр ${normalizeCadastreNumber(cadastralNumber)} уже существует` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ cadastre: data });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

