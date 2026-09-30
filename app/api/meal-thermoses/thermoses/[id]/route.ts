import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_ADMIN_WRITE_ROLES,
  THERMOS_STATUS_VALUES,
  asMealThermosError,
  cleanString,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";

const THERMOS_STATUS_SET = new Set<string>(THERMOS_STATUS_VALUES);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const thermosId = String(id || "").trim();
    if (!thermosId) {
      return NextResponse.json({ error: "Thermos id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = cleanString(body?.companyId || body?.company_id);
    const { actor, companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_ADMIN_WRITE_ROLES,
      requestedCompanyId,
    });

    const { data: existing, error: existingError } = await supabase
      .from("thermoses")
      .select("*")
      .eq("id", thermosId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError || !existing?.id) {
      return NextResponse.json({ error: existingError?.message || "Thermos not found" }, { status: 404 });
    }

    const nextStatusRaw = cleanString(body?.status);
    const nextStatus = nextStatusRaw ? nextStatusRaw.toLowerCase() : null;
    const nextLabel = cleanString(body?.label);
    const volumeRaw = cleanString(body?.volume_l || body?.volumeL);
    const volumeValue = volumeRaw ? Number(volumeRaw) : null;

    if (nextStatus && !THERMOS_STATUS_SET.has(nextStatus)) {
      return NextResponse.json({ error: "Invalid thermos status" }, { status: 400 });
    }
    if (volumeRaw && (!Number.isFinite(volumeValue) || (volumeValue as number) <= 0)) {
      return NextResponse.json({ error: "volume_l must be a positive number" }, { status: 400 });
    }

    const currentStatus = String(existing.status || "");
    const isBusy = currentStatus === "issued" || currentStatus === "assigned";
    if (isBusy && nextStatus && ["damaged", "lost", "inactive"].includes(nextStatus)) {
      return NextResponse.json(
        { error: "Issued/assigned thermos must be returned before status can be changed to damaged/lost/inactive" },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updated_at: nowIso,
    };

    if (nextStatus) patch.status = nextStatus;
    if (body?.label !== undefined) patch.label = nextLabel;
    if (body?.volume_l !== undefined || body?.volumeL !== undefined) patch.volume_l = volumeValue;

    if (nextStatus === "available" || nextStatus === "returned_dirty" || nextStatus === "cleaning") {
      patch.current_holder_name = null;
      patch.current_meal_order_id = null;
    }

    if (nextStatus === "available" || nextStatus === "returned_dirty") {
      patch.last_returned_at = nowIso;
    }

    const { data: updated, error: updateError } = await supabase
      .from("thermoses")
      .update(patch)
      .eq("id", thermosId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (updateError || !updated?.id) {
      return NextResponse.json({ error: updateError?.message || "Failed to update thermos" }, { status: 400 });
    }

    if (nextStatus && nextStatus !== currentStatus) {
      const eventType =
        nextStatus === "damaged"
          ? "damaged"
          : nextStatus === "lost"
            ? "lost"
            : nextStatus === "inactive"
              ? "deactivated"
              : nextStatus === "cleaning"
                ? "cleaned"
                : null;
      if (eventType) {
        const { error: eventError } = await supabase.from("thermos_events").insert({
          company_id: companyId,
          thermos_id: thermosId,
          meal_order_id: existing.current_meal_order_id || null,
          meal_order_person_id: null,
          event_type: eventType,
          actor_user_id: actor.id,
          holder_name: existing.current_holder_name || null,
          comment: cleanString(body?.comment),
          created_at: nowIso,
        });
        if (eventError) {
          return NextResponse.json({ error: eventError.message }, { status: 400 });
        }
      }
    }

    return NextResponse.json({ thermos: updated });
  } catch (error) {
    const sessionError = asMealThermosError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

