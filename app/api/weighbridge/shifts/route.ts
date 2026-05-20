import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";

async function getActiveShift(supabase: ReturnType<typeof getServiceClient>, companyId: string, operatorId: string) {
  const { data, error } = await supabase
    .from("weighbridge_shifts")
    .select("*")
    .eq("company_id", companyId)
    .eq("operator_id", operatorId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request: NextRequest) {
  try {
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
    });

    const shift = await getActiveShift(supabase, companyId, actor.id);
    return NextResponse.json({ shift });
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const openingNote = String(body?.openingNote || "").trim() || null;
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });

    const current = await getActiveShift(supabase, companyId, actor.id);
    if (current?.id) return NextResponse.json({ shift: current });

    const { data, error } = await supabase
      .from("weighbridge_shifts")
      .insert({
        company_id: companyId,
        operator_id: actor.id,
        opened_by: actor.id,
        opening_note: openingNote,
        status: "open",
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ shift: data });
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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const handoverNote = String(body?.handoverNote || "").trim() || null;
    const closingNote = String(body?.closingNote || "").trim() || null;
    const force = Boolean(body?.force);
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });

    const shift = await getActiveShift(supabase, companyId, actor.id);
    if (!shift?.id) {
      return NextResponse.json({ error: "No active shift found" }, { status: 400 });
    }

    const { count: unresolvedCount, error: unresolvedError } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("shift_id", shift.id)
      .in("status", ["draft", "active", "ready_to_close"]);
    if (unresolvedError) return NextResponse.json({ error: unresolvedError.message }, { status: 400 });

    if ((unresolvedCount || 0) > 0 && !force && !handoverNote) {
      return NextResponse.json(
        { error: "There are unresolved tickets. Add handoverNote or use force close." },
        { status: 400 }
      );
    }

    const { data: shiftTickets, error: ticketsError } = await supabase
      .from("tickets")
      .select("id,status,gross_weight_kg,net_weight_kg,manual_correction_reason,local_sync_status")
      .eq("company_id", companyId)
      .eq("shift_id", shift.id);
    if (ticketsError) return NextResponse.json({ error: ticketsError.message }, { status: 400 });

    const ticketCount = (shiftTickets || []).length;
    const closedTicketCount = (shiftTickets || []).filter((t: any) => t.status === "finalized").length;
    const voidedTicketCount = (shiftTickets || []).filter((t: any) => t.status === "voided").length;
    const manualCorrectionCount = (shiftTickets || []).filter((t: any) => !!t.manual_correction_reason).length;
    const unsyncedCount = (shiftTickets || []).filter((t: any) => t.local_sync_status && t.local_sync_status !== "synced").length;
    const grossTotalKg = (shiftTickets || []).reduce((acc: number, t: any) => acc + Number(t.gross_weight_kg || 0), 0);
    const netTotalKg = (shiftTickets || []).reduce((acc: number, t: any) => acc + Number(t.net_weight_kg || 0), 0);

    const { data: closed, error: closeError } = await supabase
      .from("weighbridge_shifts")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: actor.id,
        closing_note: closingNote,
        handover_note: handoverNote,
        ticket_count: ticketCount,
        closed_ticket_count: closedTicketCount,
        voided_ticket_count: voidedTicketCount,
        manual_correction_count: manualCorrectionCount,
        unresolved_ticket_count: unresolvedCount || 0,
        unsynced_count: unsyncedCount,
        gross_total_kg: grossTotalKg,
        net_total_kg: netTotalKg,
        summary_json: {
          ticketCount,
          closedTicketCount,
          voidedTicketCount,
          manualCorrectionCount,
          unresolvedCount: unresolvedCount || 0,
          unsyncedCount,
          grossTotalKg,
          netTotalKg,
        },
      })
      .eq("id", shift.id)
      .select("*")
      .single();
    if (closeError) return NextResponse.json({ error: closeError.message }, { status: 400 });

    return NextResponse.json({ shift: closed });
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
