import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const FUEL_ROLES = ["admin", "company_admin", "global_admin", "warehouse", "fuel_operator"] as const;
const FUEL_TYPES = new Set(["diesel", "gasoline", "adblue", "oil", "other"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const periodMonth = String(body.periodMonth || "").trim();
    const fuelType = String(body.fuelType || "").trim();
    const vehicleId = body.vehicleId ? String(body.vehicleId) : null;
    const mechanizatorId = body.mechanizatorId ? String(body.mechanizatorId) : null;
    const limitLiters = Number(body.limitLiters || 0);
    const note = body.note ? String(body.note) : null;
    const isActive = body.isActive !== false;

    if (!periodMonth || !fuelType) {
      return NextResponse.json({ error: "periodMonth and fuelType are required" }, { status: 400 });
    }
    if (!FUEL_TYPES.has(fuelType)) {
      return NextResponse.json({ error: "Invalid fuel type" }, { status: 400 });
    }
    if (!Number.isFinite(limitLiters) || limitLiters <= 0) {
      return NextResponse.json({ error: "limitLiters must be greater than zero" }, { status: 400 });
    }
    if ((vehicleId && mechanizatorId) || (!vehicleId && !mechanizatorId)) {
      return NextResponse.json({ error: "Specify either vehicleId or mechanizatorId" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...FUEL_ROLES],
    });

    const periodDate = new Date(periodMonth);
    if (Number.isNaN(periodDate.getTime())) {
      return NextResponse.json({ error: "periodMonth is invalid" }, { status: 400 });
    }
    const normalizedPeriodMonth = `${periodDate.getUTCFullYear()}-${String(periodDate.getUTCMonth() + 1).padStart(2, "0")}-01`;

    let existingQuery = supabase
      .from("fuel_limits")
      .select("id")
      .eq("company_id", companyId)
      .eq("period_month", normalizedPeriodMonth)
      .eq("fuel_type", fuelType)
      .eq("archived", false);

    existingQuery = vehicleId ? existingQuery.eq("vehicle_id", vehicleId).is("mechanizator_id", null) : existingQuery.eq("mechanizator_id", mechanizatorId).is("vehicle_id", null);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });

    if (existing?.id) {
      const { data, error } = await supabase
        .from("fuel_limits")
        .update({
          limit_liters: limitLiters,
          note,
          is_active: isActive,
          updated_by_user_id: actor.id,
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ id: data.id });
    }

    const { data, error } = await supabase
      .from("fuel_limits")
      .insert({
        company_id: companyId,
        period_month: normalizedPeriodMonth,
        fuel_type: fuelType,
        vehicle_id: vehicleId,
        mechanizator_id: mechanizatorId,
        limit_liters: limitLiters,
        note,
        is_active: isActive,
        archived: false,
        created_by_user_id: actor.id,
        updated_by_user_id: actor.id,
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ id: data.id });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
