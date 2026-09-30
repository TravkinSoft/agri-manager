import type { HarvestOverview } from "./harvest-summary";
import { SUMMARY_SECTIONS, type SummarySection } from "./summary-sections";

export type SummaryYield = {
  companyId: string; readOnly: true; serverTime: string;
  fields: Array<{ id: string; label: string; yieldTPerHa: number | null; pending: boolean; issue: boolean; isCurrent: boolean;
    areaHa?: number | null; harvestedHa?: number | null; completed?: boolean; description?: string; plotIds?: string[] }>;
};

/** Project the canonical whole-field calculation, never average allocation yields. */
export function projectSummaryYield(companyId: string, serverTime: string, summary: HarvestOverview): SummaryYield {
  return { companyId, readOnly: true, serverTime, fields: summary.harvestFields.map(field => ({
    id: field.key,
    // The physical field may contain another crop. Progress covers this crop's allocations only.
    label: [field.fieldName, field.plannedAreaHa ? `${field.plannedAreaHa} га` : null, field.cropName].filter(Boolean).join(" · "),
    // Keep the canonical confirmed yield unchanged for other consumers. This summary
    // additionally shows an explicitly preliminary ratio while new hectares are pending.
    yieldTPerHa: field.areaIssue ? null : field.yieldTPerHa ?? (field.harvestedAreaHa && field.harvestedAreaHa > 0
      ? field.totalAcceptedKg / 1000 / field.harvestedAreaHa : null),
    pending: field.areaPending || field.combineShiftOpen,
    issue: Boolean(field.areaIssue),
    isCurrent: field.isCurrent,
    areaHa: field.plannedAreaHa || null,
    harvestedHa: field.harvestedAreaHa,
    completed: field.status === "completed",
    plotIds: summary.harvestPlots.filter(plot => plot.fieldId === field.fieldId && plot.seasonId === field.seasonId
      && plot.cropId === field.cropId).map(plot => plot.cropStructureAllocationId),
    description: Array.from(new Set(summary.harvestPlots.filter(plot => plot.fieldId === field.fieldId
      && plot.seasonId === field.seasonId && plot.cropId === field.cropId)
      .map(plot => [plot.varietyName, plot.reproductionName].filter(Boolean).join(" · ")))).filter(Boolean).join(" / "),
  })).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)) };
}

export const summaryClock = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleTimeString("ru-RU", { timeZone: "Asia/Qyzylorda", hour: "2-digit", minute: "2-digit" }) : "—";
export const summaryTonnes = (kg: number | null | undefined) => kg != null && Number.isFinite(kg)
  ? `${(kg / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т` : "—";

/** Deliberate horizontal gesture only; no wrap at edges or long/vertical gestures. */
export function swipedSummarySection(section: SummarySection, dx: number, dy: number, elapsedMs: number): SummarySection {
  if (elapsedMs > 850 || elapsedMs < 0 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.7) return section;
  const index = SUMMARY_SECTIONS.findIndex(item => item.id === section);
  return SUMMARY_SECTIONS[index + (dx < 0 ? 1 : -1)]?.id ?? section;
}
