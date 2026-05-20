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

    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const { data: ticketBefore, error: ticketBeforeError } = await supabase
      .from("tickets")
      .select("id, company_id, linked_request_id, warehouse_from_id, vehicle_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (ticketBeforeError || !ticketBefore?.id) {
      return NextResponse.json({ error: ticketBeforeError?.message || "Ticket not found" }, { status: 404 });
    }

    const { error: finalizeError } = await supabase.rpc("finalize_weighbridge_ticket_v2", {
      p_ticket_id: id,
      p_actor_user_id: actor.id,
    });

    if (finalizeError) {
      return NextResponse.json({ error: finalizeError.message || "Ticket finalization failed" }, { status: 400 });
    }

    const { error: backfillError } = await supabase.rpc("backfill_ticket_operation_line_links_v1", {
      p_ticket_id: id,
    });
    if (backfillError) {
      return NextResponse.json({ error: backfillError.message || "Operation line linkage backfill failed" }, { status: 400 });
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

    if (ticketBefore.linked_request_id) {
      const { data: requestItems } = await supabase
        .from("warehouse_issue_request_items")
        .select("id, required_quantity")
        .eq("request_id", ticketBefore.linked_request_id);

      await supabase
        .from("warehouse_issue_requests")
        .update({
          status: "issued_by_warehouse",
          issued_at: new Date().toISOString(),
          issued_by_user_id: actor.id,
          source_warehouse_id: ticketBefore.warehouse_from_id || null,
        })
        .eq("id", ticketBefore.linked_request_id);

      await supabase
        .from("warehouse_issue_request_items")
        .upsert(
          (requestItems || []).map((item: any) => ({
            id: item.id,
            issued_quantity: Number(item.required_quantity || 0),
          })),
          { onConflict: "id" }
        );
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
