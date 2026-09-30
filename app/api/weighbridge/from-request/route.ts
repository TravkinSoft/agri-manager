import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";

function buildTicketNo(companyId: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  return `WB-${companyId.slice(0, 6).toUpperCase()}-${stamp}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestId = String(body?.requestId || "").trim();
    const sourceWarehouseId = String(body?.sourceWarehouseId || "").trim();
    const vehicleId = String(body?.vehicleId || "").trim() || null;
    if (!requestId || !sourceWarehouseId) {
      return NextResponse.json(
        { error: "requestId and sourceWarehouseId are required" },
        { status: 400 }
      );
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
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
    if (String(reqRow.company_id || "") !== companyId) {
      return NextResponse.json({ error: "Issue request does not belong to actor company scope" }, { status: 403 });
    }

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

    const { data: products } = await supabase
      .from("products")
      .select("id, name")
      .in("id", (reqRow.items || []).map((item: any) => item.product_id))
      .eq("company_id", reqRow.company_id);
    const productById = new Map<string, string>();
    (products || []).forEach((item: any) => productById.set(String(item.id), String(item.name)));

    const lines: any[] = [];
    for (const item of reqRow.items || []) {
      const contract = await resolveWarehouseStockContract(supabase, {
        companyId: reqRow.company_id,
        productId: item.product_id,
        quantity: Number(item.required_quantity || 0),
        inputUom: item.unit,
        event: "field_issue",
      });
      lines.push({
        company_id: reqRow.company_id,
        product_id: item.product_id,
        product_name_snapshot: productById.get(String(item.product_id)) || null,
        uom: contract.baseUom,
        quantity: contract.baseQuantity,
        batch_class: contract.batchClass,
        mass_kg: contract.massKg,
        density_kg_per_l: contract.densityKgPerL,
        density_unit: contract.densityUnit,
        density_source: contract.densitySource,
        density_verification_status: contract.densityVerificationStatus,
        density_verified_at: contract.densityVerifiedAt,
        unit_source: contract.unitSource,
        unit_contract_version: contract.unitContractVersion,
        operation_line_id: reqRow.operation_line_id || null,
        notes: `From warehouse request ${reqRow.request_number}`,
      });
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
        created_by: actor.id,
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

    if (lines.length > 0) {
      const ticketLines = lines.map((line) => ({ ...line, ticket_id: ticket.id }));
      const { error: linesError } = await supabase.from("ticket_lines").insert(ticketLines);
      if (linesError) {
        await supabase.from("tickets").delete().eq("id", ticket.id).eq("company_id", reqRow.company_id);
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
