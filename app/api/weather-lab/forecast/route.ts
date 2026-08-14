import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError } from "@/lib/auth/server-session";
import { getWeatherForLocation } from "@/lib/weather/service";
import type { WeatherLocation } from "@/lib/weather/types";
import { WeatherProviderError } from "@/lib/weather/types";
import { requireWeatherLabAdmin } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function finiteCoordinate(value: string | null, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function cleanLabel(value: string | null, maxLength = 160): string | null {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export async function GET(request: NextRequest) {
  try {
    await requireWeatherLabAdmin(request);
    const params = request.nextUrl.searchParams;
    const latitude = finiteCoordinate(params.get("lat"), -90, 90);
    const longitude = finiteCoordinate(params.get("lon"), -180, 180);
    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: "Некорректные координаты населённого пункта" }, { status: 400 });
    }
    const location: WeatherLocation = {
      latitude,
      longitude,
      region: cleanLabel(params.get("region")),
      district: cleanLabel(params.get("district")),
      locality: cleanLabel(params.get("locality")),
      displayName: cleanLabel(params.get("displayName"), 240) || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      katoCode: cleanLabel(params.get("katoCode"), 20),
    };
    const weather = await getWeatherForLocation({
      location,
      forceRefresh: params.get("refresh") === "1",
    });
    return NextResponse.json({ weather }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof WeatherProviderError) {
      return NextResponse.json(
        { error: error.message, code: error.code, technicalDetails: error.technicalDetails || null },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ error: "Не удалось получить прогноз" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
