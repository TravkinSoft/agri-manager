import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { WEIGHBRIDGE_READ_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { formatWeightNumber } from "@/lib/weighbridge/weight-format";
import { enrichTicketOperatorAttribution } from "@/lib/server/weighbridge-ticket-attribution";
import { ticketOperatorFacts } from "@/lib/weighbridge/ticket-operator";
import { transportPickerLabel } from "@/lib/weighbridge/transport";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

function escapePdfText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function toPdfBytes(lines: string[]) {
  const pageWidth = 595;
  const pageHeight = 842;
  const left = 48;
  let y = 794;
  const lineHeight = 16;
  const streamLines: string[] = ["BT", "/F1 12 Tf"];
  for (const line of lines) {
    streamLines.push(`1 0 0 1 ${left} ${y} Tm (${escapePdfText(line)}) Tj`);
    y -= lineHeight;
    if (y < 52) break;
  }
  streamLines.push("ET");
  const content = streamLines.join("\n");
  const contentLength = new TextEncoder().encode(content).length;

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${contentLength} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];

  let body = "";
  const xref: number[] = [0];
  for (const obj of objects) {
    xref.push(body.length);
    body += obj;
  }
  const xrefStart = body.length;
  let xrefTable = `xref\n0 ${objects.length + 1}\n`;
  xrefTable += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    xrefTable += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const pdf = `%PDF-1.4\n${body}${xrefTable}${trailer}`;
  return new TextEncoder().encode(pdf);
}

