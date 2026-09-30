import { NextRequest, NextResponse } from "next/server";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";

function isUuidLike(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(value || "").trim());
}

function toSafeFileName(value: string): string {
  const base = String(value || "fields-map-import.kml").trim() || "fields-map-import.kml";
  const sanitized = base.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_");
  return sanitized.toLowerCase().endsWith(".kml") ? sanitized : `${sanitized}.kml`;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await resolveFieldsMapContext(request, { write: false });
    const { companyId, supabase } = context;
    const importId = String(params.id || "").trim();
    if (!isUuidLike(importId)) {
      return NextResponse.json({ error: "Некорректный import id" }, { status: 400 });
    }

    const importRes = await supabase
      .from("field_map_imports")
      .select("source_file_name,source_kml_text")
      .eq("company_id", companyId)
      .eq("id", importId)
      .maybeSingle();

    if (importRes.error || !importRes.data) {
      return NextResponse.json({ error: importRes.error?.message || "Импорт не найден" }, { status: 404 });
    }

    const kmlText = String(importRes.data.source_kml_text || "");
    if (!kmlText) {
      return NextResponse.json({ error: "В импорте отсутствует исходный KML" }, { status: 404 });
    }

    const fileName = toSafeFileName(String(importRes.data.source_file_name || "fields-map-import.kml"));
    return new NextResponse(kmlText, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.google-earth.kml+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
