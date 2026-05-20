import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = String(body?.reason || "").trim();
    if (!id || !reason) {
      return NextResponse.json(
        { error: "ticket id and reason are required" },
        { status: 400 }
      );
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const { data: ticketBefore, error: ticketBeforeError } = await supabase
      .from("tickets")
      .select("id, company_id, vehicle_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (ticketBeforeError || !ticketBefore?.id) {
      return NextResponse.json({ error: ticketBeforeError?.message || "Ticket not found" }, { status: 404 });
    }

    const { error } = await supabase.rpc("void_ticket_with_storno_v2", {
      p_ticket_id: id,
      p_actor_user_id: actor.id,
      p_reason: reason,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: updated } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (ticketBefore.vehicle_id) {
      const { data: stillActive } = await supabase
        .from("tickets")
        .select("id")
        .eq("company_id", ticketBefore.company_id)
        .eq("vehicle_id", ticketBefore.vehicle_id)
        .in("status", ["draft", "active", "ready_to_close"])
        .neq("id", id)
        .limit(1);

      if ((stillActive || []).length === 0) {
        await supabase
          .from("reference_vehicles")
          .update({ status: "free" })
          .eq("id", ticketBefore.vehicle_id)
          .eq("company_id", ticketBefore.company_id);
      }
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
