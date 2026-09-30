import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const FUEL_ROLES = ["admin", "company_admin", "global_admin", "warehouse", "fuel_operator"] as const;
const FUEL_TYPES = new Set(["diesel", "gasoline", "adblue", "oil", "other"]);
const SOURCE_TYPES = new Set(["stationary_azs", "barrel", "fuel_truck", "mobile_tank"]);

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(request.nextUrl.searchParams.get("companyId") || "").trim() || null);

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...FUEL_ROLES],
    });

    const { data, error } = await supabase
      .from("fuel_sources")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ sources: data || [] });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const name = String(body.name || "").trim();
    const sourceType = String(body.sourceType || "stationary_azs").trim();
    const fuelType = String(body.fuelType || "diesel").trim();
    const capacityLiters = body.capacityLiters == null || body.capacityLiters === "" ? null : Number(body.capacityLiters);
    const currentBalanceLiters = body.currentBalanceLiters == null || body.currentBalanceLiters === "" ? 0 : Number(body.currentBalanceLiters);
    const location = body.location ? String(body.location).trim() : null;
    const assignedVehicleId = body.assignedVehicleId ? String(body.assignedVehicleId) : null;
    const isActive = body.isActive !== false;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!SOURCE_TYPES.has(sourceType)) {
      return NextResponse.json({ error: "Invalid source type" }, { status: 400 });
    }
    if (!FUEL_TYPES.has(fuelType)) {
      return NextResponse.json({ error: "Invalid fuel type" }, { status: 400 });
    }
    if ((capacityLiters != null && (!Number.isFinite(capacityLiters) || capacityLiters < 0)) || !Number.isFinite(currentBalanceLiters) || currentBalanceLiters < 0) {
      return NextResponse.json({ error: "Fuel source liters must be zero or greater" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...FUEL_ROLES],
    });

    const { data, error } = await supabase
      .from("fuel_sources")
      .insert({
        company_id: companyId,
        name,
        source_type: sourceType,
        fuel_type: fuelType,
        capacity_liters: capacityLiters,
        current_balance_liters: currentBalanceLiters,
        location: location || null,
        assigned_vehicle_id: assignedVehicleId,
        is_active: isActive,
        archived: false,
        created_by_user_id: actor.id,
        updated_by_user_id: actor.id,
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ source: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
