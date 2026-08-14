import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError } from "@/lib/auth/server-session";
import {
  getKatoDistricts,
  getKatoLocalities,
  getKatoRegions,
  getKatoSource,
  searchKatoLocalities,
} from "@/lib/weather/kato-catalog";
import { requireWeatherLabAccess } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireWeatherLabAccess(request);
    const params = request.nextUrl.searchParams;
    const mode = params.get("mode") || "search";
    const parent = String(params.get("parent") || "").trim();
    let items;
    if (mode === "regions") items = getKatoRegions();
    else if (mode === "districts") items = getKatoDistricts(parent);
    else if (mode === "localities") items = getKatoLocalities(parent);
    else items = searchKatoLocalities(String(params.get("q") || ""));
    return NextResponse.json(
      { items, source: getKatoSource() },
      { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" } }
    );
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Не удалось прочитать справочник КАТО" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
