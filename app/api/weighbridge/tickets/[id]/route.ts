import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_READ_ROLES, WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { validateHarvestWeights } from "@/lib/weighbridge/harvest-contract";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const timing = { authMs: 0, dbMs: 0, renderMs: 0, totalMs: 0 };
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }

    const authStartedAt = Date.now();
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    timing.authMs = Date.now() - authStartedAt;
    const dbStartedAt = Date.now();
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("*")
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
            ? supabase.from("crops").select("name,name_ru,name_kz,name_en,slug").eq("id", allocation.crop_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
          allocation.variety_id
            ? supabase.from("varieties").select("name").eq("id", allocation.variety_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
          allocation.reproduction_id
            ? supabase.from("seed_reproductions").select("name,name_ru,name_kz,name_en,code").eq("id", allocation.reproduction_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
        ]);
        const cropName = localizedName((cropRes as any)?.data, "ru");
        const varietyName = brandName((varietyRes as any)?.data);
        const reproductionName = localizedName((reproductionRes as any)?.data, "ru", ["name", "code"]);
        const area = Number((allocation as any).area || 0);
        cropStructureAllocationLabel = [
          [cropName, varietyName, reproductionName].filter(Boolean).join(" / "),
          area > 0 ? `${area.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га` : "",
        ].filter(Boolean).join(" • ") || null;
      }
    }

    const [companyRes, fieldRes, warehouseFromRes, warehouseToRes, supplierRes, buyerRes, vehicleRes, driverRes, creatorRes] = await Promise.all([
      supabase.from("companies").select("id,name").eq("id", ticket.company_id).maybeSingle(),
      ticket.field_id
        ? supabase.from("fields").select("id,name").eq("company_id", companyId).eq("id", ticket.field_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.warehouse_from_id
        ? supabase.from("warehouses").select("id,name").eq("company_id", companyId).eq("id", ticket.warehouse_from_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.warehouse_to_id
        ? supabase.from("warehouses").select("id,name").eq("company_id", companyId).eq("id", ticket.warehouse_to_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.supplier_id
        ? supabase.from("counterparties").select("id,name").eq("company_id", companyId).eq("id", ticket.supplier_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.buyer_id
        ? supabase.from("counterparties").select("id,name").eq("company_id", companyId).eq("id", ticket.buyer_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.vehicle_id
        ? supabase.from("reference_vehicles").select("id,name,plate_number").eq("company_id", companyId).eq("id", ticket.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.driver_id
        ? supabase.from("profiles").select("id,full_name,email").eq("id", ticket.driver_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.created_by
        ? supabase.from("profiles").select("id,full_name,email").eq("id", ticket.created_by).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    const { data: lines } = await supabase
      .from("ticket_lines")
      .select("*")
      .eq("ticket_id", id);
    const { data: weighings } = await supabase
      .from("ticket_weighings")
      .select("*")
      .eq("ticket_id", id)
      .order("weighing_no", { ascending: true });

    const productIds = Array.from(new Set((lines || []).map((line: any) => line.product_id).filter(Boolean).map(String)));
    const varietyIds = Array.from(new Set((lines || []).map((line: any) => line.variety_id).filter(Boolean).map(String)));
    const reproductionIds = Array.from(new Set((lines || []).map((line: any) => line.reproduction_id).filter(Boolean).map(String)));
    const lineWarehouseIds = Array.from(
      new Set(
        (lines || [])
          .flatMap((line: any) => [line.warehouse_from_id, line.warehouse_to_id])
          .filter(Boolean)
          .map(String)
      )
    );
    const [productsRes, varietiesRes, reproductionsRes, lineWarehousesRes] = await Promise.all([
      productIds.length
        ? supabase.from("products").select("id,name,trade_name,normalized_name").in("id", productIds)
        : Promise.resolve({ data: [] } as any),
      varietyIds.length
        ? supabase.from("varieties").select("id,name").in("id", varietyIds)
        : Promise.resolve({ data: [] } as any),
      reproductionIds.length
        ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds)
        : Promise.resolve({ data: [] } as any),
      lineWarehouseIds.length
        ? supabase.from("warehouses").select("id,name").eq("company_id", companyId).in("id", lineWarehouseIds)
        : Promise.resolve({ data: [] } as any),
    ]);
    const productById = new Map<string, any>((productsRes.data || []).map((item: any) => [String(item.id), item]));
    const varietyById = new Map<string, any>((varietiesRes.data || []).map((item: any) => [String(item.id), item]));
    const reproductionById = new Map<string, any>((reproductionsRes.data || []).map((item: any) => [String(item.id), item]));
    const lineWarehouseById = new Map<string, any>((lineWarehousesRes.data || []).map((item: any) => [String(item.id), item]));
    const company = (companyRes as any)?.data || null;
    const field = (fieldRes as any)?.data || null;
    const warehouseFrom = (warehouseFromRes as any)?.data || null;
    const warehouseTo = (warehouseToRes as any)?.data || null;
    const supplier = (supplierRes as any)?.data || null;
    const buyer = (buyerRes as any)?.data || null;
    const vehicle = (vehicleRes as any)?.data || null;
    const driver = (driverRes as any)?.data || null;
    const creator = (creatorRes as any)?.data || null;
    timing.dbMs = Date.now() - dbStartedAt;
    timing.renderMs = Date.now() - startedAt - timing.authMs - timing.dbMs;
    timing.totalMs = Date.now() - startedAt;

    const enrichedLines = (lines || []).map((line: any) => ({
      ...line,
      product_name: line.product_name_snapshot || brandName(productById.get(String(line.product_id))) || "-",
      variety_name: line.variety_name_snapshot || brandName(varietyById.get(String(line.variety_id))) || "-",
      reproduction_name: line.reproduction_name_snapshot || localizedName(reproductionById.get(String(line.reproduction_id)), "ru", ["name", "code"]) || "-",
      warehouse_from_name: line.warehouse_from_id ? lineWarehouseById.get(String(line.warehouse_from_id))?.name || null : null,
      warehouse_to_name: line.warehouse_to_id ? lineWarehouseById.get(String(line.warehouse_to_id))?.name || null : null,
    }));

    return NextResponse.json({
      ticket: {
        ...ticket,
        company_name: company?.name || null,
        field_name_snapshot: field?.name || null,
        warehouse_from_name_snapshot: warehouseFrom?.name || null,
        warehouse_to_name_snapshot: warehouseTo?.name || null,
        supplier_name_snapshot: supplier?.name || null,
        buyer_name_snapshot: buyer?.name || null,
        vehicle_name_snapshot: vehicle?.name || null,
        vehicle_plate_snapshot: vehicle?.plate_number || null,
        driver_name_snapshot: driver?.full_name || driver?.email || null,
        created_by_name_snapshot: creator?.full_name || creator?.email || null,
        crop_structure_allocation_label: cropStructureAllocationLabel,
        lines: enrichedLines,
      },
      lines: enrichedLines,
      weighings: weighings || [],
      debug: timing,
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
        return NextResponse.json({ error: "Брутто должно быть неотрицательным числом." }, { status: 400 });
      }
      patch.gross_weight_kg = value;
    }

    if (body?.tare_weight_kg !== undefined) {
      const value = Number(body.tare_weight_kg);
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "Тара должна быть неотрицательным числом." }, { status: 400 });
      }
      patch.tare_weight_kg = value;
    }

    const nextGross =
      patch.gross_weight_kg !== undefined
        ? Number(patch.gross_weight_kg)
        : ticket.gross_weight_kg == null
          ? null
          : Number(ticket.gross_weight_kg);
    const nextTare =
      patch.tare_weight_kg !== undefined
        ? Number(patch.tare_weight_kg)
        : ticket.tare_weight_kg == null
          ? null
          : Number(ticket.tare_weight_kg);

    if (nextGross != null && nextTare != null) {
      const weightValidation = validateHarvestWeights(nextGross, nextTare);
      if (!weightValidation.ok) {
        return NextResponse.json({ error: weightValidation.message }, { status: 400 });
      }
      patch.net_weight_kg = weightValidation.net;
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

    if (ticket.op_type === "harvest_incoming" && patch.net_weight_kg !== undefined) {
      const { error: atomicUpdateError } = await supabase.rpc("set_harvest_ticket_weights_for_session_v1", {
        p_ticket_id: id,
        p_patch: patch,
      });
      if (atomicUpdateError) {
        return NextResponse.json({ error: atomicUpdateError.message }, { status: 400 });
      }
      const { data: updated, error: updatedError } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", id)
        .eq("company_id", companyId)
        .single();
      if (updatedError || !updated?.id) {
        return NextResponse.json({ error: updatedError?.message || "Ticket not found after update" }, { status: 400 });
      }
      return NextResponse.json({ ticket: updated });
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
