import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_READ_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { localizedName } from "@/lib/i18n/helpers";

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const [cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
      supabase
        .from("crops")
        .select("id,name,name_ru,name_kz,name_en,slug,company_id,is_active,archived")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("varieties")
        .select("id,name,name_ru,name_kz,name_en,crop_id,company_id,is_active,archived")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("seed_reproductions")
        .select("id,name,name_ru,name_kz,name_en,code,company_id,is_active,archived,level_order")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .eq("archived", false)
        .order("level_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    if (cropsRes.error || varietiesRes.error || reproductionsRes.error) {
      return NextResponse.json(
        { error: cropsRes.error?.message || varietiesRes.error?.message || reproductionsRes.error?.message || "Failed to load identity refs" },
        { status: 400 }
      );
    }

    const canonicalReproductionNames = new Set([
      "Суперсуперэлита",
      "Суперэлита",
      "Элита",
      "1 репродукция",
      "2 репродукция",
      "3 репродукция",
      "Первая репродукция",
      "Вторая репродукция",
      "Третья репродукция",
      "Четвёртая репродукция",
    ]);
    const reproductionMap = new Map<string, any>();
    for (const row of reproductionsRes.data || []) {
      const name = localizedName(row as any, "ru", ["name", "code"]);
      if (!canonicalReproductionNames.has(name)) continue;
      if (!reproductionMap.has(name) || (reproductionMap.get(name).company_id != null && (row as any).company_id == null)) {
        reproductionMap.set(name, row);
      }
    }
    const reproductions = Array.from(reproductionMap.values());

    return NextResponse.json({
      crops: cropsRes.data || [],
      varieties: varietiesRes.data || [],
      reproductions,
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
