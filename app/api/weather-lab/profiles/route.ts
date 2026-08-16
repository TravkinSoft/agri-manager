import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getUserScopedClientFromRequest } from "@/lib/auth/server-session";
import { weatherProfileFromRow, weatherProfileInputSchema, weatherProfileToRow, type WeatherProfileRow } from "@/lib/weather/profile";
import { requireWeatherLabAccess, requireWeatherProfileWriteAccess } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function companyIdForActor(actor: Awaited<ReturnType<typeof requireWeatherLabAccess>>): string | null {
  return actor.contextCompanyId || actor.companyId || actor.homeCompanyId;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireWeatherLabAccess(request);
    const companyId = companyIdForActor(actor);
    if (!companyId) return NextResponse.json({ error: "Выберите компанию" }, { status: 409 });
    const client = await getUserScopedClientFromRequest(request);
    const { data, error } = await client
      .from("weather_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", actor.authUserId)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ profiles: (data as WeatherProfileRow[]).map(weatherProfileFromRow) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Не удалось загрузить погодные профили" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireWeatherLabAccess(request);
    requireWeatherProfileWriteAccess(actor);
    const companyId = companyIdForActor(actor);
    if (!companyId) return NextResponse.json({ error: "Выберите компанию" }, { status: 409 });
    const parsed = weatherProfileInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Проверьте профиль" }, { status: 400 });
    const client = await getUserScopedClientFromRequest(request);
    const countResult = await client.from("weather_profiles").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("user_id", actor.authUserId);
    if (countResult.error) throw countResult.error;
    if ((countResult.count || 0) >= 20) return NextResponse.json({ error: "Можно сохранить не более 20 профилей" }, { status: 409 });
    const isDefault = parsed.data.isDefault || (countResult.count || 0) === 0;
    if (isDefault) {
      const unset = await client.from("weather_profiles").update({ is_default: false }).eq("company_id", companyId).eq("user_id", actor.authUserId).eq("is_default", true);
      if (unset.error) throw unset.error;
    }
    const { data, error } = await client.from("weather_profiles").insert({
      ...weatherProfileToRow({ ...parsed.data, isDefault }),
      company_id: companyId,
      user_id: actor.authUserId,
    }).select("*").single();
    if (error) throw error;
    return NextResponse.json({ profile: weatherProfileFromRow(data as WeatherProfileRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = String((error as { message?: string })?.message || "");
    if (message.includes("weather_profiles_user_name_unique_v1")) return NextResponse.json({ error: "Профиль с таким названием уже существует" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось сохранить погодный профиль" }, { status: 500 });
  }
}
