import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
} from "@/lib/auth/server-session";
import { isCountryCode } from "@/lib/counterparties/catalog";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") throw new SessionAuthError("Global admin role is required", 403);
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (body.legalName !== undefined) {
      const value = String(body.legalName || "").trim();
      if (!value) return NextResponse.json({ error: "Юридическое название обязательно" }, { status: 400 });
      patch.legal_name = value;
    }
    if (body.taxId !== undefined) {
      const value = String(body.taxId || "").trim();
      if (!/^\d+$/.test(value)) return NextResponse.json({ error: "БИН/ИНН должен содержать только цифры" }, { status: 400 });
      patch.tax_id = value;
    }
    if (body.countryCode !== undefined) {
      const value = String(body.countryCode || "").trim().toUpperCase();
      if (!isCountryCode(value)) return NextResponse.json({ error: "Недопустимая страна" }, { status: 400 });
      patch.country_code = value;
    }
    if (body.archived !== undefined) {
      patch.archived = body.archived === true;
      patch.is_active = body.archived !== true;
    }
    if (body.isActive !== undefined) patch.is_active = body.isActive === true;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
    }
    const supabase = await getUserScopedClientFromRequest(request);
    const { data, error } = await supabase
      .from("global_counterparties")
      .update(patch)
      .eq("id", String(params.id || ""))
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "Не удалось обновить контрагента");
    return NextResponse.json({ counterparty: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
