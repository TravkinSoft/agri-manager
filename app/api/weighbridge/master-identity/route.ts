import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  try {
    const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
    const actorUserId = String(request.nextUrl.searchParams.get("userId") || "").trim();
    if (!companyId || !actorUserId) {
      return NextResponse.json({ error: "companyId and userId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId,
      companyId,
      allowedRoles: ["admin", "company_admin", "global_admin", "warehouse", "weighman", "agronomist"],
    });

    const [cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
      supabase
        .from("crops")
        .select("id,name,name_ru,name_kz,name_en,company_id,is_active,archived")
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
        .select("id,name,name_ru,name_kz,name_en,company_id,is_active,archived,level_order")
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
      "Первая репродукция",
      "Вторая репродукция",
      "Третья репродукция",
      "Четвёртая репродукция",
    ]);
    const reproductionMap = new Map<string, any>();
    for (const row of reproductionsRes.data || []) {
      const name = String((row as any).name_ru || (row as any).name || "").trim();
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
