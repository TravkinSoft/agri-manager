import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getUserScopedClientFromRequest } from "@/lib/auth/server-session";
import { weatherProfileFromRow, weatherProfileInputSchema, weatherProfileToRow, type WeatherProfileRow } from "@/lib/weather/profile";
import { requireWeatherLabAccess } from "../../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function companyIdForActor(actor: Awaited<ReturnType<typeof requireWeatherLabAccess>>): string | null {
  return actor.contextCompanyId || actor.companyId || actor.homeCompanyId;
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = await requireWeatherLabAccess(request);
    const companyId = companyIdForActor(actor);
    if (!companyId) return NextResponse.json({ error: "Выберите компанию" }, { status: 409 });
    const parsed = weatherProfileInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Проверьте профиль" }, { status: 400 });
    const client = await getUserScopedClientFromRequest(request);
    if (parsed.data.isDefault) {
      const unset = await client.from("weather_profiles").update({ is_default: false }).eq("company_id", companyId).eq("user_id", actor.authUserId).neq("id", context.params.id);
      if (unset.error) throw unset.error;
    }
    const { data, error } = await client.from("weather_profiles")
      .update(weatherProfileToRow(parsed.data))
      .eq("id", context.params.id)
      .eq("company_id", companyId)
      .eq("user_id", actor.authUserId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ profile: weatherProfileFromRow(data as WeatherProfileRow) });
  } catch (error) {
    if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = String((error as { message?: string })?.message || "");
    if (message.includes("weather_profiles_user_name_unique_v1")) return NextResponse.json({ error: "Профиль с таким названием уже существует" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось обновить погодный профиль" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = await requireWeatherLabAccess(request);
    const companyId = companyIdForActor(actor);
    if (!companyId) return NextResponse.json({ error: "Выберите компанию" }, { status: 409 });
    const client = await getUserScopedClientFromRequest(request);
    const existing = await client.from("weather_profiles").select("id,is_default").eq("id", context.params.id).eq("company_id", companyId).eq("user_id", actor.authUserId).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    const removed = await client.from("weather_profiles").delete().eq("id", context.params.id).eq("company_id", companyId).eq("user_id", actor.authUserId);
    if (removed.error) throw removed.error;
    if (existing.data.is_default) {
      const replacement = await client.from("weather_profiles").select("id").eq("company_id", companyId).eq("user_id", actor.authUserId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (replacement.error) throw replacement.error;
      if (replacement.data?.id) {
        const setDefault = await client.from("weather_profiles").update({ is_default: true }).eq("id", replacement.data.id).eq("user_id", actor.authUserId);
        if (setDefault.error) throw setDefault.error;
      }
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Не удалось удалить погодный профиль" }, { status: 500 });
  }
}