function fmt(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
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

    const [{ data: lines }, { data: company }, { data: fields }, { data: warehouses }, { data: products }, { data: varieties }, { data: reproductions }, { data: people }, { data: legacyDrivers }, { data: drivers }, { data: vehicles }, { data: machines }, { data: counterparties }] = await Promise.all([
      supabase.from("ticket_lines").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
      supabase.from("companies").select("id,name").eq("id", ticket.company_id).maybeSingle(),
      supabase.from("fields").select("id,name").eq("company_id", ticket.company_id),
      supabase.from("warehouses").select("id,name").eq("company_id", ticket.company_id),
      supabase.from("products").select("id,name,trade_name,normalized_name,company_id").or(`company_id.eq.${ticket.company_id},company_id.is.null`),
      supabase.from("varieties").select("id,name,company_id").or(`company_id.eq.${ticket.company_id},company_id.is.null`),
      supabase.from("seed_reproductions").select("id,name,company_id").or(`company_id.eq.${ticket.company_id},company_id.is.null`),
      supabase.from("company_people").select("id,full_name").eq("company_id", ticket.company_id),
      supabase.from("reference_specialists").select("id,full_name,name_ru,name_kz,name_en").eq("company_id", ticket.company_id),
      supabase.from("profiles").select("id,full_name,email").eq("company_id", ticket.company_id),
      supabase.from("reference_vehicles").select("id,name,plate_number").eq("company_id", ticket.company_id),
      supabase.from("reference_machines").select("id,name,license_plate").eq("company_id", ticket.company_id),
      supabase.from("counterparties").select("id,name").eq("company_id", ticket.company_id),
    ]);

    const [attributedTicket] = await enrichTicketOperatorAttribution(supabase, companyId, [ticket], {
      includeTechnicalAudit: actor.role === "global_admin",
    });
    const operatorFacts = ticketOperatorFacts(attributedTicket as WeighbridgeTicket);

    const ticketLines = (lines || []) as any[];
    const line = ticketLines[0] as any;
    const isHarvest = String(ticket.op_type || "") === "harvest_incoming";
    const isSupplierReceipt = String(ticket.op_type || "") === "supplier_receipt";
    const isDirectSupplierReceipt = isSupplierReceipt && String(ticket.receipt_mode || "") === "direct";
    const isTransfer = String(ticket.direction || "") === "transfer" || String(ticket.op_type || "") === "warehouse_transfer";
    const isShipment = String(ticket.op_type || "") === "shipment_outbound";
    const fieldName = (fields || []).find((x: any) => x.id === ticket.field_id)?.name || "-";
    const fromWarehouse = (warehouses || []).find((x: any) => x.id === ticket.warehouse_from_id)?.name || "-";
    const toWarehouse = (warehouses || []).find((x: any) => x.id === ticket.warehouse_to_id)?.name || "-";
    const counterpartyName = (id: string | null | undefined) =>
      id ? (counterparties || []).find((x: any) => x.id === id)?.name || "-" : "-";
    const supplierName = counterpartyName(ticket.supplier_id);
    const buyerName = counterpartyName(ticket.buyer_id);
    const productName = (pdfLine: any) =>
      pdfLine
        ? pdfLine.product_name_snapshot ||
          (products || []).find((x: any) => x.id === pdfLine.product_id)?.trade_name ||
          (products || []).find((x: any) => x.id === pdfLine.product_id)?.name ||
          "-"
        : "-";
    const varietyName = line?.variety_id
      ? (varieties || []).find((x: any) => x.id === line.variety_id)?.name || "-"
      : "-";
    const reproductionName = line?.reproduction_id
      ? (reproductions || []).find((x: any) => x.id === line.reproduction_id)?.name || "-"
      : "-";
    const driverName = ticket.driver_id
      ? (people || []).find((x: any) => x.id === ticket.driver_id)?.full_name ||
        (legacyDrivers || []).find((x: any) => x.id === ticket.driver_id)?.name_ru ||
        (legacyDrivers || []).find((x: any) => x.id === ticket.driver_id)?.full_name ||
        (legacyDrivers || []).find((x: any) => x.id === ticket.driver_id)?.name_en ||
        (legacyDrivers || []).find((x: any) => x.id === ticket.driver_id)?.name_kz ||
        (drivers || []).find((x: any) => x.id === ticket.driver_id)?.full_name ||
        (drivers || []).find((x: any) => x.id === ticket.driver_id)?.email ||
        "-"
      : "-";
    const vehicle: any = ticket.vehicle_id
      ? (vehicles || []).find((x: any) => x.id === ticket.vehicle_id) ||
        (machines || []).find((x: any) => x.id === ticket.vehicle_id)
      : null;
    const vehicleName = transportPickerLabel({
      name: vehicle?.name || ticket.vehicle_name_snapshot || "",
      plate: vehicle?.plate_number || vehicle?.license_plate || ticket.vehicle_plate_snapshot || "",
    }) || "-";
    const transportAudit = (ticket.audit_json?.transport || {}) as Record<string, unknown>;
    const trailerName = transportAudit.trailer_name_snapshot
      ? `${String(transportAudit.trailer_name_snapshot)}${transportAudit.trailer_plate_snapshot ? ` (${String(transportAudit.trailer_plate_snapshot)})` : ""}`
      : "-";
    const companyName = String((company as any)?.name || "").trim() || "Company";

    const contextLabel = isSupplierReceipt
      ? `Supplier: ${supplierName}`
      : isTransfer
        ? `Transfer: ${fromWarehouse} -> ${toWarehouse}`
        : isShipment
          ? `Shipment: ${fromWarehouse} -> ${buyerName}`
          : `Field: ${fieldName}`;

    const operationLabel = isSupplierReceipt
      ? "Supplier receipt"
      : isTransfer
        ? "Warehouse transfer"
        : isShipment
          ? "Shipment"
          : isHarvest
            ? "Harvest from field"
            : ticket.op_type || "-";

    const productLinePdf = ticketLines.map((item: any, index: number) => {
      const lineWarehouse =
        (warehouses || []).find((x: any) => x.id === item.warehouse_to_id)?.name ||
        (warehouses || []).find((x: any) => x.id === item.warehouse_from_id)?.name ||
        toWarehouse ||
        fromWarehouse ||
        "-";
      const price = item.unit_price == null ? "" : `, price: ${item.unit_price}`;
      const lot = item.lot_id ? `, lot: ${item.lot_id}` : "";
      const warehouse = lineWarehouse && lineWarehouse !== "-" ? `, warehouse: ${lineWarehouse}` : "";
      return `${index + 1}. ${productName(item)} - ${item.quantity ?? "-"} ${item.uom || "legacy/unknown"}${warehouse}${lot}${price}`;
    });

    const directSupplierPdf = [
      "AgriManager",
      "Supplier Receipt Document",
      "----------------------------------------",
      `Company: ${companyName}`,
      `Status: ${ticket.status || "-"}`,
      `Operation type: Supplier receipt`,
      `Supplier: ${supplierName}`,
      `Destination warehouse: ${toWarehouse}`,
      ticket.supplier_document_no ? `Document No: ${ticket.supplier_document_no}` : "",
      `Created at: ${fmt(ticket.created_at)}`,
      ticket.finalized_at ? `Closed at: ${fmt(ticket.finalized_at)}` : "",
      ...operatorFacts.map((fact) => `${fact.label}: ${fact.value}`),
      ticket.notes ? `Comment: ${ticket.notes}` : "",
      "",
      "Products in document:",
      ...productLinePdf,
      "",
      "Generated by AgriManager",
    ].filter((line) => line !== "");

    const linesPdf = isDirectSupplierReceipt ? directSupplierPdf : [
      "AgriManager",
      "Weighbridge Ticket",
      "----------------------------------------",
      `Company: ${companyName}`,
      `Ticket No: ${ticket.ticket_no || "-"}`,
      `Created at: ${fmt(ticket.created_at)}`,
      `Closed at: ${fmt(ticket.finalized_at)}`,
      `Operation type: ${operationLabel}`,
      `Direction: ${ticket.direction || "-"}`,
      contextLabel,
      `Destination warehouse: ${toWarehouse}`,
      ...(isHarvest ? [`Crop: ${productName(line)}`] : []),
      ...(isHarvest && varietyName !== "-" ? [`Variety: ${varietyName}`] : []),
      ...(isHarvest && reproductionName !== "-" ? [`Reproduction: ${reproductionName}`] : []),
      `Driver: ${driverName}`,
      `Vehicle: ${vehicleName}`,
      `Trailer: ${trailerName}`,
      ...operatorFacts.map((fact) => `${fact.label}: ${fact.value}`),
      `Gross: ${formatWeightNumber(ticket.gross_weight_kg, "-")} kg`,
      `Tare: ${formatWeightNumber(ticket.tare_weight_kg, "-")} kg`,
      `Net: ${formatWeightNumber(ticket.net_weight_kg, "-")} kg`,
      ...(ticket.notes ? [`Comment: ${ticket.notes}`] : []),
      ...(!isHarvest ? ["", "Products in document:", ...productLinePdf] : []),
      "",
      "Generated by AgriManager",
    ];

    const bytes = toPdfBytes(linesPdf);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ticket-${ticket.ticket_no || ticket.id}.pdf"`,
        "Cache-Control": "no-store",
      },
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
