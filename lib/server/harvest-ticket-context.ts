import type { SupabaseClient } from "@supabase/supabase-js";

export type HarvestLinkStatus = "ready" | "missing" | "ambiguous" | "invalid";

export type HarvestTicketContext = {
  status: HarvestLinkStatus;
  message: string;
  seasonId: string | null;
  allocation: {
    id: string;
    fieldId: string;
    cropId: string;
    varietyId: string | null;
    reproductionId: string | null;
    areaHa: number;
    identityReviewRequired: boolean;
    identityReviewReason: string | null;
  } | null;
  operationId: string | null;
  operationLineId: string | null;
  operationStatus: string | null;
  harvestedMassKg: number;
  harvestedAreaHa: number;
  yieldTPerHa: number | null;
  yieldStatus: "not_available" | "preliminary" | "final";
};

export type HarvestYieldSummary = {
  harvestedMassKg: number;
  harvestedAreaHa: number;
  yieldTPerHa: number | null;
  openTicketCount: number;
  finalizedTicketCount: number;
  lineResults: Array<{
    operationLineId: string;
    harvestedMassKg: number;
    harvestedAreaHa: number;
    yieldTPerHa: number | null;
  }>;
};

const STATUS_PRIORITY = new Map([
  ["in_progress", 0],
  ["active", 1],
  ["accepted", 1],
  ["planned", 2],
]);

function normalizedOperationStatus(row: any): string {
  const values = [row?.operation_status, row?.work_status, row?.status]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (values.includes("in_progress")) return "in_progress";
  if (values.includes("active")) return "active";
  if (values.includes("accepted")) return "accepted";
  if (values.includes("planned")) return "planned";
  if (values.includes("completed")) return "completed";
  return values[0] || "";
}

function sameNullable(left: unknown, right: unknown): boolean {
  return String(left || "") === String(right || "");
}

export async function calculateHarvestYieldForOperation(params: {
  supabase: SupabaseClient;
  companyId: string;
  operationId: string;
  actualAreaByLineId?: Map<string, number>;
}): Promise<HarvestYieldSummary> {
  const { supabase, companyId, operationId, actualAreaByLineId } = params;
  const { data: operationLines, error: lineError } = await supabase
    .from("operation_lines")
    .select("id,actual_area_ha,planned_area_ha")
    .eq("company_id", companyId)
    .eq("operation_id", operationId);
  if (lineError) throw lineError;

  const { data: tickets, error: ticketError } = await supabase
    .from("tickets")
    .select("id,net_weight_kg,status,is_finalized,is_voided")
    .eq("company_id", companyId)
    .eq("op_type", "harvest_incoming")
    .eq("linked_operation_id", operationId);
  if (ticketError) throw ticketError;

  const openTicketCount = (tickets || []).filter((ticket: any) =>
    ["draft", "active", "ready_to_close"].includes(String(ticket.status || "")) && !ticket.is_voided
  ).length;
  const finalizedTickets = (tickets || []).filter((ticket: any) =>
    !ticket.is_voided && (ticket.is_finalized || ["finalized", "closed"].includes(String(ticket.status || "")))
  );
  const finalizedTicketIds = finalizedTickets.map((ticket: any) => String(ticket.id));
  const ticketById = new Map(finalizedTickets.map((ticket: any) => [String(ticket.id), ticket]));
  const operationLineIds = (operationLines || []).map((line: any) => String(line.id));

  let ticketLinks: any[] = [];
  if (finalizedTicketIds.length > 0 && operationLineIds.length > 0) {
    const { data, error } = await supabase
      .from("ticket_lines")
      .select("ticket_id,operation_line_id")
      .eq("company_id", companyId)
      .in("ticket_id", finalizedTicketIds)
      .in("operation_line_id", operationLineIds);
    if (error) throw error;
    ticketLinks = data || [];
  }

  const ticketIdsByLine = new Map<string, Set<string>>();
  for (const link of ticketLinks) {
    const lineId = String(link.operation_line_id || "");
    const ticketId = String(link.ticket_id || "");
    if (!lineId || !ticketId) continue;
    const values = ticketIdsByLine.get(lineId) || new Set<string>();
    values.add(ticketId);
    ticketIdsByLine.set(lineId, values);
  }

  const countedTickets = new Set<string>();
  const lineResults = (operationLines || []).map((line: any) => {
    const operationLineId = String(line.id);
    const linkedTicketIds = ticketIdsByLine.get(operationLineId) || new Set<string>();
    const harvestedMassKg = Array.from(linkedTicketIds).reduce((sum, ticketId) => {
      countedTickets.add(ticketId);
      return sum + Number((ticketById.get(ticketId) as any)?.net_weight_kg || 0);
    }, 0);
    const overrideArea = actualAreaByLineId?.get(operationLineId);
    const harvestedAreaHa = Number(overrideArea ?? line.actual_area_ha ?? 0);
    const yieldTPerHa = harvestedAreaHa > 0 && harvestedMassKg > 0
      ? Math.round((harvestedMassKg / 1000 / harvestedAreaHa) * 1000) / 1000
      : null;
    return { operationLineId, harvestedMassKg, harvestedAreaHa, yieldTPerHa };
  });

  const harvestedMassKg = Array.from(countedTickets).reduce(
    (sum, ticketId) => sum + Number((ticketById.get(ticketId) as any)?.net_weight_kg || 0),
    0
  );
  const harvestedAreaHa = lineResults.reduce((sum, line) => sum + line.harvestedAreaHa, 0);
  const yieldTPerHa = harvestedAreaHa > 0 && harvestedMassKg > 0
    ? Math.round((harvestedMassKg / 1000 / harvestedAreaHa) * 1000) / 1000
    : null;

  return {
    harvestedMassKg,
    harvestedAreaHa,
    yieldTPerHa,
    openTicketCount,
    finalizedTicketCount: finalizedTickets.length,
    lineResults,
  };
}

