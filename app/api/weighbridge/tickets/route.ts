import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import type { TicketInput, TicketLineInput, WeighingInput } from "@/lib/types/weighbridge";

function buildTicketNo(companyId: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  return `WB-${companyId.slice(0, 6).toUpperCase()}-${stamp}`;
}

export async function GET(request: NextRequest) {
  try {
    const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
    const actorUserId = String(request.nextUrl.searchParams.get("userId") || "").trim();
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }
    if (!actorUserId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId,
      companyId,
      allowedRoles: ["admin", "agronomist", "warehouse", "weighman"],
    });
    const { data, error } = await supabase
      .from("tickets")
      .select(`
        *,
        lines:ticket_lines(id, product_id, quantity, uom, product_name_snapshot, variety_id, reproduction_id, products:product_id(name))
      `)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const tickets = (data || []).map((row: any) => ({
      ...row,
      lines: (row.lines || []).map((line: any) => ({
        id: String(line.id),
        product_id: String(line.product_id),
        quantity: Number(line.quantity || 0),
        uom: String(line.uom || "kg"),
        product_name: String(line.product_name_snapshot || line.products?.name || "-"),
        variety_id: line.variety_id ? String(line.variety_id) : null,
        reproduction_id: line.reproduction_id ? String(line.reproduction_id) : null,
      })),
    }));

    return NextResponse.json({ tickets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ticket = (body?.ticket || {}) as TicketInput;
    const lines = (Array.isArray(body?.lines) ? body.lines : []) as TicketLineInput[];
    const weighings = (Array.isArray(body?.weighings) ? body.weighings : []) as WeighingInput[];

    if (!ticket.company_id || !ticket.created_by) {
      return NextResponse.json({ error: "company_id and created_by are required" }, { status: 400 });
    }
    if (!ticket.ticket_type || !ticket.op_type || !ticket.direction) {
      return NextResponse.json({ error: "ticket_type, op_type and direction are required" }, { status: 400 });
    }
    if (!ticket.source_kind || !ticket.destination_kind) {
      return NextResponse.json({ error: "source_kind and destination_kind are required" }, { status: 400 });
    }
    if (!ticket.vehicle_id) {
      return NextResponse.json({ error: "vehicle_id is required" }, { status: 400 });
    }
    if (ticket.direction === "processing" && String(ticket.op_type || "").toLowerCase() === "drying") {
      if (!ticket.processing_point_from_id) {
        return NextResponse.json({ error: "processing_point_from_id is required for drying" }, { status: 400 });
      }
    }
    if (!lines.length) {
      return NextResponse.json({ error: "At least one ticket line is required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: ticket.created_by,
      companyId: ticket.company_id,
      allowedRoles: ["admin", "warehouse", "weighman"],
    });

    const { data: vehicle, error: vehicleError } = await supabase
      .from("reference_vehicles")
      .select("id, name, plate_number, status, is_active, archived")
      .eq("company_id", ticket.company_id)
      .eq("id", ticket.vehicle_id)
      .maybeSingle();

    if (vehicleError || !vehicle?.id) {
      return NextResponse.json({ error: "Vehicle not found in current company" }, { status: 400 });
    }
    if (!vehicle.is_active || vehicle.archived) {
      return NextResponse.json({ error: "Vehicle is inactive or archived" }, { status: 400 });
    }

    const { data: activeByVehicle, error: activeByVehicleError } = await supabase
      .from("tickets")
      .select("id, ticket_no")
      .eq("company_id", ticket.company_id)
      .eq("vehicle_id", ticket.vehicle_id)
      .in("status", ["draft", "active", "ready_to_close"])
      .limit(1);

    if (activeByVehicleError) {
      return NextResponse.json({ error: activeByVehicleError.message }, { status: 400 });
    }
    if ((activeByVehicle || []).length > 0) {
      return NextResponse.json({ error: "This vehicle already has an active ticket" }, { status: 400 });
    }
    const ticketNo = buildTicketNo(ticket.company_id);

    const { data: createdTicket, error: ticketError } = await supabase
      .from("tickets")
      .insert({
        ...ticket,
        ticket_no: ticketNo,
        status: "active",
      })
      .select("*")
      .single();

    if (ticketError || !createdTicket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Failed to create ticket" }, { status: 400 });
    }

    const productsMap = new Map<string, string>();
    const productIds = lines.map((line) => line.product_id).filter(Boolean);
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from("products")
        .select("id, name")
        .in("id", productIds)
        .eq("company_id", ticket.company_id);
      for (const p of products || []) {
        productsMap.set(String((p as any).id), String((p as any).name));
      }
    }

    const linesPayload = lines.map((line) => ({
      ticket_id: createdTicket.id,
      company_id: ticket.company_id,
      product_id: line.product_id,
      quantity: Number(line.quantity || 0),
      uom: line.uom || "kg",
      product_name_snapshot: productsMap.get(line.product_id) || null,
      notes: line.notes || null,
      net_line_weight_kg:
        line.net_line_weight_kg == null ? null : Number(line.net_line_weight_kg),
      moisture_percent: line.moisture_percent ?? null,
      dockage_percent: line.dockage_percent ?? null,
      dirt_tare_percent: line.dirt_tare_percent ?? null,
      class_grade: line.class_grade ?? null,
      variety_id: line.variety_id ?? null,
      reproduction_id: line.reproduction_id ?? null,
    }));

    const { error: linesError } = await supabase.from("ticket_lines").insert(linesPayload);
    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 400 });
    }

    if (weighings.length > 0) {
      const weighingsPayload = weighings.map((item) => ({
        ticket_id: createdTicket.id,
        company_id: ticket.company_id,
        weighing_no: item.weighing_no,
        measured_weight_kg: Number(item.measured_weight_kg || 0),
        measured_at: item.measured_at || new Date().toISOString(),
        device_source: item.device_source || "manual",
        operator_user_id: item.operator_user_id || ticket.created_by,
        comment: item.comment || null,
      }));
      const { error: weighingsError } = await supabase.from("ticket_weighings").insert(weighingsPayload);
      if (weighingsError) {
        return NextResponse.json({ error: weighingsError.message }, { status: 400 });
      }
    }

    await supabase
      .from("reference_vehicles")
      .update({ status: "in_trip" })
      .eq("id", ticket.vehicle_id)
      .eq("company_id", ticket.company_id);

    return NextResponse.json({ ticket: createdTicket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
