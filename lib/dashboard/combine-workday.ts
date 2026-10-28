export type CombineShiftRow = {
  id: string; operator_user_id: string; operator_name: string;
  opened_at: string; closed_at: string | null; current_crop_structure_id: string | null;
  hectares_shift: number | string | null;
};
export type CombineSegmentRow = {
  id: string; shift_id: string; crop_structure_id: string; field_id: string;
  planned_area_ha: number | string | null; hectares_segment: number | string | null;
  ended_field_total_ha: number | string | null; closed_at: string | null;
};
export type CombinePlotInfo = {
  id: string; label: string; areaHa: number | null; totalHa: number | null; status: string;
};
export type CombineWorkday = {
  companyId: string; serverTime: string; readOnly: true;
  availableDates?: string[];
  hasActiveShift?: boolean;
  operationalDayStartHour?: number;
  period: { start: string; end: string; label: string };
  confirmedHa: number; totalHa: number | null; pending: boolean; issue: boolean;
  shifts: Array<{
    id: string; operatorName: string; openedAt: string; closedAt: string | null;
    hectares: number | null; confirmedHa: number; pending: boolean; issue: boolean;
    currentPlotId: string | null;
    fields?: Array<{ id: string; label: string; hectares: number | null; pending: boolean }>;
  }>;
  plots: Array<CombinePlotInfo & { workdayHa: number | null; confirmedHa: number; pending: boolean; issue: boolean; isCurrent: boolean }>;
};

function numeric(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
const rounded = (value: number) => Math.round(value * 1000) / 1000;

/** Read-only report: DB shift identities are preserved, never merged or rewritten.
 * Attribute a whole shift to the workday it opened in (including after-midnight
 * closure). Missing hectares stay unknown; cumulative progress is not a delta. */
export function buildCombineWorkday(input: {
  companyId: string; serverTime: string; period: CombineWorkday["period"];
  shifts: CombineShiftRow[]; segments: CombineSegmentRow[]; plots: CombinePlotInfo[];
}): CombineWorkday {
  const shifts = Array.from(new Map(input.shifts.map(row => [row.id, row])).values())
    .filter(row => Date.parse(row.opened_at) >= Date.parse(input.period.start) && Date.parse(row.opened_at) < Date.parse(input.period.end))
    .sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at) || a.id.localeCompare(b.id));
  const plotInfo = new Map(input.plots.map(plot => [plot.id, plot]));
  const plotTotals = new Map<string, CombineWorkday["plots"][number]>();
  const currentByOperator = new Map<string, string | null>();
  const uniqueSegments = Array.from(new Map(input.segments.map(row => [row.id, row])).values());
  const outputShifts = shifts.map(shift => {
    currentByOperator.set(shift.operator_user_id, shift.current_crop_structure_id);
    const segments = uniqueSegments.filter(segment => segment.shift_id === shift.id);
    let pending = !shift.closed_at || !segments.length;
    let issue = false;
    let confirmedHa = 0;
    const rows = segments.map(segment => {
      const area = numeric(segment.planned_area_ha);
      const delta = numeric(segment.hectares_segment);
      const final = numeric(segment.ended_field_total_ha);
      const invalid = Boolean(shift.closed_at && segment.closed_at && (
        (segment.hectares_segment != null && delta == null)
        || (area != null && ((delta ?? 0) > area + 0.001 || (final ?? 0) > area + 0.001))
      ));
      const unknown = !shift.closed_at || !segment.closed_at || delta == null;
      const confirmed = !unknown && !invalid ? delta! : 0;
      pending ||= unknown;
      issue ||= invalid;
      confirmedHa += confirmed;
      return { segment, confirmed, unknown, invalid };
    });
    const parentTotal = numeric(shift.hectares_shift);
    if (shift.closed_at && (!pending && (parentTotal == null || Math.abs(parentTotal - confirmedHa) > 0.001))) issue = true;
    for (const { segment, confirmed, unknown, invalid } of rows) {
      const metadata = plotInfo.get(segment.crop_structure_id);
      const plot = plotTotals.get(segment.crop_structure_id) ?? {
        ...(metadata ?? { id: segment.crop_structure_id, label: "Участок не указан", areaHa: numeric(segment.planned_area_ha), totalHa: null, status: "unknown" }),
        workdayHa: null, confirmedHa: 0, pending: false, issue: false, isCurrent: false,
      };
      plot.confirmedHa = rounded(plot.confirmedHa + confirmed);
      plot.pending ||= unknown;
      plot.issue ||= invalid || issue;
      plotTotals.set(plot.id, plot);
    }
    return { id: shift.id, operatorName: shift.operator_name, openedAt: shift.opened_at, closedAt: shift.closed_at,
      currentPlotId: shift.current_crop_structure_id, hectares: pending || issue ? null : rounded(confirmedHa),
      confirmedHa: rounded(confirmedHa), pending, issue,
      fields: Array.from(new Set(rows.map(row => row.segment.crop_structure_id))).map(id => {
        const parts = rows.filter(row => row.segment.crop_structure_id === id);
        const waiting = parts.some(row => row.unknown);
        return { id, label: plotInfo.get(id)?.label || "Поле не указано", pending: waiting,
          hectares: waiting || issue ? null : rounded(parts.reduce((sum, row) => sum + row.confirmed, 0)) };
      }) };
  });
  for (const id of Array.from(currentByOperator.values())) {
    if (id && !plotTotals.has(id) && plotInfo.has(id)) {
      plotTotals.set(id, { ...plotInfo.get(id)!, workdayHa: null, confirmedHa: 0, pending: true, issue: false, isCurrent: true });
    }
  }
  const plots = Array.from(plotTotals.values()).map(plot => {
    const invalidLifetime = plot.areaHa != null && plot.totalHa != null && plot.totalHa > plot.areaHa + 0.001;
    const issue = plot.issue || invalidLifetime || (plot.areaHa != null && plot.confirmedHa > plot.areaHa + 0.001);
    return { ...plot, issue, workdayHa: plot.pending || issue ? null : plot.confirmedHa,
      totalHa: invalidLifetime ? null : plot.totalHa, isCurrent: Array.from(currentByOperator.values()).includes(plot.id) };
  });
  const pending = outputShifts.some(shift => shift.pending) || plots.some(plot => plot.pending);
  const issue = outputShifts.some(shift => shift.issue) || plots.some(plot => plot.issue);
  const confirmedHa = rounded(outputShifts.reduce((total, shift) => total + shift.confirmedHa, 0));
  return { companyId: input.companyId, serverTime: input.serverTime, readOnly: true, period: input.period,
    confirmedHa, totalHa: pending || issue || !shifts.length ? null : confirmedHa, pending, issue, shifts: outputShifts, plots };
}
