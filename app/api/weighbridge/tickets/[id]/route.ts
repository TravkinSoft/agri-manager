import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_READ_ROLES, WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, recordWeighbridgeOperatorActivity, requireWeighbridgeOperatorSession, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { validateHarvestWeights } from "@/lib/weighbridge/harvest-contract";
import { parseStrictWeightKg } from "@/lib/weighbridge/weight-input";
import { enrichTicketOperatorAttribution } from "@/lib/server/weighbridge-ticket-attribution";
import { resolveTransportIdentity } from "@/lib/weighbridge/transport";

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
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
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

    const [companyRes, fieldRes, warehouseFromRes, warehouseToRes, supplierRes, buyerRes, vehicleRes, machineRes, driverPersonRes, legacyDriverRes, driverProfileRes] = await Promise.all([
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
        ? supabase.from("reference_vehicles").select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name").eq("company_id", companyId).eq("id", ticket.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.vehicle_id
        ? supabase.from("reference_machines").select("id,name,full_name,brand,model,series,license_plate,source_raw_name").eq("company_id", companyId).eq("id", ticket.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.driver_id
        ? supabase.from("company_people").select("id,full_name").eq("company_id", companyId).eq("id", ticket.driver_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.driver_id
        ? supabase.from("reference_specialists").select("id,full_name,name_ru,name_kz,name_en").eq("company_id", companyId).eq("id", ticket.driver_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.driver_id
        ? supabase.from("profiles").select("id,full_name,email").eq("company_id", companyId).eq("id", ticket.driver_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    const [linesResult, weighingsResult, correctionAuditResult, correctionOfResult, replacementResult] = await Promise.all([
      supabase.from("ticket_lines").select("*").eq("ticket_id", id),
      supabase.from("ticket_weighings").select("*").eq("ticket_id", id).order("weighing_no", { ascending: true }),
      supabase.from("audit_log")
        .select("id,action,when_at,reason,old_values,new_values")
        .eq("company_id", companyId)
        .eq("entity_type", "weighbridge_ticket")
        .eq("entity_id", id)
        .in("action", ["open_ticket_corrected", "ticket_correction_started", "ticket_replaced"])
        .order("when_at", { ascending: false }),
      ticket.correction_of_ticket_id
        ? supabase.from("tickets").select("id,ticket_no,status").eq("company_id", companyId).eq("id", ticket.correction_of_ticket_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      ticket.replacement_ticket_id
        ? supabase.from("tickets").select("id,ticket_no,status").eq("company_id", companyId).eq("id", ticket.replacement_ticket_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);
    const lines = linesResult.data || [];
    const weighings = weighingsResult.data || [];

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
    const vehicle = (vehicleRes as any)?.data || (machineRes as any)?.data || null;
    const transportAudit = (ticket.audit_json?.transport || {}) as Record<string, unknown>;
    const transportIdentity = resolveTransportIdentity({
      ...(vehicle || {}),
      name: vehicle?.name || transportAudit.vehicle_name_snapshot,
      plate: vehicle?.plate_number || vehicle?.license_plate || transportAudit.vehicle_plate_snapshot,
    });
    const driver =
      (driverPersonRes as any)?.data ||
      (legacyDriverRes as any)?.data ||
      (driverProfileRes as any)?.data ||
      null;
    timing.dbMs = Date.now() - dbStartedAt;
    timing.renderMs = Date.now() - startedAt - timing.authMs - timing.dbMs;
    timing.totalMs = Date.now() - startedAt;

    const enrichedLines = (lines || []).map((line: any) => ({
      ...line,
      product_name: line.product_name_snapshot || brandName(productById.get(String(line.product_id))) || "-",
      variety_name: line.variety_name_snapshot || brandName(varietyById.get(String(line.variety_id))) || "",
      reproduction_name: line.reproduction_name_snapshot || localizedName(reproductionById.get(String(line.reproduction_id)), "ru", ["name", "code"]) || "",
      warehouse_from_name: line.warehouse_from_id ? lineWarehouseById.get(String(line.warehouse_from_id))?.name || null : null,
      warehouse_to_name: line.warehouse_to_id ? lineWarehouseById.get(String(line.warehouse_to_id))?.name || null : null,
    }));

    const [attributedTicket] = await enrichTicketOperatorAttribution(supabase, companyId, [{
        ...ticket,
        company_name: company?.name || null,
        field_name_snapshot: field?.name || null,
        warehouse_from_name_snapshot: warehouseFrom?.name || null,
        warehouse_to_name_snapshot: warehouseTo?.name || null,
        supplier_name_snapshot: supplier?.name || null,
        buyer_name_snapshot: buyer?.name || null,
        vehicle_name_snapshot: transportIdentity.name || null,
        vehicle_plate_snapshot: transportIdentity.plate || null,
        trailer_id: transportAudit.trailer_id || null,
        trailer_name_snapshot: transportAudit.trailer_name_snapshot || null,
        trailer_plate_snapshot: transportAudit.trailer_plate_snapshot || null,
        driver_name_snapshot: driver?.name_ru || driver?.full_name || driver?.name_en || driver?.name_kz || driver?.email || null,
        crop_structure_allocation_label: cropStructureAllocationLabel,
        correction_of_ticket: correctionOfResult.data || null,
        replacement_ticket: replacementResult.data || null,
        correction_audit: correctionAuditResult.data || [],
        lines: enrichedLines,
      }], { includeTechnicalAudit: actor.role === "global_admin" });

    return NextResponse.json({
      ticket: attributedTicket,
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

    const operatorSession = ticket.weigh_method === "manual_override_with_reason"
      ? null
      : await requireWeighbridgeOperatorSession(request, { companyId, supabase });

    const patch: Record<string, unknown> = {};
    if (body?.gross_weight_kg !== undefined) {
      const parsed = parseStrictWeightKg(body.gross_weight_kg, "Брутто");
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.message }, { status: 400 });
      }
      if (parsed.value <= 0) return NextResponse.json({ error: "Брутто должно быть больше нуля." }, { status: 400 });
      patch.gross_weight_kg = parsed.value;
    }

    if (body?.tare_weight_kg !== undefined) {
      const parsed = parseStrictWeightKg(body.tare_weight_kg, "Тара");
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.message }, { status: 400 });
      }
      if (parsed.value <= 0 && ticket.weigh_method !== "manual_override_with_reason") {
        return NextResponse.json({ error: "Тара должна быть больше нуля." }, { status: 400 });
      }
      patch.tare_weight_kg = parsed.value;
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

    const hasMoisturePatch = body?.moisture_percent !== undefined;
    let harvestMoisture: number | null = null;
    if (hasMoisturePatch) {
      const rawMoisture = body?.moisture_percent;
      harvestMoisture = rawMoisture == null || String(rawMoisture).trim() === ""
        ? null
        : Number(String(rawMoisture).trim().replace(",", "."));
      if (harvestMoisture != null && (!Number.isFinite(harvestMoisture) || harvestMoisture <= 0 || harvestMoisture >= 100)) {
        return NextResponse.json(
          { error: "Влажность должна быть больше 0 и меньше 100 %." },
          { status: 400 }
        );
      }
    }

    if (nextGross != null && nextTare != null && ticket.weigh_method !== "manual_override_with_reason") {
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

    let harvestLineId: string | null = null;
    if (hasMoisturePatch) {
      const { data: harvestLines, error: harvestLinesError } = await supabase
        .from("ticket_lines")
        .select("id")
        .eq("ticket_id", id)
        .eq("company_id", companyId)
        .limit(2);
      if (harvestLinesError || (harvestLines || []).length !== 1) {
        return NextResponse.json(
          { error: harvestLinesError?.message || "Талон должен содержать ровно одну строку для сохранения влажности." },
          { status: 400 }
        );
      }
      harvestLineId = String((harvestLines || [])[0]?.id || "");
    }

    if (Object.keys(patch).length === 0 && !hasMoisturePatch) {
      return NextResponse.json({ error: "No patch fields provided" }, { status: 400 });
    }

    const requiresAtomicWeightUpdate =
      ticket.op_type === "harvest_incoming" || Boolean(ticket.correction_of_ticket_id);
    if (requiresAtomicWeightUpdate && (patch.gross_weight_kg !== undefined || patch.tare_weight_kg !== undefined)) {
      const { data: atomicUpdate, error: atomicUpdateError } = await supabase.rpc("update_open_weighbridge_ticket_v1", {
        p_ticket_id: id,
        p_patch: patch,
        p_tare_variance_confirmed: Boolean(body?.confirm_tare_variance),
        p_operator_person_id: operatorSession?.operator.id || null,
        p_shift_id: operatorSession?.shift.id || null,
        p_reason: String(body?.reason || "").trim() || null,
      });
      if (atomicUpdateError) {
        return NextResponse.json({ error: atomicUpdateError.message }, { status: 400 });
      }
      if ((atomicUpdate as any)?.requires_confirmation) {
        return NextResponse.json({
          error: "Проверьте тару.",
          ...(atomicUpdate as Record<string, unknown>),
        }, { status: 409 });
      }

      if (hasMoisturePatch && harvestLineId) {
        const { error: moistureError } = await supabase
          .from("ticket_lines")
          .update({ moisture_percent: harvestMoisture })
          .eq("id", harvestLineId)
          .eq("company_id", companyId);
        if (moistureError) {
          return NextResponse.json({ error: moistureError.message }, { status: 400 });
        }
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
      if (operatorSession) {
        await recordWeighbridgeOperatorActivity(
          request,
          { companyId, supabase },
          patch.tare_weight_kg !== undefined ? "tare_finalize" : "gross"
        );
      }
      return NextResponse.json({ ticket: updated });
    }

    if (hasMoisturePatch && harvestLineId) {
      const { error: moistureError } = await supabase
        .from("ticket_lines")
        .update({ moisture_percent: harvestMoisture })
        .eq("id", harvestLineId)
        .eq("company_id", companyId);
      if (moistureError) {
        return NextResponse.json({ error: moistureError.message }, { status: 400 });
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({
        ticket: {
          ...ticket,
          lines: [{ id: harvestLineId, moisture_percent: harvestMoisture }],
        },
      });
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

    if (operatorSession) {
      await recordWeighbridgeOperatorActivity(request, { companyId, supabase }, "ticket_correction");
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
