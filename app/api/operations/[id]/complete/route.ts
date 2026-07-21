import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  SeasonGuardError,
  assertSeasonWritableForMutation,
  resolveOperationSeasonIdForGuard,
} from "@/lib/seasons/season-guard";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";
import { calculateHarvestYieldForOperation } from "@/lib/server/harvest-ticket-context";

function toNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) return NextResponse.json({ error: "operation id is required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const comment = String(body.comment || "").trim();
    if (!comment) return NextResponse.json({ error: "Completion comment is required" }, { status: 400 });
    const lineFacts = Array.isArray(body.lineFacts)
      ? body.lineFacts
      : Array.isArray(body.line_facts)
        ? body.line_facts
        : [];
    const materialFacts = Array.isArray(body.materialFacts)
      ? body.materialFacts
      : Array.isArray(body.material_facts)
        ? body.material_facts
        : [];
    const actualArea = toNonNegativeNumber(body.actualAreaHa ?? body.actual_area_ha);

    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const supabase = await getUserScopedClientFromRequest(request);
    const idempotency = requireOperationIdempotency(request, { ...body, operationId, action: "complete" });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("crop_structure_id,operation_category_slug,operation_type_slug")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (operationError || !operation) {
      return NextResponse.json({ error: operationError?.message || "Operation not found" }, { status: 404 });
    }
    const isHarvestOperation =
      operation.operation_category_slug === "harvesting" || operation.operation_type_slug === "harvesting";
    let completionComment = comment;
    if (isHarvestOperation) {
      const { data: harvestTickets, error: harvestTicketsError } = await supabase
        .from("tickets")
        .select("id,status,is_finalized,is_voided")
        .eq("company_id", companyId)
        .eq("op_type", "harvest_incoming")
        .eq("linked_operation_id", operationId);
      if (harvestTicketsError) {
        return NextResponse.json({ error: harvestTicketsError.message }, { status: 400 });
      }
      if ((harvestTickets || []).some((ticket: any) =>
        !ticket.is_voided && !["finalized", "closed"].includes(String(ticket.status || ""))
      )) {
        return NextResponse.json(
          { error: "По уборке имеются открытые весовые талоны" },
          { status: 409 }
        );
      }
      const finalizedHarvestTickets = (harvestTickets || []).filter((ticket: any) =>
        !ticket.is_voided && (ticket.is_finalized || ["finalized", "closed"].includes(String(ticket.status || "")))
      );
      if (!finalizedHarvestTickets.length) {
        return NextResponse.json(
          { error: "Create and finalize a linked harvest weighbridge ticket before completing the operation" },
          { status: 409 }
        );
      }
      const actualAreaByLineId = new Map<string, number>();
      for (const fact of lineFacts as any[]) {
        const lineId = String(fact?.line_id || fact?.lineId || fact?.id || "").trim();
        const area = toNonNegativeNumber(fact?.actual_area_ha ?? fact?.actualAreaHa);
        if (lineId && area != null) actualAreaByLineId.set(lineId, area);
      }
      if (actualArea != null && actualAreaByLineId.size === 0) {
        const { data: operationLines, error: operationLinesError } = await supabase
          .from("operation_lines")
          .select("id")
          .eq("company_id", companyId)
          .eq("operation_id", operationId);
        if (operationLinesError) {
          return NextResponse.json({ error: operationLinesError.message }, { status: 400 });
        }
        if ((operationLines || []).length === 1) {
          actualAreaByLineId.set(String(operationLines![0].id), actualArea);
        }
      }

      const yieldSummary = await calculateHarvestYieldForOperation({
        supabase,
        companyId,
        operationId,
        actualAreaByLineId,
      });
      if (yieldSummary.openTicketCount > 0) {
        return NextResponse.json({ error: "По уборке имеются открытые весовые талоны" }, { status: 409 });
      }
      if (yieldSummary.yieldTPerHa == null) {
        return NextResponse.json(
          { error: "Итоговая урожайность не рассчитана: проверьте фактическую площадь и закрытые талоны." },
          { status: 409 }
        );
      }
      completionComment = [
        comment,
        `Итоговая урожайность: ${yieldSummary.yieldTPerHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т/га; масса ${yieldSummary.harvestedMassKg.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг; площадь ${yieldSummary.harvestedAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 4 })} га.`,
      ].join("\n");
    }
    const seasonId = await resolveOperationSeasonIdForGuard(supabase, {
      companyId,
      cropStructureId: operation.crop_structure_id,
    });
    await assertSeasonWritableForMutation(supabase, {
      companyId,
      seasonId,
      actionLabel: "Operation completion",
    });

    const { data, error } = await supabase.rpc("complete_operation_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_operation_id: operationId,
      p_actual_area_ha: actualArea,
      p_line_facts: lineFacts,
      p_material_facts: materialFacts,
      p_comment: completionComment,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Operation was not completed");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (
      error instanceof SessionAuthError ||
      error instanceof SeasonGuardError ||
      error instanceof OperationMutationInputError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = operationMutationError(error, "Unknown error");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
