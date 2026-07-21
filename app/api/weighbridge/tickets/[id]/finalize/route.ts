import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession, weighbridgeUserError } from "@/app/api/weighbridge/_auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const timing = { authMs: 0, validationMs: 0, dbMs: 0, rpcMs: 0, totalMs: 0 };
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (!id) {
      return NextResponse.json({ error: "ticket id is required" }, { status: 400 });
    }

    const authStartedAt = Date.now();
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    timing.authMs = Date.now() - authStartedAt;
    const dbStartedAt = Date.now();
    const { data: ticketBefore, error: ticketBeforeError } = await supabase
      .from("tickets")
      .select("id, company_id, linked_request_id, warehouse_from_id, vehicle_id, op_type, is_finalized, status, net_weight_kg")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (ticketBeforeError || !ticketBefore?.id) {
      return NextResponse.json({ error: ticketBeforeError?.message || "Ticket not found" }, { status: 404 });
    }
    if (ticketBefore.is_finalized || ticketBefore.status === "finalized") {
      timing.validationMs = Date.now() - dbStartedAt;
      timing.totalMs = Date.now() - startedAt;
      return NextResponse.json({ ticket: ticketBefore, idempotent_replay: true, debug: timing });
    }
    timing.validationMs = Date.now() - dbStartedAt;

    const rpcStartedAt = Date.now();
    const finalizeRpc = ticketBefore.op_type === "weighbridge_impurities"
      ? "finalize_weighbridge_impurity_ticket_for_session_v1"
      : "finalize_weighbridge_ticket_for_session_v1";
    const { error: finalizeError } = await supabase.rpc(finalizeRpc, {
      p_ticket_id: id,
    });
    timing.rpcMs = Date.now() - rpcStartedAt;

    if (finalizeError) {
      return NextResponse.json({ error: weighbridgeUserError(finalizeError.message) }, { status: 400 });
    }

    const { data: lineLinks, error: lineLinksError } = await supabase
      .from("ticket_lines")
      .select("id,operation_line_id,operation_lines:operation_line_id(operation_id)")
      .eq("ticket_id", id)
      .eq("company_id", companyId)
      .not("operation_line_id", "is", null);
    if (lineLinksError) {
      return NextResponse.json({ error: lineLinksError.message || "Operation linkage load failed" }, { status: 400 });
    }

    for (const row of lineLinks || []) {
      const operationLineRel = Array.isArray((row as any).operation_lines)
        ? (row as any).operation_lines[0]
        : (row as any).operation_lines;
      const operationId = String(operationLineRel?.operation_id || "").trim();
      if (!operationId) continue;
      const { error: fmcBackfillError } = await supabase
        .from("field_material_consumptions")
        .update({ operation_id: operationId, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("ticket_id", id)
        .eq("ticket_line_id", String((row as any).id || ""))
        .is("operation_id", null);
      if (fmcBackfillError) {
        return NextResponse.json({ error: fmcBackfillError.message || "Operation id backfill failed" }, { status: 400 });
      }
    }

    const dbAfterRpcStartedAt = Date.now();
    const { data: updated } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (ticketBefore.vehicle_id) {
      const { data: stillActive } = await supabase
        .from("tickets")
        .select("id")
        .eq("company_id", ticketBefore.company_id)
        .eq("vehicle_id", ticketBefore.vehicle_id)
        .in("status", ["draft", "active", "ready_to_close"])
        .neq("id", id)
        .limit(1);

      if ((stillActive || []).length === 0) {
        await supabase
          .from("reference_vehicles")
          .update({ status: "free" })
          .eq("id", ticketBefore.vehicle_id)
          .eq("company_id", ticketBefore.company_id);
      }
    }

    if (ticketBefore.linked_request_id) {
      const { data: requestItems } = await supabase
        .from("warehouse_issue_request_items")
        .select("id, planned_quantity, required_quantity")
        .eq("request_id", ticketBefore.linked_request_id);

      await supabase
        .from("warehouse_issue_requests")
        .update({
          status: "issued_by_warehouse",
          issued_at: new Date().toISOString(),
          issued_by_user_id: actor.id,
          source_warehouse_id: ticketBefore.warehouse_from_id || null,
        })
        .eq("id", ticketBefore.linked_request_id);

      await supabase
        .from("warehouse_issue_request_items")
        .upsert(
          (requestItems || []).map((item: any) => ({
            id: item.id,
            issued_quantity: Number(item.planned_quantity || item.required_quantity || 0),
          })),
          { onConflict: "id" }
        );
    }

    timing.dbMs = timing.validationMs + (Date.now() - dbAfterRpcStartedAt);
    timing.totalMs = Date.now() - startedAt;
    return NextResponse.json({ ticket: updated, debug: timing });
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
