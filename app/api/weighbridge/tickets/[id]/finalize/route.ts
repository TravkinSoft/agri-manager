import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { actorUserId } = await request.json();

    if (!id || !actorUserId) {
      return NextResponse.json({ error: "ticket id and actorUserId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: ticketBefore, error: ticketBeforeError } = await supabase
      .from("tickets")
      .select("id, company_id, linked_request_id, warehouse_from_id, vehicle_id")
      .eq("id", id)
      .maybeSingle();

    if (ticketBeforeError || !ticketBefore?.id) {
      return NextResponse.json({ error: ticketBeforeError?.message || "Ticket not found" }, { status: 404 });
    }

    await assertActorAccess({
      supabase,
      actorUserId,
      companyId: ticketBefore.company_id,
      allowedRoles: ["admin", "warehouse", "weighman"],
    });

    const { error: finalizeError } = await supabase.rpc("finalize_weighbridge_ticket_v2", {
      p_ticket_id: id,
      p_actor_user_id: actorUserId,
    });

    if (finalizeError) {
      return NextResponse.json({ error: finalizeError.message || "Ticket finalization failed" }, { status: 400 });
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
          issued_by_user_id: actorUserId,
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
