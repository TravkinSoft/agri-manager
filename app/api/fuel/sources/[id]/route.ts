import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const FUEL_ROLES = ["admin", "company_admin", "global_admin", "warehouse", "fuel_operator"] as const;
const FUEL_TYPES = new Set(["diesel", "gasoline", "adblue", "oil", "other"]);
const SOURCE_TYPES = new Set(["stationary_azs", "barrel", "fuel_truck", "mobile_tank"]);

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sourceId = String(params.id || "").trim();
    const body = await request.json();
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    if (!sourceId) {
      return NextResponse.json({ error: "source id is required" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_by_user_id: actor.id,
    };

    if (body.name !== undefined) patch.name = String(body.name || "").trim();
    if (body.sourceType !== undefined) patch.source_type = String(body.sourceType || "");
    if (body.fuelType !== undefined) patch.fuel_type = String(body.fuelType || "");
    if (body.capacityLiters !== undefined) patch.capacity_liters = body.capacityLiters === null || body.capacityLiters === "" ? null : Number(body.capacityLiters);
    if (body.currentBalanceLiters !== undefined) patch.current_balance_liters = Number(body.currentBalanceLiters);
    if (body.location !== undefined) patch.location = body.location ? String(body.location).trim() : null;
    if (body.assignedVehicleId !== undefined) patch.assigned_vehicle_id = body.assignedVehicleId ? String(body.assignedVehicleId) : null;
    if (body.isActive !== undefined) patch.is_active = Boolean(body.isActive);
    if (body.archived !== undefined) patch.archived = Boolean(body.archived);

    if (patch.name !== undefined && !String(patch.name || "").trim()) {
      return NextResponse.json({ error: "Fuel source name cannot be empty" }, { status: 400 });
    }
    if (patch.source_type !== undefined && !SOURCE_TYPES.has(String(patch.source_type))) {
      return NextResponse.json({ error: "Invalid source type" }, { status: 400 });
    }
    if (patch.fuel_type !== undefined && !FUEL_TYPES.has(String(patch.fuel_type))) {
      return NextResponse.json({ error: "Invalid fuel type" }, { status: 400 });
    }

    if (patch.capacity_liters !== undefined && patch.capacity_liters !== null) {
      const cap = Number(patch.capacity_liters);
      if (!Number.isFinite(cap) || cap < 0) {
        return NextResponse.json({ error: "capacityLiters must be zero or greater" }, { status: 400 });
      }
    }
    if (patch.current_balance_liters !== undefined) {
      const bal = Number(patch.current_balance_liters);
      if (!Number.isFinite(bal) || bal < 0) {
        return NextResponse.json({ error: "currentBalanceLiters must be zero or greater" }, { status: 400 });
      }
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...FUEL_ROLES],
    });

    const { data: existing, error: existingError } = await supabase
      .from("fuel_sources")
      .select("id,company_id")
      .eq("id", sourceId)
      .maybeSingle();
    if (existingError || !existing?.id || existing.company_id !== companyId) {
      return NextResponse.json({ error: "Fuel source not found in company" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("fuel_sources")
      .update(patch)
      .eq("id", sourceId)
      .eq("company_id", companyId)
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
