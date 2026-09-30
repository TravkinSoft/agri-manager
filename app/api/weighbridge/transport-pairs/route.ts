import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import {
  OPEN_TRANSPORT_TICKET_STATUSES,
  buildWeighbridgeTransportPickerData,
  type TransportPairTicketRow,
} from "@/lib/weighbridge/transport-pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const [companyResult, seasonResult, finalizedResult, openResult] = await Promise.all([
      supabase
        .from("companies")
        .select("id,operational_day_start_hour")
        .eq("id", companyId)
        .maybeSingle(),
      supabase
        .from("seasons")
        .select("id,year")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("year", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tickets")
        .select("id,ticket_no,vehicle_id,driver_id,status,season_id,finalized_at,updated_at,created_at,is_voided,replacement_ticket_id")
        .eq("company_id", companyId)
        .eq("status", "finalized")
        .not("vehicle_id", "is", null)
        .not("driver_id", "is", null)
        .order("finalized_at", { ascending: false, nullsFirst: false })
        .limit(200),
      supabase
        .from("tickets")
        .select("id,ticket_no,vehicle_id,driver_id,status,season_id,updated_at,created_at")
        .eq("company_id", companyId)
        .in("status", [...OPEN_TRANSPORT_TICKET_STATUSES])
        .or("vehicle_id.not.is.null,driver_id.not.is.null")
        .order("created_at", { ascending: true })
        .limit(100),
    ]);

    const error = companyResult.error || seasonResult.error || finalizedResult.error || openResult.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const payload = buildWeighbridgeTransportPickerData({
      finalizedTickets: (finalizedResult.data || []) as TransportPairTicketRow[],
      openTickets: (openResult.data || []) as TransportPairTicketRow[],
      seasonId: seasonResult.data?.id ? String(seasonResult.data.id) : null,
      operationalDayStartHour: Number(companyResult.data?.operational_day_start_hour ?? 7),
      pairLimit: 4,
    });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load transport pair hints" },
      { status: 500 }
    );
  }
}
