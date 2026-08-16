import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError } from "@/lib/auth/server-session";
import { resolveKatoLocation, reverseKazakhstanLocation } from "@/lib/weather/location-resolver";
import { WeatherProviderError } from "@/lib/weather/types";
import { requireWeatherLabAccess } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  let showTechnicalDetails = false;
  try {
    const actor = await requireWeatherLabAccess(request);
    showTechnicalDetails = actor.role === "global_admin";
    const params = request.nextUrl.searchParams;
    const latitude = numberParam(params.get("lat"));
    const longitude = numberParam(params.get("lon"));
    const katoCode = String(params.get("katoCode") || "").trim();
    const location = latitude != null && longitude != null
      ? await reverseKazakhstanLocation(latitude, longitude)
      : await resolveKatoLocation(katoCode);
    return NextResponse.json({ location }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof WeatherProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(showTechnicalDetails ? { technicalDetails: error.technicalDetails || null } : {}),
        },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ error: "Не удалось определить населённый пункт" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
