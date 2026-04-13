import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";

async function ensureDryingStockAndApply(
  supabase: ReturnType<typeof getServiceClient>,
  ticketId: string,
  actorUserId: string
) {
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError || !ticket?.id) {
    throw new Error(ticketError?.message || "Ticket not found");
  }

  const isDryingProcessing =
    String(ticket.direction || "") === "processing" &&
    String(ticket.op_type || "").toLowerCase() === "drying";

  if (!isDryingProcessing) return;

  if (!ticket.warehouse_from_id || !ticket.warehouse_to_id || !ticket.processing_point_from_id) {
    throw new Error("Drying requires source warehouse, drying point and destination warehouse");
  }

  const { data: lines, error: lineError } = await supabase
    .from("ticket_lines")
    .select("*")
    .eq("ticket_id", ticketId);

  if (lineError) {
    throw new Error(lineError.message);
  }

  const ticketLines = Array.isArray(lines) ? lines : [];
  if (ticketLines.length === 0) {
    throw new Error("Ticket lines are required");
  }

  for (const line of ticketLines) {
    const requiredQty = Number(line.quantity || 0);
    if (!(requiredQty > 0)) {
      throw new Error("Drying line quantity must be greater than zero");
    }

    const { data: balData, error: balanceError } = await supabase.rpc("get_stock_balance", {
      p_company_id: ticket.company_id,
      p_warehouse_id: ticket.warehouse_from_id,
      p_product_id: line.product_id,
    });
    if (balanceError) {
      throw new Error(balanceError.message);
    }

    const available = Number(balData || 0);
    if (available < requiredQty) {
      throw new Error(
        `Insufficient stock for drying. Available: ${available.toFixed(3)}, required: ${requiredQty.toFixed(3)}`
      );
    }
  }

  const { data: existingLedger } = await supabase
    .from("stock_ledger_entries")
    .select("id")
    .eq("ticket_id", ticketId)
    .in("reason_type", ["drying_out", "drying_in"])
    .limit(1);
  if ((existingLedger || []).length > 0) {
    return;
  }

  for (const line of ticketLines) {
    const inputQty = Number(line.quantity || 0);
    const outputQty = Number(line.net_line_weight_kg || line.quantity || 0);
    const safeOutput = outputQty > 0 ? outputQty : inputQty;
    const lossQty = Math.max(0, inputQty - safeOutput);

    const { error: outError } = await supabase.from("stock_ledger_entries").insert({
      company_id: ticket.company_id,
      ticket_id: ticketId,
      product_id: line.product_id,
      warehouse_id: ticket.warehouse_from_id,
      direction: "out",
      quantity: inputQty,
      uom: line.uom || "kg",
      delta_qty_signed: -Math.abs(inputQty),
      reason_type: "drying_out",
      reason_ref_id: ticketId,
      occurred_at: new Date().toISOString(),
      created_by: actorUserId,
      notes: ticket.notes || null,
    });
    if (outError) throw new Error(outError.message);

    const { error: inError } = await supabase.from("stock_ledger_entries").insert({
      company_id: ticket.company_id,
      ticket_id: ticketId,
      product_id: line.product_id,
      warehouse_id: ticket.warehouse_to_id,
      direction: "in",
      quantity: safeOutput,
      uom: line.uom || "kg",
      delta_qty_signed: Math.abs(safeOutput),
      reason_type: "drying_in",
      reason_ref_id: ticketId,
      occurred_at: new Date().toISOString(),
      created_by: actorUserId,
      notes: ticket.notes || null,
    });
    if (inError) throw new Error(inError.message);

    const { error: processingError } = await supabase.from("processing_documents").insert({
      company_id: ticket.company_id,
      processing_type: "drying",
      status: "confirmed",
      source_warehouse_id: ticket.warehouse_from_id,
      destination_warehouse_id: ticket.warehouse_to_id,
      processing_point_id: ticket.processing_point_from_id,
      source_ticket_id: ticketId,
      product_id: line.product_id,
      input_qty_kg: inputQty,
      output_qty_kg: safeOutput,
      loss_qty_kg: lossQty,
      moisture_in_percent: line.moisture_percent ?? null,
      actual_loss_method: "measured",
      created_by: actorUserId,
      confirmed_by: actorUserId,
      confirmed_at: new Date().toISOString(),
      notes: ticket.notes || null,
    });
    if (processingError) throw new Error(processingError.message);
  }
}

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

    const { data: editableTicket, error: editableTicketError } = await supabase
      .from("tickets")
      .select("id, direction, op_type, gross_weight_kg, tare_weight_kg")
      .eq("id", id)
      .maybeSingle();
    if (editableTicketError || !editableTicket?.id) {
      return NextResponse.json({ error: editableTicketError?.message || "Ticket not found" }, { status: 404 });
    }

    const gross = Number(editableTicket.gross_weight_kg || 0);
    const tare = Number(editableTicket.tare_weight_kg || 0);
    if (!Number.isFinite(gross) || gross <= 0) {
      return NextResponse.json({ error: "Gross is required and must be positive" }, { status: 400 });
    }
    if (!Number.isFinite(tare) || tare < 0) {
      return NextResponse.json({ error: "Tare must be a non-negative number" }, { status: 400 });
    }
    if (tare > gross) {
      return NextResponse.json({ error: "Tare cannot be greater than gross" }, { status: 400 });
    }

    const net = gross - tare;
    if (!(net > 0)) {
      return NextResponse.json({ error: "Net must be positive" }, { status: 400 });
    }

    // For harvest incoming we should not run outgoing stock checks.
    // Also align incoming quantity with measured net at close time.
    if (String(editableTicket.direction) === "incoming" && String(editableTicket.op_type) === "harvest_incoming") {
      const { data: ticketLine, error: lineReadError } = await supabase
        .from("ticket_lines")
        .select("id")
        .eq("ticket_id", id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (lineReadError || !ticketLine?.id) {
        return NextResponse.json({ error: lineReadError?.message || "Ticket line not found" }, { status: 400 });
      }
      const { error: lineUpdateError } = await supabase
        .from("ticket_lines")
        .update({ quantity: net, net_line_weight_kg: net })
        .eq("id", ticketLine.id);
      if (lineUpdateError) {
        return NextResponse.json({ error: lineUpdateError.message }, { status: 400 });
      }
    }

    const { error } = await supabase.rpc("finalize_ticket", {
      p_ticket_id: id,
      p_actor_user_id: actorUserId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await ensureDryingStockAndApply(supabase, id, actorUserId);

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
