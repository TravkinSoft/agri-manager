import { NextRequest, NextResponse } from "next/server";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { write: false });
    const { companyId, supabase } = context;

    const importsRes = await supabase
      .from("field_map_imports")
      .select("id,company_id,source_file_name,status,total_polygons,matched_polygons,unmatched_polygons,error_count,imported_at,imported_by,is_active,created_at,updated_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (importsRes.error) {
      return NextResponse.json({ error: importsRes.error.message }, { status: 400 });
    }

    const rows = importsRes.data || [];
    const profileIds = Array.from(new Set(rows.map((row: any) => String(row.imported_by || "")).filter(Boolean)));
    const namesByProfileId = new Map<string, string>();

    if (profileIds.length > 0) {
      const profilesRes = await supabase
        .from("profiles")
        .select("id,full_name,email")
        .in("id", profileIds);
      if (!profilesRes.error) {
        (profilesRes.data || []).forEach((item: any) => {
          const label = String(item.full_name || item.email || "").trim();
          if (label) namesByProfileId.set(String(item.id), label);
        });
      }
    }

    return NextResponse.json({
      imports: rows.map((row: any) => ({
        id: String(row.id),
        company_id: String(row.company_id),
        source_file_name: String(row.source_file_name || ""),
        status: String(row.status || "draft"),
        total_polygons: Number(row.total_polygons || 0),
        matched_polygons: Number(row.matched_polygons || 0),
        unmatched_polygons: Number(row.unmatched_polygons || 0),
        error_count: Number(row.error_count || 0),
        imported_at: row.imported_at ? String(row.imported_at) : null,
        imported_by: row.imported_by ? String(row.imported_by) : null,
        imported_by_name: row.imported_by ? namesByProfileId.get(String(row.imported_by)) || null : null,
        is_active: Boolean(row.is_active),
        created_at: String(row.created_at || ""),
        updated_at: String(row.updated_at || ""),
      })),
    });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