export async function resolveHarvestTicketContext(params: {
  supabase: SupabaseClient;
  companyId: string;
  fieldId: string;
  allocationId: string;
}): Promise<HarvestTicketContext> {
  const { supabase, companyId, fieldId, allocationId } = params;
  const empty = (status: HarvestLinkStatus, message: string): HarvestTicketContext => ({
    status,
    message,
    seasonId: null,
    allocation: null,
    operationId: null,
    operationLineId: null,
    operationStatus: null,
    harvestedMassKg: 0,
    harvestedAreaHa: 0,
    yieldTPerHa: null,
    yieldStatus: "not_available",
  });

  if (!companyId || !fieldId || !allocationId) {
    return empty("invalid", "Выберите поле и участок / культуру.");
  }

  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false });
  if (seasonsError) throw seasonsError;

  const nowYear = new Date().getFullYear();
  const activeSeason = (seasons || []).find((row: any) => Number(row.year) === nowYear) || (seasons || [])[0];
  if (!activeSeason?.id) {
    return empty("missing", "В компании нет активного сезона.");
  }

  let { data: allocation, error: allocationError } = await supabase
    .from("crop_structure")
    .select("id,company_id,season_id,field_id,crop_id,variety_id,reproduction_id,area,archived,identity_review_required,identity_review_reason")
    .eq("id", allocationId)
    .eq("company_id", companyId)
    .eq("season_id", activeSeason.id)
    .eq("field_id", fieldId)
    .eq("archived", false)
    .maybeSingle();
  if (allocationError && /identity_review_/i.test(allocationError.message || "")) {
    const fallback = await supabase
      .from("crop_structure")
      .select("id,company_id,season_id,field_id,crop_id,variety_id,reproduction_id,area,archived")
      .eq("id", allocationId)
      .eq("company_id", companyId)
      .eq("season_id", activeSeason.id)
      .eq("field_id", fieldId)
      .eq("archived", false)
      .maybeSingle();
    allocation = fallback.data as any;
    allocationError = fallback.error;
  }
  if (allocationError) throw allocationError;
  if (!allocation?.id || !allocation.crop_id) {
    return empty("invalid", "Участок не относится к выбранному полю или активному сезону.");
  }

  const allocationValue = {
    id: String(allocation.id),
    fieldId: String(allocation.field_id),
    cropId: String(allocation.crop_id),
    varietyId: allocation.variety_id ? String(allocation.variety_id) : null,
    reproductionId: allocation.reproduction_id ? String(allocation.reproduction_id) : null,
    areaHa: Number(allocation.area || 0),
    identityReviewRequired: Boolean((allocation as any).identity_review_required),
    identityReviewReason: (allocation as any).identity_review_reason
      ? String((allocation as any).identity_review_reason)
      : null,
  };
  if (
    allocationValue.identityReviewRequired ||
    !allocationValue.varietyId ||
    !allocationValue.reproductionId
  ) {
    return {
      ...empty(
        "invalid",
        "Для выбранной строки структуры посевов требуется проверить культуру, сорт и репродукцию."
      ),
      seasonId: String(activeSeason.id),
      allocation: allocationValue,
    };
  }

  const { data: operations, error: operationsError } = await supabase
    .from("operations")
    .select("id,company_id,field_id,crop_structure_id,archived,status,work_status,operation_status,operation_category_slug,operation_type_slug")
    .eq("company_id", companyId)
    .eq("field_id", fieldId)
    .eq("crop_structure_id", allocationId)
    .eq("archived", false)
    .or("operation_category_slug.eq.harvesting,operation_type_slug.eq.harvesting");
  if (operationsError) throw operationsError;

  const normalizedOperations = (operations || [])
    .map((row: any) => ({ ...row, resolvedStatus: normalizedOperationStatus(row) }));
  const candidates = normalizedOperations
    .filter((row: any) => STATUS_PRIORITY.has(row.resolvedStatus));

  if (candidates.length === 0) {
    const completedOperations = normalizedOperations.filter((row: any) => row.resolvedStatus === "completed");
    if (completedOperations.length === 1) {
      const completedOperation = completedOperations[0];
      const { data: completedLines, error: completedLinesError } = await supabase
        .from("operation_lines")
        .select("id,operation_id,company_id,field_id,crop_id,variety_id,reproduction_id,actual_area_ha,planned_area_ha")
        .eq("company_id", companyId)
        .eq("field_id", fieldId)
        .eq("operation_id", completedOperation.id);
      if (completedLinesError) throw completedLinesError;
      const completedLineCandidates = (completedLines || []).filter((line: any) => {
        if (String(line.crop_id || "") !== allocationValue.cropId) return false;
        if (line.variety_id && !sameNullable(line.variety_id, allocationValue.varietyId)) return false;
        if (line.reproduction_id && !sameNullable(line.reproduction_id, allocationValue.reproductionId)) return false;
        return true;
      });
      if (completedLineCandidates.length === 1) {
        const yieldSummary = await calculateHarvestYieldForOperation({
          supabase,
          companyId,
          operationId: String(completedOperation.id),
        });
        const lineYield = yieldSummary.lineResults.find(
          (line) => line.operationLineId === String(completedLineCandidates[0].id)
        );
        return {
          status: "missing",
          message: "Уборка по выбранному участку уже завершена. Новый талон создать нельзя.",
          seasonId: String(activeSeason.id),
          allocation: allocationValue,
          operationId: String(completedOperation.id),
          operationLineId: String(completedLineCandidates[0].id),
          operationStatus: "completed",
          harvestedMassKg: lineYield?.harvestedMassKg || 0,
          harvestedAreaHa: lineYield?.harvestedAreaHa || 0,
          yieldTPerHa: lineYield?.yieldTPerHa ?? null,
          yieldStatus: lineYield?.yieldTPerHa == null ? "not_available" : "final",
        };
      }
    }
    return {
      ...empty("missing", "По выбранному участку нет активной уборки. Попросите агронома создать или активировать план уборки."),
      seasonId: String(activeSeason.id),
      allocation: allocationValue,
    };
  }

  const bestPriority = Math.min(...candidates.map((row: any) => STATUS_PRIORITY.get(row.resolvedStatus) ?? 99));
  const bestOperations = candidates.filter(
    (row: any) => (STATUS_PRIORITY.get(row.resolvedStatus) ?? 99) === bestPriority
  );
  const operationIds = bestOperations.map((row: any) => String(row.id));

  const { data: lines, error: linesError } = await supabase
    .from("operation_lines")
    .select("id,operation_id,company_id,field_id,crop_id,variety_id,reproduction_id,actual_area_ha,planned_area_ha")
    .eq("company_id", companyId)
    .eq("field_id", fieldId)
    .in("operation_id", operationIds);
  if (linesError) throw linesError;

  const lineCandidates = (lines || []).filter((line: any) => {
    if (String(line.crop_id || "") !== allocationValue.cropId) return false;
    if (line.variety_id && !sameNullable(line.variety_id, allocationValue.varietyId)) return false;
    if (line.reproduction_id && !sameNullable(line.reproduction_id, allocationValue.reproductionId)) return false;
    return true;
  });

  if (bestOperations.length !== 1 || lineCandidates.length !== 1) {
    return {
      ...empty("ambiguous", "Для выбранного участка найдено несколько активных уборок. Агроном должен оставить одну актуальную операцию."),
      seasonId: String(activeSeason.id),
      allocation: allocationValue,
    };
  }

  const operation = bestOperations[0];
  const operationLine = lineCandidates[0];
  if (String(operationLine.operation_id) !== String(operation.id)) {
    return {
      ...empty("ambiguous", "Для выбранного участка найдено несколько активных уборок. Агроном должен оставить одну актуальную операцию."),
      seasonId: String(activeSeason.id),
      allocation: allocationValue,
    };
  }

  const yieldSummary = await calculateHarvestYieldForOperation({
    supabase,
    companyId,
    operationId: String(operation.id),
  });
  const lineYield = yieldSummary.lineResults.find(
    (line) => line.operationLineId === String(operationLine.id)
  );
  const harvestedMassKg = lineYield?.harvestedMassKg || 0;
  const harvestedAreaHa = lineYield?.harvestedAreaHa || 0;
  const yieldTPerHa = lineYield?.yieldTPerHa ?? null;
  const operationStatus = String(operation.resolvedStatus || "");
  const yieldStatus = yieldTPerHa == null
    ? "not_available"
    : operationStatus === "completed"
      ? "final"
      : "preliminary";

  return {
    status: "ready",
    message: "Уборка определена автоматически.",
    seasonId: String(activeSeason.id),
    allocation: allocationValue,
    operationId: String(operation.id),
    operationLineId: String(operationLine.id),
    operationStatus,
    harvestedMassKg,
    harvestedAreaHa,
    yieldTPerHa,
    yieldStatus,
  };
}

export function publicHarvestTicketContext(context: HarvestTicketContext) {
  return {
    status: context.status,
    message: context.message,
    seasonId: context.seasonId,
    allocation: context.allocation,
    harvestedMassKg: context.harvestedMassKg,
    harvestedAreaHa: context.harvestedAreaHa,
    yieldTPerHa: context.yieldTPerHa,
    yieldStatus: context.yieldStatus,
  };
}
