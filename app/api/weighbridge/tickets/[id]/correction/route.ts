import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
  weighbridgeUserError,
} from "@/app/api/weighbridge/_auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const reason = String(body?.reason || "").trim();
    if (!id || !["start", "finalize"].includes(action)) {
      return NextResponse.json({ error: "ticket id and correction action are required" }, { status: 400 });
    }
    if (action === "start" && !reason) {
      return NextResponse.json({ error: "Причина исправления обязательна." }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id,company_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (ticketError || !ticket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Ticket not found" }, { status: 404 });
    }

    const operatorSession = actor.role === "weighman"
      ? await requireWeighbridgeOperatorSession(request, { companyId, supabase })
      : null;
    const rpc = action === "start"
      ? "start_weighbridge_ticket_correction_v1"
      : "finalize_weighbridge_ticket_correction_v1";
    const args = action === "start"
      ? {
          p_ticket_id: id,
          p_reason: reason,
          p_operator_person_id: operatorSession?.operator.id || null,
          p_shift_id: operatorSession?.shift.id || null,
        }
      : {
          p_ticket_id: id,
          p_operator_person_id: operatorSession?.operator.id || null,
          p_shift_id: operatorSession?.shift.id || null,
        };
    const { data: resultId, error: rpcError } = await supabase.rpc(rpc, args);
    if (rpcError) {
      const message = weighbridgeUserError(rpcError.message);
      const status = message.includes("последующих движениях") ? 409 : 400;
      return NextResponse.json({ error: message, code: status === 409 ? "downstream_dependency" : "correction_failed" }, { status });
    }

    const { data: corrected, error: correctedError } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", String(resultId || id))
      .eq("company_id", companyId)
      .single();
    if (correctedError) {
      return NextResponse.json({ error: correctedError.message }, { status: 400 });
    }
    return NextResponse.json({ ticket: corrected });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
