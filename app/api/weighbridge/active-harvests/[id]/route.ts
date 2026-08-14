import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { loadActiveHarvestRouteList } from "../_data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const action = String(body.action || "");
    if (action !== "complete" && action !== "restore" && action !== "change_context") {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    const context = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId,
    });
    if (context.actor.role === "weighman") {
      await requireWeighbridgeOperatorSession(request, context);
    }

    if (action === "change_context") {
      const cropStructureId = String(body.cropStructureId || "").trim();
      const fieldId = String(body.fieldId || "").trim();
      const warehouseId = String(body.warehouseId || "").trim();
      if (![params.id, cropStructureId, fieldId, warehouseId].every((value) => UUID_RE.test(value))) {
        return NextResponse.json({ error: "Выберите корректные участок и место приёмки" }, { status: 400 });
      }

      const { data: updated, error: updateError } = await context.supabase
        .from("weighbridge_active_harvests")
        .update({
          crop_structure_id: cropStructureId,
          field_id: fieldId,
          warehouse_id: warehouseId,
        })
        .eq("id", params.id)
        .eq("company_id", context.companyId)
        .eq("status", "active")
        .select("id,updated_at")
        .maybeSingle();
      if (updateError) {
        if (updateError.code === "23505") {
          return NextResponse.json({ error: "Такая активная приёмка уже открыта в другой вкладке" }, { status: 409 });
        }
        if (updateError.code === "23514") {
          return NextResponse.json({ error: "Участок активного сезона или место приёмки недоступны" }, { status: 400 });
        }
        throw new Error(updateError.message);
      }
      if (!updated?.id) return NextResponse.json({ error: "Активная уборка не найдена" }, { status: 404 });
      return NextResponse.json({ routeId: String(updated.id), updatedAt: String(updated.updated_at || "") });
    }

    const { data: current, error: currentError } = await context.supabase
      .from("weighbridge_active_harvests")
      .select("id,season_id,status,crop_structure_id,warehouse_id")
      .eq("id", params.id)
      .eq("company_id", context.companyId)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current?.id) return NextResponse.json({ error: "Активная уборка не найдена" }, { status: 404 });

    if (action === "restore") {
      const { count, error: countError } = await context.supabase
        .from("weighbridge_active_harvests")
        .select("id", { count: "exact", head: true })
        .eq("company_id", context.companyId)
        .eq("season_id", current.season_id)
        .eq("status", "active");
      if (countError) throw new Error(countError.message);
      if (Number(count || 0) >= 4) {
        return NextResponse.json({ error: "Максимум 4 активные приёмки" }, { status: 409 });
      }
    }

    const nextStatus = action === "complete" ? "completed" : "active";
    if (current.status !== nextStatus) {
      const { error } = await context.supabase
        .from("weighbridge_active_harvests")
        .update(action === "complete"
          ? { status: "completed", closed_at: new Date().toISOString(), closed_by: context.actor.id }
          : { status: "active", closed_at: null, closed_by: null })
        .eq("id", current.id)
        .eq("company_id", context.companyId);
      if (error) {
        if (error.code === "23514" && error.message.includes("Maximum 4 active harvest workspaces")) {
          return NextResponse.json({ error: "Максимум 4 активные приёмки" }, { status: 409 });
        }
        throw new Error(error.message);
      }
    }

    return NextResponse.json(await loadActiveHarvestRouteList(context.supabase, context.companyId));
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    return NextResponse.json(
      { error: sessionError?.error || (error instanceof Error ? error.message : "Не удалось изменить активную уборку") },
      { status: sessionError?.status || 500 }
    );
  }
}
