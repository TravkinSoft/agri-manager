import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { asSessionErrorResponse, resolveWeighbridgeSession, weighbridgeUserError } from "@/app/api/weighbridge/_auth";

type AdminAction = "void" | "archive" | "force_close";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = String(body?.action || "").trim() as AdminAction;
    const reason = String(body?.reason || "").trim();

    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }
    if (!["void", "archive", "force_close"].includes(action)) {
      return NextResponse.json({ error: "Unsupported admin action" }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: ["company_admin", "global_admin"],
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

    if (action === "void" || action === "archive") {
      if (ticket.status === "finalized") {
        if (action !== "void") {
          return NextResponse.json({ error: "Закрытый талон можно только аннулировать через storno." }, { status: 400 });
        }
        const { error: voidError } = await supabase.rpc("void_ticket_with_storno_v2", {
          p_ticket_id: id,
          p_actor_user_id: actor.id,
          p_reason: reason || "Admin void finalized ticket",
        });
        if (voidError) {
          return NextResponse.json({ error: weighbridgeUserError(voidError.message) }, { status: 400 });
        }
        const { data: updated } = await supabase
          .from("tickets")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        return NextResponse.json({ ok: true, ticket: updated || ticket });
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
          voided_by: actor.id,
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
        p_actor_user_id: actor.id,
      });
      if (finalizeError) {
        return NextResponse.json({ error: finalizeError.message }, { status: 400 });
      }

      const { error: backfillError } = await supabase.rpc("backfill_ticket_operation_line_links_v1", {
        p_ticket_id: id,
      });
      if (backfillError) {
        return NextResponse.json({ error: backfillError.message }, { status: 400 });
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
