import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

async function getActiveShift(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase
    .from("weighbridge_shifts")
    .select("*")
    .eq("company_id", companyId)
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

    const shift = await getActiveShift(supabase, companyId);
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
    const body = await request.json().catch(() => ({}));
    const { companyId } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    return NextResponse.json(
      {
        error: "Смена открывается после выбора весовщика и ввода PIN.",
        companyId,
      },
      { status: 409 }
    );
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
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });

    const shift = await getActiveShift(supabase, companyId);
    if (!shift?.id) {
      return NextResponse.json({ error: "No active shift found" }, { status: 400 });
    }
    const operatorSession = await requireWeighbridgeOperatorSession(request, { companyId, supabase });

    const { count: unresolvedCount, error: unresolvedError } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("shift_id", shift.id)
      .in("status", ["draft", "active", "ready_to_close"]);
    if (unresolvedError) return NextResponse.json({ error: unresolvedError.message }, { status: 400 });

    if ((unresolvedCount || 0) > 0) {
      return NextResponse.json(
        { error: "Нельзя закрыть смену, пока есть открытые талоны." },
        { status: 409 }
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
        closed_by_person_id: operatorSession.operator.id,
        close_reason: "manual_close",
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
