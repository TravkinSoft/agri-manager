import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  try {
    const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
    const actorUserId = String(request.nextUrl.searchParams.get("userId") || "").trim();
    if (!companyId || !actorUserId) {
      return NextResponse.json({ error: "companyId and userId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId,
      companyId,
      allowedRoles: ["admin", "company_admin", "global_admin", "weighman", "warehouse", "agronomist"],
    });

    const [shiftRes, ticketsRes, nodesRes, pendingRes] = await Promise.all([
      supabase
        .from("weighbridge_shifts")
        .select("*")
        .eq("company_id", companyId)
        .eq("operator_id", actorUserId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tickets")
        .select("id,status,op_type,vehicle_id,driver_id,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg,requires_review,local_sync_status")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
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
    ]);

    if (shiftRes.error) return NextResponse.json({ error: shiftRes.error.message }, { status: 400 });
    if (ticketsRes.error) return NextResponse.json({ error: ticketsRes.error.message }, { status: 400 });
    if (nodesRes.error && !String(nodesRes.error.message || "").toLowerCase().includes("processing_nodes")) {
      return NextResponse.json({ error: nodesRes.error.message }, { status: 400 });
    }

    const tickets = ticketsRes.data || [];
    const activeTickets = tickets.filter((t: any) => ["draft", "active", "ready_to_close"].includes(String(t.status)));
    const stuckTickets = activeTickets.filter((t: any) => {
      const ageMs = Date.now() - new Date(String(t.created_at)).getTime();
      return ageMs > 1000 * 60 * 60 * 6;
    });
    const requiresReviewCount = tickets.filter((t: any) => Boolean(t.requires_review)).length;
    const manualCorrectionsCount = tickets.filter((t: any) => Boolean(t.tare_weight_kg) && !Boolean(t.net_weight_kg)).length;

    return NextResponse.json({
      shift: shiftRes.data || null,
      processingNodes: nodesRes.data || [],
      counters: {
        activeTickets: activeTickets.length,
        stuckTickets: stuckTickets.length,
        unsynced: pendingRes.count || 0,
        requiresReview: requiresReviewCount,
        manualCorrections: manualCorrectionsCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

