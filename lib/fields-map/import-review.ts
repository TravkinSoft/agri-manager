import type { FieldMapPreviewMatch } from "@/lib/types/fields-map";

export const FIELD_MAP_SKIP_DECISION = "__skip__";

export type FieldMapMatchDecisions = Record<string, string>;

export type FieldMapReviewSummary = {
  total: number;
  linked: number;
  skipped: number;
  pending: number;
  duplicateFieldIds: string[];
  duplicatePolygonIds: string[];
  canConfirm: boolean;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

export function resolveFieldMapDecision(
  row: FieldMapPreviewMatch,
  decisions: FieldMapMatchDecisions
): { fieldId: string | null; explicit: boolean; skipped: boolean } {
  if (Object.prototype.hasOwnProperty.call(decisions, row.polygon_id)) {
    const decision = clean(decisions[row.polygon_id]);
    if (!decision || decision === FIELD_MAP_SKIP_DECISION) {
      return { fieldId: null, explicit: true, skipped: true };
    }
    return { fieldId: decision, explicit: true, skipped: false };
  }

  if (row.match_status === "matched" && clean(row.field_id)) {
    return { fieldId: clean(row.field_id), explicit: false, skipped: false };
  }

  return { fieldId: null, explicit: false, skipped: false };
}

export function buildFieldMapConfirmOverrides(
  rows: readonly FieldMapPreviewMatch[],
  decisions: FieldMapMatchDecisions
): Array<{ polygon_id: string; field_id: string | null }> {
  return rows.flatMap((row) => {
    if (!Object.prototype.hasOwnProperty.call(decisions, row.polygon_id)) return [];
    const resolved = resolveFieldMapDecision(row, decisions);
    return [{ polygon_id: row.polygon_id, field_id: resolved.fieldId }];
  });
}

export function summarizeFieldMapReview(
  rows: readonly FieldMapPreviewMatch[],
  decisions: FieldMapMatchDecisions
): FieldMapReviewSummary {
  const polygonIds = new Map<string, number>();
  const fieldAssignments = new Map<string, number>();
  let linked = 0;
  let skipped = 0;
  let pending = 0;

  rows.forEach((row) => {
    polygonIds.set(row.polygon_id, (polygonIds.get(row.polygon_id) || 0) + 1);
    const resolution = resolveFieldMapDecision(row, decisions);
    if (resolution.fieldId) {
      linked += 1;
      fieldAssignments.set(resolution.fieldId, (fieldAssignments.get(resolution.fieldId) || 0) + 1);
      return;
    }
    if (resolution.skipped) {
      skipped += 1;
      return;
    }
    pending += 1;
  });

  const duplicateFieldIds = Array.from(fieldAssignments.entries())
    .filter(([, count]) => count > 1)
    .map(([fieldId]) => fieldId);
  const duplicatePolygonIds = Array.from(polygonIds.entries())
    .filter(([, count]) => count > 1)
    .map(([polygonId]) => polygonId);

  return {
    total: rows.length,
    linked,
    skipped,
    pending,
    duplicateFieldIds,
    duplicatePolygonIds,
    canConfirm:
      rows.length > 0 &&
      linked > 0 &&
      pending === 0 &&
      duplicateFieldIds.length === 0 &&
      duplicatePolygonIds.length === 0,
  };
}
