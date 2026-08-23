import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  recordWeighbridgeOperatorActivity,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
  weighbridgeUserError,
} from "@/app/api/weighbridge/_auth";

const CORRECTION_LOT_ERROR = "Не удалось завершить исправление талона. Связь партии не прошла проверку. Исходный талон не изменён.";

function isCorrectionLotError(message: string) {
  return /aggregate (harvest )?lot|batch identity|batch lineage|physical batch|line identity|warehouse-local batch|company stock/i.test(message);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const reason = String(body?.reason || "").trim();
    if (!id || !["start", "finalize"].includes(action)) {
      return NextResponse.json({ error: "ticket id and correction action are required" }, { status: 400 });
    }
    if (action === "start" && !reason) {
      return NextResponse.json({ error: "Причина исправления обязательна." }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id,company_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (ticketError || !ticket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Ticket not found" }, { status: 404 });
    }

    const operatorSession = actor.role === "weighman"
      ? await requireWeighbridgeOperatorSession(request, { companyId, supabase })
      : null;
    let resultId: string | null = null;
    const findExistingCorrection = async () => supabase
      .from("tickets")
      .select("id")
      .eq("company_id", companyId)
      .eq("correction_of_ticket_id", id)
      .eq("is_voided", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (action === "start") {
      const { data: existingCorrection, error: existingCorrectionError } = await findExistingCorrection();
      if (existingCorrectionError) {
        return NextResponse.json({ error: existingCorrectionError.message }, { status: 400 });
      }
      resultId = existingCorrection?.id ? String(existingCorrection.id) : null;
    }

    const rpc = action === "start"
      ? "start_weighbridge_ticket_correction_v1"
      : "finalize_weighbridge_ticket_correction_v1";
    const args = action === "start"
      ? {
          p_ticket_id: id,
          p_reason: reason,
          p_operator_person_id: operatorSession?.operator.id || null,
          p_shift_id: operatorSession?.shift.id || null,
        }
      : {
          p_ticket_id: id,
          p_operator_person_id: operatorSession?.operator.id || null,
          p_shift_id: operatorSession?.shift.id || null,
        };
    if (!resultId) {
      const { data: rpcResultId, error: rpcError } = await supabase.rpc(rpc, args);
      if (rpcError) {
        if (action === "start") {
          const message = weighbridgeUserError(rpcError.message);
          if (message.includes("последующих движениях")) {
            const { data: existingCorrection, error: existingCorrectionError } = await findExistingCorrection();
            if (!existingCorrectionError && existingCorrection?.id) {
              resultId = String(existingCorrection.id);
            }
          }
        }
        if (!resultId) {
          if (action === "finalize" && isCorrectionLotError(rpcError.message)) {
            const traceId = randomUUID();
            console.error("weighbridge_correction_lot_validation_failed", { traceId, message: rpcError.message });
            return NextResponse.json(
              { error: CORRECTION_LOT_ERROR, code: "correction_lot_validation_failed", trace_id: traceId },
              { status: 409 }
            );
          }
          const message = weighbridgeUserError(rpcError.message);
          const status = message.includes("последующих движениях") ? 409 : 400;
          return NextResponse.json({ error: message, code: status === 409 ? "downstream_dependency" : "correction_failed" }, { status });
        }
      } else {
        resultId = String(rpcResultId || id);
      }
    }

    const { data: corrected, error: correctedError } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", String(resultId || id))
      .eq("company_id", companyId)
      .single();
    if (correctedError) {
      return NextResponse.json({ error: correctedError.message }, { status: 400 });
    }
    if (operatorSession) {
      await recordWeighbridgeOperatorActivity(request, { companyId, supabase }, "ticket_correction");
    }
    return NextResponse.json({ ticket: corrected });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
