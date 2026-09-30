export type HarvestAreaSegment = {
  id: string;
  shift_id: string;
  closed_at: string | null;
  hectares_segment: number | string | null;
};

/** A closed field segment is not a closed combine shift. Never count planned ha. */
export function confirmedPlotHectares(
  segments: HarvestAreaSegment[],
  shifts: Array<{ id: string; closed_at: string | null }>,
  before: string,
) {
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
  const end = Date.parse(before);
  let harvestedAreaHa = 0;
  let areaPending = false;
  let combineShiftOpen = false;
  for (const segment of Array.from(new Map(segments.map((row) => [row.id, row])).values())) {
    const shift = shiftById.get(segment.shift_id);
    const shiftClosed = Boolean(shift?.closed_at && Date.parse(shift.closed_at) < end);
    const segmentClosed = Boolean(segment.closed_at && Date.parse(segment.closed_at) < end);
    const hectares = segment.hectares_segment == null ? NaN : Number(segment.hectares_segment);
    combineShiftOpen ||= Boolean(shift && !shift.closed_at);
    if (!shiftClosed || !segmentClosed || !Number.isFinite(hectares) || hectares < 0) {
      areaPending = true;
      continue;
    }
    harvestedAreaHa += hectares;
  }
  return { harvestedAreaHa: harvestedAreaHa > 0 ? harvestedAreaHa : null, areaPending, combineShiftOpen };
}
