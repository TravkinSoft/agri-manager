import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";

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

    const { data: lines } = await supabase
      .from("ticket_lines")
      .select("*, products:product_id(name)")
      .eq("ticket_id", id);
    const { data: weighings } = await supabase
      .from("ticket_weighings")
      .select("*")
      .eq("ticket_id", id)
      .order("weighing_no", { ascending: true });

    return NextResponse.json({
      ticket,
      lines: (lines || []).map((line: any) => ({
        ...line,
        product_name: line.product_name_snapshot || line.products?.name || "-",
      })),
      weighings: weighings || [],
    });
  } catch (error) {
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
    const actorUserId = String(body?.actorUserId || "").trim();
    if (!id || !actorUserId) {
      return NextResponse.json({ error: "ticket id and actorUserId are required" }, { status: 400 });
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
      allowedRoles: ["admin", "warehouse", "weighman"],
    });

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
