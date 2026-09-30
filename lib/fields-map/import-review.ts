import type { FieldMapPreviewMatch } from "@/lib/types/fields-map";

export const FIELD_MAP_SKIP_DECISION = "__skip__";
export const FIELD_MAP_UNLINKED_DECISION = "__unlinked__";

export type FieldMapMatchDecisions = Record<string, string>;
export type FieldMapConfirmOverride = {
  polygon_id: string;
  field_id: string | null;
  // An omitted action with a null field_id remains the legacy explicit skip.
  action?: "link" | "unlinked" | "skip";
};

export type FieldMapDecisionResolution = {
  fieldId: string | null;
  explicit: boolean;
  skipped: boolean;
  unlinked: boolean;
  action: "link" | "unlinked" | "skip";
};

export type FieldMapReviewSummary = {
  total: number;
  linked: number;
  unlinked: number;
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
): FieldMapDecisionResolution {
  if (Object.prototype.hasOwnProperty.call(decisions, row.polygon_id)) {
    const decision = clean(decisions[row.polygon_id]);
    if (!decision || decision === FIELD_MAP_SKIP_DECISION) {
      return { fieldId: null, explicit: true, skipped: true, unlinked: false, action: "skip" };
    }
    if (decision === FIELD_MAP_UNLINKED_DECISION) {
      return { fieldId: null, explicit: true, skipped: false, unlinked: true, action: "unlinked" };
    }
    return { fieldId: decision, explicit: true, skipped: false, unlinked: false, action: "link" };
  }

  if (row.match_status === "matched" && clean(row.field_id)) {
    return { fieldId: clean(row.field_id), explicit: false, skipped: false, unlinked: false, action: "link" };
  }

  // A valid source contour is useful on its own. Ambiguous suggestions must not
  // create a field or silently attach to a candidate; preserve it unlinked.
  return { fieldId: null, explicit: false, skipped: false, unlinked: true, action: "unlinked" };
}

export function buildFieldMapConfirmOverrides(
  rows: readonly FieldMapPreviewMatch[],
  decisions: FieldMapMatchDecisions
): FieldMapConfirmOverride[] {
  return rows.flatMap((row) => {
    const resolved = resolveFieldMapDecision(row, decisions);
    if (!resolved.explicit && !resolved.unlinked) return [];
    return [{ polygon_id: row.polygon_id, field_id: resolved.fieldId, action: resolved.action }];
  });
}

export function summarizeFieldMapReview(
  rows: readonly FieldMapPreviewMatch[],
  decisions: FieldMapMatchDecisions
): FieldMapReviewSummary {
  const polygonIds = new Map<string, number>();
  const fieldAssignments = new Map<string, number>();
  let linked = 0;
  let unlinked = 0;
  let skipped = 0;

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
    unlinked += 1;
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
    unlinked,
    skipped,
    // Retained for callers of the earlier review contract. Unknown contours
    // now have a safe default decision rather than a blocking pending state.
    pending: 0,
    duplicateFieldIds,
    duplicatePolygonIds,
    canConfirm:
      rows.length > 0 &&
      linked + unlinked > 0 &&
      duplicateFieldIds.length === 0 &&
      duplicatePolygonIds.length === 0,
  };
}
