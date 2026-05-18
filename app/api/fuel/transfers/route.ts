import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";

const FUEL_ROLES = ["admin", "company_admin", "global_admin", "warehouse", "fuel_operator"] as const;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const companyId = String(body.companyId || "").trim();
    const actorUserId = String(body.actorUserId || "").trim();
    const fromFuelSourceId = String(body.fromFuelSourceId || "").trim();
    const toFuelSourceId = String(body.toFuelSourceId || "").trim();
    const operatorPersonnelId = body.operatorPersonnelId ? String(body.operatorPersonnelId) : null;
    const liters = Number(body.liters || 0);
    const comment = body.comment ? String(body.comment) : null;
    const transferredAt = body.transferredAt ? String(body.transferredAt) : null;

    if (!companyId || !actorUserId || !fromFuelSourceId || !toFuelSourceId) {
      return NextResponse.json({ error: "companyId, actorUserId, fromFuelSourceId and toFuelSourceId are required" }, { status: 400 });
    }
    if (fromFuelSourceId === toFuelSourceId) {
      return NextResponse.json({ error: "Source and destination fuel sources must be different" }, { status: 400 });
    }
    if (!Number.isFinite(liters) || liters <= 0) {
      return NextResponse.json({ error: "Liters must be greater than zero" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId,
      companyId,
      allowedRoles: [...FUEL_ROLES],
    });

    const { data, error } = await supabase.rpc("transfer_fuel_mvp", {
      p_company_id: companyId,
      p_actor_user_id: actorUserId,
      p_from_fuel_source_id: fromFuelSourceId,
      p_to_fuel_source_id: toFuelSourceId,
      p_liters: liters,
      p_transferred_at: transferredAt,
      p_operator_personnel_id: operatorPersonnelId,
      p_comment: comment,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ id: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
