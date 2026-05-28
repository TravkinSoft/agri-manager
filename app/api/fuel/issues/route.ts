import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const FUEL_ROLES = ["admin", "company_admin", "global_admin", "warehouse", "fuel_operator"] as const;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const fuelSourceId = String(body.fuelSourceId || "").trim();
    const vehicleId = String(body.vehicleId || "").trim();
    const mechanizatorId = body.mechanizatorId ? String(body.mechanizatorId) : null;
    const liters = Number(body.liters || 0);
    const comment = body.comment ? String(body.comment) : null;
    const issuedAt = body.issuedAt ? String(body.issuedAt) : null;

    if (!fuelSourceId || !vehicleId) {
      return NextResponse.json({ error: "fuelSourceId and vehicleId are required" }, { status: 400 });
    }
    if (!Number.isFinite(liters) || liters <= 0) {
      return NextResponse.json({ error: "Liters must be greater than zero" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...FUEL_ROLES],
    });

    const { data, error } = await supabase.rpc("issue_fuel_mvp", {
      p_company_id: companyId,
      p_actor_user_id: actor.id,
      p_fuel_source_id: fuelSourceId,
      p_vehicle_id: vehicleId,
      p_mechanizator_id: mechanizatorId,
      p_liters: liters,
      p_issued_at: issuedAt,
      p_comment: comment,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ id: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
