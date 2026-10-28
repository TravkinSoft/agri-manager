import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, requireWeighbridgeOperatorSession, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, { allowedRoles: WEIGHBRIDGE_WRITE_ROLES });
    if (request.nextUrl.searchParams.get("preview") === "true") {
      const operatorSession = await requireWeighbridgeOperatorSession(request, { companyId, supabase });
      if (request.nextUrl.searchParams.get("shiftId") !== operatorSession.shift.id) {
        return NextResponse.json({ error: "Смена изменилась. Обновите страницу." }, { status: 409 });
      }
      const { data: report, error } = await getServiceClient().rpc("preview_weighbridge_shift_snapshot_v2", {
        p_company_id: companyId, p_shift_id: operatorSession.shift.id,
      });
      if (error) throw error;
      return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    const { data: shift, error } = await supabase.from("weighbridge_shifts").select("*")
      .eq("company_id", companyId).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ shift });
  } catch (error) {
    const session = asSessionErrorResponse(error);
    return NextResponse.json({ error: session?.error || (error instanceof Error ? error.message : "Не удалось загрузить смену") }, { status: session?.status || 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { companyId } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES, requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    return NextResponse.json({ error: "Для открытия смены выберите весовщика.", companyId }, { status: 409 });
  } catch (error) {
    const session = asSessionErrorResponse(error);
    return NextResponse.json({ error: session?.error || "Не удалось открыть смену" }, { status: session?.status || 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES, requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const operatorSession = await requireWeighbridgeOperatorSession(request, { companyId, supabase });
    // Close the verified session's shift, never a newer company shift.
    if (body.shiftId && body.shiftId !== operatorSession.shift.id) {
      return NextResponse.json({ error: "Смена изменилась. Обновите страницу." }, { status: 409 });
    }
    if (typeof body.reviewToken !== "string" || !/^[a-f0-9]{32}$/.test(body.reviewToken)) {
      return NextResponse.json({ error: "Обновите страницу и проверьте отчёт перед закрытием смены.", code: "SHIFT_PREVIEW_REQUIRED" }, { status: 409 });
    }
    const { data: shift, error } = await getServiceClient().rpc("close_weighbridge_shift_snapshot_v2", {
      p_company_id: companyId, p_shift_id: operatorSession.shift.id,
      p_actor_id: actor.id, p_operator_id: operatorSession.operator.id,
      p_review_token: body.reviewToken,
    });
    if (error?.message?.includes("SHIFT_PREVIEW_CHANGED")) {
      return NextResponse.json({ error: "Талоны изменились после проверки. Обновите итог и подтвердите снова.", code: "SHIFT_PREVIEW_CHANGED" }, { status: 409 });
    }
    if (error) return NextResponse.json({ error: error.code === "55P03" || error.code === "40P01"
      ? "Сейчас завершается операция по талону. Повторите закрытие смены." : error.message }, { status: 409 });
    return NextResponse.json({ shift });
  } catch (error) {
    const session = asSessionErrorResponse(error);
    return NextResponse.json({ error: session?.error || (error instanceof Error ? error.message : "Не удалось закрыть смену") }, { status: session?.status || 500 });
  }
}
