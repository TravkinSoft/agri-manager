import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";

type AdminAction = "void" | "archive" | "force_close";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const actorUserId = String(body?.actorUserId || "").trim();
    const action = String(body?.action || "").trim() as AdminAction;
    const reason = String(body?.reason || "").trim();

    if (!id || !actorUserId) {
      return NextResponse.json({ error: "ticket id and actorUserId are required" }, { status: 400 });
    }
    if (!["void", "archive", "force_close"].includes(action)) {
      return NextResponse.json({ error: "Unsupported admin action" }, { status: 400 });
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
      allowedRoles: ["admin", "company_admin", "global_admin"],
    });

    if (action === "void" || action === "archive") {
      if (ticket.status === "finalized") {
        return NextResponse.json({ error: "Finalized tickets cannot be voided by admin cleanup" }, { status: 400 });
      }
      if (ticket.status === "voided") {
        return NextResponse.json({ ok: true, ticket }, { status: 200 });
      }

      const voidReason =
        reason ||
        (action === "archive" ? "Admin archive cleanup for stuck ticket" : "Admin void cleanup for stuck ticket");

      const { data: updated, error: updateError } = await supabase
        .from("tickets")
        .update({
          status: "voided",
          is_voided: true,
          void_reason: voidReason,
          voided_by: actorUserId,
          voided_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .single();
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      if (ticket.vehicle_id) {
        await supabase
          .from("reference_vehicles")
          .update({ status: "free" })
          .eq("id", ticket.vehicle_id)
          .eq("company_id", ticket.company_id);
      }

      return NextResponse.json({ ok: true, ticket: updated });
    }

    if (action === "force_close") {
      if (ticket.status === "finalized") {
        return NextResponse.json({ ok: true, ticket }, { status: 200 });
      }
      if (ticket.status === "voided") {
        return NextResponse.json({ error: "Voided ticket cannot be force-closed" }, { status: 400 });
      }

      let gross = Number(ticket.gross_weight_kg || 0);
      if (!(gross > 0)) {
        const { data: firstLine } = await supabase
          .from("ticket_lines")
          .select("quantity")
          .eq("ticket_id", id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        gross = Number(firstLine?.quantity || 0);
      }
      if (!(gross > 0)) {
        return NextResponse.json({ error: "Cannot force close: gross and line quantity are empty" }, { status: 400 });
      }

      const tare = ticket.tare_weight_kg == null ? 0 : Number(ticket.tare_weight_kg || 0);
      if (tare > gross) {
        return NextResponse.json({ error: "Cannot force close: tare is greater than gross" }, { status: 400 });
      }

      const { error: patchError } = await supabase
        .from("tickets")
        .update({
          gross_weight_kg: gross,
          tare_weight_kg: tare,
          status: "ready_to_close",
          notes: [ticket.notes, reason ? `Admin force-close reason: ${reason}` : null].filter(Boolean).join("\n") || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (patchError) {
        return NextResponse.json({ error: patchError.message }, { status: 400 });
      }

      const { error: finalizeError } = await supabase.rpc("finalize_weighbridge_ticket_v2", {
        p_ticket_id: id,
        p_actor_user_id: actorUserId,
      });
      if (finalizeError) {
        return NextResponse.json({ error: finalizeError.message }, { status: 400 });
      }

      const { data: updated } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (ticket.vehicle_id) {
        await supabase
          .from("reference_vehicles")
          .update({ status: "free" })
          .eq("id", ticket.vehicle_id)
          .eq("company_id", ticket.company_id);
      }

      return NextResponse.json({ ok: true, ticket: updated });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
