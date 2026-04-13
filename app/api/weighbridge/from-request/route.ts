import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";

function buildTicketNo(companyId: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  return `WB-${companyId.slice(0, 6).toUpperCase()}-${stamp}`;
}

export async function POST(request: NextRequest) {
  try {
    const { requestId, actorUserId, sourceWarehouseId, vehicleId } = await request.json();
    if (!requestId || !actorUserId || !sourceWarehouseId) {
      return NextResponse.json(
        { error: "requestId, actorUserId and sourceWarehouseId are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const { data: reqRow, error: reqError } = await supabase
      .from("warehouse_issue_requests")
      .select(`
        *,
        items:warehouse_issue_request_items(*)
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (reqError || !reqRow?.id) {
      return NextResponse.json({ error: reqError?.message || "Issue request not found" }, { status: 404 });
    }

    await assertActorAccess({
      supabase,
      actorUserId,
      companyId: reqRow.company_id,
      allowedRoles: ["admin", "warehouse", "weighman"],
    });

    if (vehicleId) {
      const { data: vehicle, error: vehicleError } = await supabase
        .from("reference_vehicles")
        .select("id, status, is_active, archived")
        .eq("company_id", reqRow.company_id)
        .eq("id", vehicleId)
        .maybeSingle();
      if (vehicleError || !vehicle?.id) {
        return NextResponse.json({ error: vehicleError?.message || "Vehicle not found" }, { status: 400 });
      }
      if (!vehicle.is_active || vehicle.archived) {
        return NextResponse.json({ error: "Vehicle is inactive or archived" }, { status: 400 });
      }

      const { data: activeByVehicle } = await supabase
        .from("tickets")
        .select("id")
        .eq("company_id", reqRow.company_id)
        .eq("vehicle_id", vehicleId)
        .in("status", ["draft", "active", "ready_to_close"])
        .limit(1);
      if ((activeByVehicle || []).length > 0) {
        return NextResponse.json({ error: "This vehicle already has an active ticket" }, { status: 400 });
      }
    }

    if (reqRow.linked_ticket_id) {
      return NextResponse.json({ ticketId: reqRow.linked_ticket_id, duplicate: true });
    }

    const ticketNo = buildTicketNo(reqRow.company_id);
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .insert({
        company_id: reqRow.company_id,
        ticket_no: ticketNo,
        ticket_type: "warehouse_issue",
        op_type: "issue_to_field",
        status: "active",
        direction: "outgoing",
        source_kind: "warehouse_request",
        source_id: String(reqRow.id),
        destination_kind: "field",
        destination_id: String(reqRow.field_id || ""),
        field_id: reqRow.field_id,
        warehouse_from_id: sourceWarehouseId,
        vehicle_id: vehicleId || null,
        responsible_user_id: reqRow.recipient_user_id,
        created_by: actorUserId,
        linked_operation_id: reqRow.operation_id,
        linked_request_id: reqRow.id,
        notes: reqRow.comment,
        weigh_method: "preset_tare",
      })
      .select("*")
      .single();

    if (ticketError || !ticket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Failed to create ticket" }, { status: 400 });
    }

    const { data: products } = await supabase
      .from("products")
      .select("id, name")
      .in("id", (reqRow.items || []).map((item: any) => item.product_id))
      .eq("company_id", reqRow.company_id);
    const productById = new Map<string, string>();
    (products || []).forEach((item: any) => productById.set(String(item.id), String(item.name)));

    const lines = (reqRow.items || []).map((item: any) => ({
      ticket_id: ticket.id,
      company_id: reqRow.company_id,
      product_id: item.product_id,
      product_name_snapshot: productById.get(String(item.product_id)) || null,
      uom: item.unit || "kg",
      quantity: Number(item.required_quantity || 0),
      notes: `From warehouse request ${reqRow.request_number}`,
    }));

    if (lines.length > 0) {
      const { error: linesError } = await supabase.from("ticket_lines").insert(lines);
      if (linesError) {
        return NextResponse.json({ error: linesError.message }, { status: 400 });
      }
    }

    await supabase
      .from("warehouse_issue_requests")
      .update({
        linked_ticket_id: ticket.id,
        source_warehouse_id: sourceWarehouseId,
        status: reqRow.status === "new" ? "ready" : reqRow.status,
      })
      .eq("id", reqRow.id);

    if (vehicleId) {
      await supabase
        .from("reference_vehicles")
        .update({ status: "in_trip" })
        .eq("id", vehicleId)
        .eq("company_id", reqRow.company_id);
    }

    return NextResponse.json({ ticketId: ticket.id, ticketNo: ticket.ticket_no });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
