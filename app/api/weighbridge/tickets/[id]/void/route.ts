import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, recordWeighbridgeOperatorActivity, requireWeighbridgeOperatorSession, resolveWeighbridgeSession, weighbridgeUserError } from "@/app/api/weighbridge/_auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const timing = { authMs: 0, validationMs: 0, dbMs: 0, rpcMs: 0, totalMs: 0 };
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

    const authStartedAt = Date.now();
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    timing.authMs = Date.now() - authStartedAt;
    const validationStartedAt = Date.now();
    const { data: ticketBefore, error: ticketBeforeError } = await supabase
      .from("tickets")
      .select("id, company_id, vehicle_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (ticketBeforeError || !ticketBefore?.id) {
      return NextResponse.json({ error: ticketBeforeError?.message || "Ticket not found" }, { status: 404 });
    }
    const operatorSession = actor.role === "weighman"
      ? await requireWeighbridgeOperatorSession(request, { companyId, supabase })
      : null;
    timing.validationMs = Date.now() - validationStartedAt;

    const rpcStartedAt = Date.now();
    const { error } = await supabase.rpc("void_weighbridge_ticket_for_session_v1", {
      p_ticket_id: id,
      p_reason: reason,
    });
    timing.rpcMs = Date.now() - rpcStartedAt;

    if (error) {
      return NextResponse.json({ error: weighbridgeUserError(error.message) }, { status: 400 });
    }

    const dbStartedAt = Date.now();
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
    timing.dbMs = Date.now() - dbStartedAt;
    if (operatorSession) {
      await recordWeighbridgeOperatorActivity(request, { companyId, supabase }, "ticket_void");
    }

    timing.totalMs = Date.now() - startedAt;
    return NextResponse.json({ ticket: updated, debug: timing });
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
