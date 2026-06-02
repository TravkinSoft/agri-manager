import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_READ_ROLES,
  asMealThermosError,
  cleanString,
  isKitchenRole,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";

const KITCHEN_ALLOWED_TARGETS = new Set(["accepted", "cooking", "ready", "cancelled"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const orderId = String(id || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "Order id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const nextStatus = String(body?.status || body?.action || "").trim().toLowerCase();
    if (!nextStatus) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }

    const requestedCompanyId = cleanString(body?.companyId || body?.company_id);
    const { actor, companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_READ_ROLES,
      requestedCompanyId,
    });

    const { data: existing, error: existingError } = await supabase
      .from("meal_orders")
      .select("*")
      .eq("id", orderId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError || !existing?.id) {
      return NextResponse.json({ error: existingError?.message || "Meal order not found" }, { status: 404 });
    }

    const isBrigadierOwner = actor.role === "brigadier" && String(existing.requested_by_user_id || "") === actor.id;
    const kitchenAccess = isKitchenRole(actor.role);

    if (actor.role === "brigadier" && !isBrigadierOwner) {
      return NextResponse.json({ error: "Brigadier can update only own meal orders" }, { status: 403 });
    }

    if (!kitchenAccess && !isBrigadierOwner && actor.role !== "global_admin" && actor.role !== "company_admin") {
      return NextResponse.json({ error: "Role is not allowed to update meal order status" }, { status: 403 });
    }

    if (actor.role === "brigadier" && nextStatus !== "cancelled") {
      return NextResponse.json({ error: "Brigadier can only cancel own meal orders" }, { status: 403 });
    }

    if (!kitchenAccess && actor.role !== "global_admin" && actor.role !== "company_admin" && nextStatus !== "cancelled") {
      return NextResponse.json({ error: "Only kitchen/admin can move order in workflow" }, { status: 403 });
    }

    if (
      (kitchenAccess || actor.role === "global_admin" || actor.role === "company_admin") &&
      !KITCHEN_ALLOWED_TARGETS.has(nextStatus)
    ) {
      return NextResponse.json({ error: "Unsupported status transition" }, { status: 400 });
    }

    if (["issued", "partially_returned", "returned"].includes(String(existing.status || ""))) {
      return NextResponse.json({ error: "Order is already issued/closed and cannot be moved manually" }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: nextStatus,
      updated_at: nowIso,
    };

    if (nextStatus === "accepted" && !existing.accepted_at) patch.accepted_at = nowIso;
    if (nextStatus === "cancelled" && !existing.cancelled_at) patch.cancelled_at = nowIso;

    const { data: updated, error: updateError } = await supabase
      .from("meal_orders")
      .update(patch)
      .eq("id", orderId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (updateError || !updated?.id) {
      return NextResponse.json({ error: updateError?.message || "Failed to update meal order status" }, { status: 400 });
    }

    return NextResponse.json({ order: updated });
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

