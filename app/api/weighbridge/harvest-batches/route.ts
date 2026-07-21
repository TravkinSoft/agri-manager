import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { calculateHarvestBatchMetrics } from "@/lib/weighbridge/harvest-batch-math";

const ids = (values: unknown[]) => Array.from(new Set(values.map((value) => String(value || "")).filter(Boolean)));

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const { data: batchRows, error: batchError } = await supabase
      .from("inventory_batches")
      .select("id,batch_code,product_id,crop_id,variety_id,reproduction_id,source_field_id,source_ticket_id,batch_class,origin_type")
      .eq("company_id", companyId)
      .eq("origin_type", "harvest")
      .order("created_at", { ascending: false })
      .limit(500);
    if (batchError) throw batchError;

    const batches = batchRows || [];
    if (!batches.length) return NextResponse.json({ batches: [] });

    const batchIds = ids(batches.map((row: any) => row.id));
    const sourceTicketIds = ids(batches.map((row: any) => row.source_ticket_id));
    const productIds = ids(batches.map((row: any) => row.product_id));
    const cropIds = ids(batches.map((row: any) => row.crop_id));
    const varietyIds = ids(batches.map((row: any) => row.variety_id));
    const reproductionIds = ids(batches.map((row: any) => row.reproduction_id));
    const fieldIds = ids(batches.map((row: any) => row.source_field_id));

    const [ticketsResult, linesResult, productsResult, cropsResult, varietiesResult, reproductionsResult, fieldsResult] = await Promise.all([
      supabase
        .from("tickets")
        .select("id,batch_id,op_type,warehouse_from_id,warehouse_to_id,field_id,net_weight_kg,status,is_finalized,is_voided")
        .eq("company_id", companyId)
        .in("batch_id", batchIds)
        .in("op_type", ["harvest_incoming", "weighbridge_impurities"]),
      sourceTicketIds.length
        ? supabase
            .from("ticket_lines")
            .select("ticket_id,operation_line_id")
            .eq("company_id", companyId)
            .in("ticket_id", sourceTicketIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length ? supabase.from("products").select("id,name,trade_name,normalized_name").in("id", productIds) : Promise.resolve({ data: [], error: null }),
      cropIds.length ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en").in("id", cropIds) : Promise.resolve({ data: [], error: null }),
      varietyIds.length ? supabase.from("varieties").select("id,name").in("id", varietyIds) : Promise.resolve({ data: [], error: null }),
      reproductionIds.length ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds) : Promise.resolve({ data: [], error: null }),
      fieldIds.length ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds) : Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = [ticketsResult, linesResult, productsResult, cropsResult, varietiesResult, reproductionsResult, fieldsResult]
      .map((result: any) => result.error)
      .find(Boolean);
    if (firstError) throw firstError;

    const sourceLineByTicket = new Map<string, any>();
    for (const line of linesResult.data || []) {
      if (!sourceLineByTicket.has(String((line as any).ticket_id))) {
        sourceLineByTicket.set(String((line as any).ticket_id), line);
      }
    }
    const operationLineIds = ids(Array.from(sourceLineByTicket.values()).map((line: any) => line.operation_line_id));
    const operationLinesResult = operationLineIds.length
      ? await supabase
          .from("operation_lines")
          .select("id,planned_area_ha,actual_area_ha")
          .eq("company_id", companyId)
          .in("id", operationLineIds)
      : { data: [], error: null };
    if (operationLinesResult.error) throw operationLinesResult.error;

    const ticketRows = (ticketsResult.data || []) as any[];
    const finalized = ticketRows.filter((ticket) => ticket.is_finalized && ticket.status === "finalized" && !ticket.is_voided);
    const warehouseIds = ids(finalized.map((ticket) => ticket.op_type === "harvest_incoming" ? ticket.warehouse_to_id : ticket.warehouse_from_id));
    const warehousesResult = warehouseIds.length
      ? await supabase
          .from("warehouses")
          .select("id,name,name_ru,name_kz,name_en,warehouse_type")
          .eq("company_id", companyId)
          .in("id", warehouseIds)
      : { data: [], error: null };
    if (warehousesResult.error) throw warehousesResult.error;

    const mapById = (rows: any[]) => new Map(rows.map((row) => [String(row.id), row]));
    const productById = mapById((productsResult.data || []) as any[]);
    const cropById = mapById((cropsResult.data || []) as any[]);
    const varietyById = mapById((varietiesResult.data || []) as any[]);
    const reproductionById = mapById((reproductionsResult.data || []) as any[]);
    const fieldById = mapById((fieldsResult.data || []) as any[]);
    const warehouseById = mapById((warehousesResult.data || []) as any[]);
    const operationLineById = mapById((operationLinesResult.data || []) as any[]);

    const summaries = batches.flatMap((batch: any) => {
      const batchTickets = finalized.filter((ticket) => String(ticket.batch_id || "") === String(batch.id));
      const incoming = batchTickets.filter((ticket) => ticket.op_type === "harvest_incoming");
      if (!incoming.length) return [];
      const removed = batchTickets.filter((ticket) => ticket.op_type === "weighbridge_impurities");
      const receivedKg = incoming.reduce((sum, ticket) => sum + Number(ticket.net_weight_kg || 0), 0);
      const removedKg = removed.reduce((sum, ticket) => sum + Number(ticket.net_weight_kg || 0), 0);
      const sourceTicketId = String(batch.source_ticket_id || incoming[0]?.id || "");
      const sourceLine = sourceLineByTicket.get(sourceTicketId);
      const operationLine = sourceLine?.operation_line_id
        ? operationLineById.get(String(sourceLine.operation_line_id))
        : null;
      const harvestedAreaHa = Number(operationLine?.actual_area_ha || operationLine?.planned_area_ha || 0) || null;
      const metrics = calculateHarvestBatchMetrics(receivedKg, removedKg, harvestedAreaHa);
      const warehouseId = String(incoming[0]?.warehouse_to_id || "");
      const warehouse = warehouseById.get(warehouseId);
      const product = productById.get(String(batch.product_id || ""));
      const crop = cropById.get(String(batch.crop_id || ""));
      const variety = varietyById.get(String(batch.variety_id || ""));
      const reproduction = reproductionById.get(String(batch.reproduction_id || ""));
      const field = fieldById.get(String(batch.source_field_id || incoming[0]?.field_id || ""));

      return [{
        id: String(batch.id),
        batchCode: String(batch.batch_code || batch.id),
        warehouseId,
        warehouseName: localizedName(warehouse, "ru", ["name"]) || "Склад урожая",
        productId: String(batch.product_id || ""),
        productName: brandName(product) || localizedName(crop, "ru", ["name"]) || "Урожай",
        cropId: batch.crop_id ? String(batch.crop_id) : null,
        cropName: localizedName(crop, "ru", ["name"]) || "Культура не указана",
        varietyId: batch.variety_id ? String(batch.variety_id) : null,
        varietyName: brandName(variety) || "Без сорта",
        reproductionId: batch.reproduction_id ? String(batch.reproduction_id) : null,
        reproductionName: localizedName(reproduction, "ru", ["name", "code"]) || "Без репродукции",
        fieldId: batch.source_field_id ? String(batch.source_field_id) : null,
        fieldName: String(field?.name || "Поле не указано"),
        operationLineId: sourceLine?.operation_line_id ? String(sourceLine.operation_line_id) : null,
        ...metrics,
        harvestedAreaHa,
      }];
    });

    return NextResponse.json({ batches: summaries });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить партии урожая" },
      { status: 500 }
    );
  }
}
