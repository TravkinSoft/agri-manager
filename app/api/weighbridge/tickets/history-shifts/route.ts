import { NextRequest, NextResponse } from "next/server";
import { asSessionErrorResponse, resolveWeighbridgeSession, WEIGHBRIDGE_TICKET_READ_ROLES } from "@/app/api/weighbridge/_auth";
import { decodeTicketHistoryCursor, encodeTicketHistoryCursor, type TicketHistoryCursor } from "@/lib/weighbridge/ticket-history-cursor";

export const dynamic = "force-dynamic";

// Read-only catalogue. Never call the operator-session RPC or change the active shift.
export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, { allowedRoles: WEIGHBRIDGE_TICKET_READ_ROLES });
    let cursor: TicketHistoryCursor | null = null;
    try {
      const encoded = request.nextUrl.searchParams.get("cursor");
      if (encoded) cursor = decodeTicketHistoryCursor(encoded);
    } catch { return NextResponse.json({ error: "Некорректная страница списка смен." }, { status: 400 }); }
    let query = supabase.from("weighbridge_shifts").select("id,status,opened_at,closed_at").eq("company_id", companyId);
    if (cursor) query = query.or(`opened_at.lt.${cursor.createdAt},and(opened_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const { data, error } = await query.order("opened_at", { ascending: false }).order("id", { ascending: false }).limit(51);
    if (error) throw error;
    const shifts = (data || []).slice(0, 50);
    const last = shifts[shifts.length - 1];
    return NextResponse.json({ shifts, nextCursor: (data || []).length > 50 && last
      ? encodeTicketHistoryCursor({ created_at: last.opened_at, id: last.id }) : null,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const session = asSessionErrorResponse(error);
    return NextResponse.json({ error: session?.error || (error instanceof Error ? error.message : "Не удалось загрузить смены.") }, { status: session?.status || 500 });
  }
}
