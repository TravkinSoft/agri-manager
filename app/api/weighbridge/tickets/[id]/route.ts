import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { WEIGHBRIDGE_READ_ROLES, WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }

    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select(`
        *,
        field:field_id(id,name),
        warehouse_from:warehouse_from_id(id,name),
        warehouse_to:warehouse_to_id(id,name),
        vehicle:vehicle_id(id,name,plate_number),
        driver:driver_id(id,full_name,email),
        creator:created_by(id,full_name,email)
      `)
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (ticketError || !ticket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Ticket not found" }, { status: 404 });
    }

    let cropStructureAllocationLabel: string | null = null;
    if (ticket.crop_structure_allocation_id) {
      const { data: allocation } = await supabase
        .from("crop_structure")
        .select("id,area,crop_id,variety_id,reproduction_id")
        .eq("id", ticket.crop_structure_allocation_id)
        .eq("company_id", ticket.company_id)
        .maybeSingle();

      if (allocation?.id) {
        const [cropRes, varietyRes, reproductionRes] = await Promise.all([
          allocation.crop_id
            ? supabase.from("crops").select("name").eq("id", allocation.crop_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
          allocation.variety_id
            ? supabase.from("varieties").select("name").eq("id", allocation.variety_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
          allocation.reproduction_id
            ? supabase.from("seed_reproductions").select("name").eq("id", allocation.reproduction_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
        ]);
        const cropName = String((cropRes as any)?.data?.name || "").trim();
        const varietyName = String((varietyRes as any)?.data?.name || "").trim();
        const reproductionName = String((reproductionRes as any)?.data?.name || "").trim();
        const area = Number((allocation as any).area || 0);
        cropStructureAllocationLabel = [
          [cropName, varietyName, reproductionName].filter(Boolean).join(" / "),
          area > 0 ? `${area.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га` : "",
        ].filter(Boolean).join(" • ") || null;
      }
    }

    const { data: lines } = await supabase
      .from("ticket_lines")
      .select(`
        *,
        products:product_id(name),
        varieties:variety_id(name),
        reproductions:reproduction_id(name)
      `)
      .eq("ticket_id", id);
    const { data: weighings } = await supabase
      .from("ticket_weighings")
      .select("*")
      .eq("ticket_id", id)
      .order("weighing_no", { ascending: true });

    return NextResponse.json({
      ticket: {
        ...ticket,
        field_name_snapshot: ticket.field?.name || null,
        warehouse_from_name_snapshot: ticket.warehouse_from?.name || null,
        warehouse_to_name_snapshot: ticket.warehouse_to?.name || null,
        vehicle_name_snapshot: ticket.vehicle?.name || null,
        vehicle_plate_snapshot: ticket.vehicle?.plate_number || null,
        driver_name_snapshot: ticket.driver?.full_name || ticket.driver?.email || null,
        created_by_name_snapshot: ticket.creator?.full_name || ticket.creator?.email || null,
        crop_structure_allocation_label: cropStructureAllocationLabel,
      },
      lines: (lines || []).map((line: any) => ({
        ...line,
        product_name: line.product_name_snapshot || line.products?.name || "-",
        variety_name: line.variety_name_snapshot || line.varieties?.name || "-",
        reproduction_name: line.reproduction_name_snapshot || line.reproductions?.name || "-",
      })),
      weighings: weighings || [],
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }

    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (ticketError || !ticket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Ticket not found" }, { status: 404 });
    }

    if (ticket.status === "finalized" || ticket.status === "voided") {
      return NextResponse.json({ error: "Finalized/voided ticket is read-only" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body?.gross_weight_kg !== undefined) {
      const value = Number(body.gross_weight_kg);
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "gross_weight_kg must be a non-negative number" }, { status: 400 });
      }
      patch.gross_weight_kg = value;
    }

    if (body?.tare_weight_kg !== undefined) {
      const value = Number(body.tare_weight_kg);
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "tare_weight_kg must be a non-negative number" }, { status: 400 });
      }
      patch.tare_weight_kg = value;
    }

    if (body?.notes !== undefined) {
      patch.notes = String(body.notes || "").trim() || null;
    }

    if (body?.status !== undefined) {
      const status = String(body.status || "").trim();
      if (!["draft", "active", "ready_to_close"].includes(status)) {
        return NextResponse.json({ error: "Invalid status for patch update" }, { status: 400 });
      }
      patch.status = status;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No patch fields provided" }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from("tickets")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
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
