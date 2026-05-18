import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";

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
    const actorUserId = String(request.nextUrl.searchParams.get("userId") || "").trim();
    if (!id || !actorUserId) {
      return NextResponse.json({ error: "ticket id and userId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (ticketError || !ticket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Ticket not found" }, { status: 404 });
    }

    await assertActorAccess({
      supabase,
      actorUserId,
      companyId: ticket.company_id,
      allowedRoles: ["admin", "agronomist", "warehouse", "weighman", "specialist"],
    });

    const [{ data: lines }, { data: fields }, { data: warehouses }, { data: products }, { data: varieties }, { data: reproductions }, { data: drivers }, { data: vehicles }, { data: operators }] = await Promise.all([
      supabase.from("ticket_lines").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
      supabase.from("fields").select("id,name").eq("company_id", ticket.company_id),
      supabase.from("warehouses").select("id,name").eq("company_id", ticket.company_id),
      supabase.from("products").select("id,name,company_id").or(`company_id.eq.${ticket.company_id},company_id.is.null`),
      supabase.from("varieties").select("id,name,company_id").or(`company_id.eq.${ticket.company_id},company_id.is.null`),
      supabase.from("seed_reproductions").select("id,name,company_id").or(`company_id.eq.${ticket.company_id},company_id.is.null`),
      supabase.from("profiles").select("id,full_name,email").eq("company_id", ticket.company_id),
      supabase.from("reference_vehicles").select("id,name,plate_number").eq("company_id", ticket.company_id),
      supabase.from("profiles").select("id,full_name,email").eq("company_id", ticket.company_id),
    ]);

    const line = (lines || [])[0] as any;
    const fieldName = (fields || []).find((x: any) => x.id === ticket.field_id)?.name || "-";
    const fromWarehouse = (warehouses || []).find((x: any) => x.id === ticket.warehouse_from_id)?.name || "-";
    const toWarehouse = (warehouses || []).find((x: any) => x.id === ticket.warehouse_to_id)?.name || "-";
    const productName = line
      ? line.product_name_snapshot || (products || []).find((x: any) => x.id === line.product_id)?.name || "-"
      : "-";
    const varietyName = line?.variety_id
      ? (varieties || []).find((x: any) => x.id === line.variety_id)?.name || "-"
      : "-";
    const reproductionName = line?.reproduction_id
      ? (reproductions || []).find((x: any) => x.id === line.reproduction_id)?.name || "-"
      : "-";
    const driverName = ticket.driver_id
      ? (drivers || []).find((x: any) => x.id === ticket.driver_id)?.full_name ||
        (drivers || []).find((x: any) => x.id === ticket.driver_id)?.email ||
        "-"
      : "-";
    const vehicle = ticket.vehicle_id
      ? (vehicles || []).find((x: any) => x.id === ticket.vehicle_id)
      : null;
    const vehicleName = vehicle ? `${vehicle.name || "-"} (${vehicle.plate_number || "-"})` : "-";
    const operatorName = ticket.created_by
      ? (operators || []).find((x: any) => x.id === ticket.created_by)?.full_name ||
        (operators || []).find((x: any) => x.id === ticket.created_by)?.email ||
        "-"
      : "-";

    const linesPdf = [
      "AgriManager",
      "Weighbridge Ticket",
      "----------------------------------------",
      `Ticket No: ${ticket.ticket_no || "-"}`,
      `Created at: ${fmt(ticket.created_at)}`,
      `Closed at: ${fmt(ticket.finalized_at)}`,
      `Operation type: ${ticket.op_type || "-"}`,
      `Direction: ${ticket.direction || "-"}`,
      `Field / From: ${fieldName !== "-" ? fieldName : fromWarehouse}`,
      `Warehouse / To: ${toWarehouse !== "-" ? toWarehouse : fieldName}`,
      `Crop / Product: ${productName}`,
      `Variety: ${varietyName}`,
      `Reproduction: ${reproductionName}`,
      `Driver: ${driverName}`,
      `Vehicle: ${vehicleName}`,
      `Cashier / Operator: ${operatorName}`,
      `Gross: ${ticket.gross_weight_kg ?? "-"} kg`,
      `Tare: ${ticket.tare_weight_kg ?? "-"} kg`,
      `Net: ${ticket.net_weight_kg ?? "-"} kg`,
      `Comment: ${ticket.notes || "-"}`,
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
