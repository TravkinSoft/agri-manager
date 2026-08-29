import type { WeighbridgeTicket } from "@/lib/types/weighbridge";
import { isVegetableCropForProcessing } from "@/lib/weighbridge/crop-processing";

export type CombineOperatorCropIdentity = {
  cropSlug?: unknown;
  cropName?: unknown;
  categorySlug?: unknown;
  categoryName?: unknown;
  subcategory?: unknown;
};

export type CombineOperatorContext = {
  companyId: string;
  seasonId: string;
  cropStructureId?: string | null;
  fieldId?: string | null;
  cropId?: string | null;
};

const clean = (value: unknown) => String(value || "").trim();

export function usesPersistentCombineOperator(identity: CombineOperatorCropIdentity): boolean {
  return isVegetableCropForProcessing(identity);
}

export function combineOperatorContextKey(context: CombineOperatorContext): string {
  const companyId = clean(context.companyId);
  const seasonId = clean(context.seasonId);
  const cropStructureId = clean(context.cropStructureId);
  if (companyId && seasonId && cropStructureId) {
    return `${companyId}:${seasonId}:structure:${cropStructureId}`;
  }
  return `${companyId}:${seasonId}:field:${clean(context.fieldId)}:crop:${clean(context.cropId)}`;
}

function ticketMatchesContext(ticket: WeighbridgeTicket, context: CombineOperatorContext): boolean {
  if (ticket.op_type !== "harvest_incoming" || ticket.is_voided || ticket.status === "voided") return false;
  if (clean(ticket.company_id) !== clean(context.companyId)) return false;
  if (clean(ticket.season_id) !== clean(context.seasonId)) return false;

  const contextStructureId = clean(context.cropStructureId);
  const ticketStructureId = clean(ticket.crop_structure_allocation_id);
  if (contextStructureId && ticketStructureId) return contextStructureId === ticketStructureId;

  const ticketCropId = clean(ticket.lines?.[0]?.crop_id);
  return Boolean(
    clean(context.fieldId)
      && clean(context.cropId)
      && clean(ticket.field_id) === clean(context.fieldId)
      && ticketCropId === clean(context.cropId)
  );
}

export function recentCombineOperatorIds(
  tickets: WeighbridgeTicket[],
  context: CombineOperatorContext,
  availablePersonIds: Iterable<string>,
  limit = 8
): string[] {
  const available = new Set(Array.from(availablePersonIds, clean).filter(Boolean));
  const sorted = tickets
    .filter((ticket) => ticketMatchesContext(ticket, context))
    .slice()
    .sort((left, right) => {
      const time = new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
      return time || String(right.id).localeCompare(String(left.id));
    });
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ticket of sorted) {
    const personId = clean(ticket.combine_operator_person_id);
    if (!personId || !available.has(personId) || seen.has(personId)) continue;
    seen.add(personId);
    result.push(personId);
    if (result.length >= Math.max(1, limit)) break;
  }
  return result;
}
