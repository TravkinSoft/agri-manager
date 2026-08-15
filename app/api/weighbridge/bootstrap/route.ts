import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_READ_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";

const dayKey = (value: string | null | undefined) => {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

function aggregateHarvestTickets(rows: any[]) {
  const netKg = rows.reduce((sum, row) => sum + Number(row.net_weight_kg || 0), 0);
  const moistureValues = rows
    .map((row) => Number((Array.isArray(row.lines) ? row.lines[0] : null)?.moisture_percent))
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    netKg,
    trips: rows.length,
    averageTripKg: rows.length > 0 ? netKg / rows.length : 0,
    averageMoisture: moistureValues.length > 0
      ? moistureValues.reduce((sum, value) => sum + value, 0) / moistureValues.length
      : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const includeSummary = request.nextUrl.searchParams.get("summary") === "true";

    const [shiftRes, ticketsRes, nodesRes, pendingRes, seasonsRes, harvestTicketsRes] = await Promise.all([
      supabase
        .from("weighbridge_shifts")
        .select("*")
        .eq("company_id", companyId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      includeSummary
        ? supabase
            .from("tickets")
            .select("id,shift_id,status,op_type,vehicle_id,driver_id,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg,requires_review,local_sync_status,is_voided,manual_correction_reason")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(200)
        : supabase
            .from("tickets")
            .select("id,shift_id,status,op_type,vehicle_id,driver_id,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg,requires_review,local_sync_status,is_voided,manual_correction_reason")
            .eq("company_id", companyId)
            .in("status", ["draft", "active", "ready_to_close"])
            .order("created_at", { ascending: false })
            .limit(100),
      supabase
        .from("processing_nodes")
        .select("id,name,type,linked_warehouse_id,is_active")
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("local_sync_status", ["pending", "queued", "failed"]),
      supabase
        .from("seasons")
        .select("id,year")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("year", { ascending: false }),
      includeSummary
        ? supabase
            .from("tickets")
            .select("id,season_id,field_id,vehicle_id,driver_id,net_weight_kg,finalized_at,created_at,lines:ticket_lines(moisture_percent)")
            .eq("company_id", companyId)
            .eq("op_type", "harvest_incoming")
            .eq("status", "finalized")
            .eq("is_finalized", true)
            .eq("is_voided", false)
            .order("finalized_at", { ascending: false })
            .limit(5000)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (shiftRes.error) return NextResponse.json({ error: shiftRes.error.message }, { status: 400 });
    if (ticketsRes.error) return NextResponse.json({ error: ticketsRes.error.message }, { status: 400 });
    if (nodesRes.error && !String(nodesRes.error.message || "").toLowerCase().includes("processing_nodes")) {
      return NextResponse.json({ error: nodesRes.error.message }, { status: 400 });
    }
    if (seasonsRes.error) return NextResponse.json({ error: seasonsRes.error.message }, { status: 400 });
    if (harvestTicketsRes.error) return NextResponse.json({ error: harvestTicketsRes.error.message }, { status: 400 });

    const tickets = ticketsRes.data || [];
    const activeTickets = tickets.filter((t: any) => ["draft", "active", "ready_to_close"].includes(String(t.status)));
    const stuckTickets = activeTickets.filter((t: any) => {
      const ageMs = Date.now() - new Date(String(t.created_at)).getTime();
      return ageMs > 1000 * 60 * 60 * 6;
    });
    const requiresReviewCount = tickets.filter((t: any) => Boolean(t.requires_review)).length;
    const manualCorrectionsCount = tickets.filter((t: any) => Boolean(t.tare_weight_kg) && !Boolean(t.net_weight_kg)).length;
    const nowYear = new Date().getFullYear();
    const activeSeason = (seasonsRes.data || []).find((row: any) => Number(row.year) === nowYear) || (seasonsRes.data || [])[0];
    const seasonHarvestTickets = (harvestTicketsRes.data || []).filter(
      (ticket: any) => !activeSeason?.id || String(ticket.season_id || "") === String(activeSeason.id)
    );
    const todayKey = dayKey(new Date().toISOString());
    const todayHarvestTickets = seasonHarvestTickets.filter(
      (ticket: any) => dayKey(ticket.finalized_at || ticket.created_at) === todayKey
    );
    const fieldIds = Array.from(new Set(seasonHarvestTickets.map((ticket: any) => String(ticket.field_id || "")).filter(Boolean)));
    const byField = Object.fromEntries(fieldIds.map((fieldId) => {
      const cumulative = seasonHarvestTickets.filter((ticket: any) => String(ticket.field_id || "") === fieldId);
      const today = cumulative.filter((ticket: any) => dayKey(ticket.finalized_at || ticket.created_at) === todayKey);
      return [fieldId, { today: aggregateHarvestTickets(today), cumulative: aggregateHarvestTickets(cumulative) }];
    }));
    const shiftTickets = shiftRes.data?.id
      ? tickets.filter((ticket: any) => String(ticket.shift_id || "") === String(shiftRes.data.id))
      : [];
    const shiftOpenedAt = shiftRes.data?.opened_at ? new Date(String(shiftRes.data.opened_at)) : null;
    const shiftAgeHours = shiftOpenedAt && !Number.isNaN(shiftOpenedAt.getTime())
      ? (Date.now() - shiftOpenedAt.getTime()) / (1000 * 60 * 60)
      : 0;

    return NextResponse.json({
      shift: shiftRes.data || null,
      shiftGuard: {
        stale: Boolean(shiftRes.data?.id) && (shiftAgeHours > 18 || dayKey(shiftRes.data?.opened_at) !== todayKey),
        ageHours: Math.max(0, shiftAgeHours),
      },
      processingNodes: nodesRes.data || [],
      harvestSummary: {
        seasonId: activeSeason?.id || null,
        today: aggregateHarvestTickets(todayHarvestTickets),
        byField,
      },
      shiftSummary: {
        trips: shiftTickets.filter((ticket: any) => ticket.status === "finalized" && !ticket.is_voided).length,
        netKg: shiftTickets.reduce((sum: number, ticket: any) => sum + Number(ticket.net_weight_kg || 0), 0),
        open: shiftTickets.filter((ticket: any) => ["draft", "active", "ready_to_close"].includes(String(ticket.status))).length,
        voided: shiftTickets.filter((ticket: any) => ticket.status === "voided" || ticket.is_voided).length,
        manualCorrections: shiftTickets.filter((ticket: any) => Boolean(ticket.manual_correction_reason)).length,
      },
      counters: {
        activeTickets: activeTickets.length,
        stuckTickets: stuckTickets.length,
        unsynced: pendingRes.count || 0,
        requiresReview: requiresReviewCount,
        manualCorrections: manualCorrectionsCount,
      },
    });
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
