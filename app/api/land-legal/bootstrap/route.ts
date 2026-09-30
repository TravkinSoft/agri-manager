import { NextRequest, NextResponse } from "next/server";
import { isUuidLike } from "@/lib/land-legal/normalizers";
import { getBreakdownRowsForCompany } from "@/lib/land-legal/breakdown";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

function parseSeasonId(value: string | null): string | null {
  const raw = String(value || "").trim();
  return isUuidLike(raw) ? raw : null;
}

export async function GET(request: NextRequest) {
  try {
    const seasonId = parseSeasonId(request.nextUrl.searchParams.get("seasonId"));
    const context = await resolveLandLegalContext(request, { write: false });
    const { companyId, supabase } = context;

    const companyRes = await supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle();
    if (companyRes.error || !companyRes.data) {
      return NextResponse.json({ error: companyRes.error?.message || "Company not found" }, { status: 400 });
    }

    const [seasonsRes, mismatchesRes, sowingRes, docsRes, breakdown] = await Promise.all([
      supabase.from("seasons").select("id, year, name").eq("company_id", companyId).order("year", { ascending: false }),
      (() => {
        let query = supabase.from("v_land_area_mismatches").select("*").eq("company_id", companyId).order("field_name");
        if (seasonId) query = query.eq("season_id", seasonId);
        return query;
      })(),
      (() => {
        let query = supabase
          .from("v_land_sowing_by_cadastre")
          .select("*")
          .eq("company_id", companyId)
          .order("cadastral_number")
          .order("field_name");
        if (seasonId) query = query.eq("season_id", seasonId);
        return query;
      })(),
      supabase.from("land_documents").select("id, status, valid_to").eq("company_id", companyId).eq("archived", false),
      getBreakdownRowsForCompany({ supabase, companyId, seasonId }),
    ]);

    const errors = [seasonsRes.error, mismatchesRes.error, sowingRes.error, docsRes.error].filter(Boolean);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0]?.message || "Failed to load land legal bootstrap" }, { status: 400 });
    }

    const displayFieldById = new Map<string, string>(breakdown.fields.map((field) => [String(field.id), String(field.name)]));
    const mismatches = (mismatchesRes.data || []).map((row: any) => ({
      ...row,
      field_name: displayFieldById.get(String(row.field_id || "")) || row.field_name,
    }));
    const sowingRows = (sowingRes.data || []).map((row: any) => ({
      ...row,
      field_name: displayFieldById.get(String(row.field_id || "")) || row.field_name,
    }));

    const documents = docsRes.data || [];
    const canonicalRows = breakdown.canonicalRows;
    const canonicalLegalRows = breakdown.canonicalLegalRows || canonicalRows;
    const gapRows = breakdown.gapRows || [];
    const distinctCadastreIds = new Set(
      canonicalLegalRows
        .map((row) => row.cadastral_parcel_id)
        .filter((value): value is string => Boolean(value)),
    );

    const rowsWithDistrict = canonicalLegalRows.filter((row) => Boolean(String(row.rural_district || "").trim())).length;
    const rowsMissingDistrict = canonicalLegalRows.length - rowsWithDistrict;
    const distinctDistricts = new Set(
      canonicalLegalRows
        .map((row) => String(row.rural_district || "").trim())
        .filter((value) => value.length > 0),
    ).size;

    const cadastresWithDistrict = (breakdown.cadastresRaw || []).filter(
      (row: any) => String(row.rural_district || "").trim().length > 0,
    ).length;
    const cadastresMissingDistrict = (breakdown.cadastresRaw || []).length - cadastresWithDistrict;

    const now = new Date();
    const expiringThreshold = new Date(now);
    expiringThreshold.setDate(expiringThreshold.getDate() + 45);

    const summary = {
      cadastral_count: (breakdown.cadastresRaw || []).length,
      legal_total_area_ha: canonicalLegalRows.reduce((sum, row) => sum + Number(row.area_ha || 0), 0),
      legal_coverage_area_ha: canonicalLegalRows.reduce((sum, row) => sum + Number(row.area_ha || 0), 0),
      gap_total_area_ha: gapRows.reduce((sum, row) => sum + Number(row.area_ha || 0), 0),
      unique_cadastral_area_ha: (breakdown.cadastresRaw || []).reduce(
        (sum: number, row: any) => sum + Number(row.declared_area_ha || 0),
        0,
      ),
      agro_total_area_ha: breakdown.fields.reduce((sum, row) => sum + Number(row.area || 0), 0),
      mismatch_total_ha: mismatches.reduce((sum: number, row: any) => sum + Math.abs(Number(row.diff_area_ha || 0)), 0),
      active_documents: documents.filter((doc: any) => String(doc.status) === "active").length,
      expiring_documents: documents.filter((doc: any) => {
        if (!doc.valid_to || String(doc.status) !== "active") return false;
        const validTo = new Date(doc.valid_to);
        return validTo >= now && validTo <= expiringThreshold;
      }).length,
    };

    return NextResponse.json({
      company: companyRes.data,
      seasons: seasonsRes.data || [],
      fields: breakdown.fields,
      crops: breakdown.crops,
      legalEntities: breakdown.legalEntitiesRaw || [],
      cadastres: breakdown.cadastresRaw || [],
      links: breakdown.linksRaw || [],
      mismatches,
      sowingRows,
      ownerAllocations: breakdown.ownerAllocationsRaw || [],
      cropStructureRows: breakdown.cropStructureRowsRaw || [],
      breakdownRows: canonicalRows,
      canonicalLegalRows,
      gapRows,
      summary,
      diagnostics: {
        field_count: breakdown.fields.length,
        cadastral_count: distinctCadastreIds.size,
        links_total: (breakdown.linksRaw || []).length,
        owner_allocations_total: (breakdown.ownerAllocationsRaw || []).length,
        stem_links: breakdown.sourceStats.stem_links,
        karagash_links: breakdown.sourceStats.karagash_links,
        owner_sheet_links: breakdown.sourceStats.owner_sheet_links,
        other_links: breakdown.sourceStats.other_links,
        owner_sheet_rows: breakdown.ownerSourceStats.owner_sheet_rows,
        partial_owner_rows: breakdown.ownerSourceStats.partial_rows,
        legal_breakdown_rows_total: canonicalRows.length,
        legal_breakdown_rows_canonical: canonicalLegalRows.length,
        legal_breakdown_rows_gaps: gapRows.length,
        owner_overlay_rows:
          canonicalLegalRows.filter((row) => row.row_source === "owner_allocation_overlay").length,
        legal_breakdown_rows_with_rural_district: rowsWithDistrict,
        legal_breakdown_rows_missing_rural_district: rowsMissingDistrict,
        legal_breakdown_distinct_rural_districts: distinctDistricts,
        cadastral_parcels_with_rural_district: cadastresWithDistrict,
        cadastral_parcels_missing_rural_district: cadastresMissingDistrict,
      },
    });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}
