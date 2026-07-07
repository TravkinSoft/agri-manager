import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { resolveCanonicalOperationType } from "@/lib/operations/operation-engine";
import { calculateMaterialReconciliation, roundMaterialQuantity } from "@/lib/materials/reconciliation";
import {
  SeasonGuardError,
  assertSeasonWritableForMutation,
  resolveOperationSeasonIdForGuard,
} from "@/lib/seasons/season-guard";

const COMPLETE_ALLOWED_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "specialist",
  "brigadier",
] as const;

function requiresCropStructure(categorySlug: string | null, typeSlug: string | null, operationType: string | null): boolean {
  const canonical = resolveCanonicalOperationType({ categorySlug, typeSlug, operationType });
  if (canonical) return canonical.requiresCropStructure;

  const category = String(categorySlug || "").trim().toLowerCase();
  const type = String(typeSlug || "").trim().toLowerCase();
  const label = String(operationType || "").trim().toLowerCase();
  const merged = `${category} ${type} ${label}`;

  if (["logistics", "service", "service_operations", "post_harvest", "processing"].includes(category)) {
    return false;
  }

  return [
    "soil_preparation",
    "seeding_planting",
    "fertilization",
    "plant_protection",
    "crop_care",
    "irrigation",
    "harvesting",
    "spray",
    "seed",
    "sow",
    "plant",
    "fertiliz",
    "harvest",
    "полив",
    "посев",
    "посад",
    "удобрен",
    "опрыск",
    "уборк",
    "уход",
  ].some((token) => merged.includes(token));
}

function hasPositiveNumber(value: unknown): boolean {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0;
}

function nullablePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isV5SchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /operation_status|specialist_task_status|planned_area_ha|completed_area_ha|remaining_area_ha|progress_percent|loss_quantity|expected_consumed_quantity|shortage_quantity|reconciliation_status|schema cache|column/i.test(message);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) {
      return NextResponse.json({ error: "operation id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const comment = String(body.comment || "").trim();
    const lineFacts = Array.isArray(body.lineFacts) ? body.lineFacts : [];
    const materialFacts = Array.isArray(body.materialFacts) ? body.materialFacts : [];
    const fallbackActualArea = nullablePositiveNumber(body.actualAreaHa);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...COMPLETE_ALLOWED_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,responsible_user_id,work_status,status,crop_structure_id,field_id,operation_category_slug,operation_type_slug,operation_type")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (operationError || !operation?.id) {
      return NextResponse.json(
        { error: operationError?.message || "Operation not found" },
        { status: 404 }
      );
    }

    const isAdmin =
      actor.role === "global_admin" || actor.role === "company_admin" || actor.role === "agronomist";
    const responsibleId = String(operation.responsible_user_id || "").trim();
    if (!isAdmin && responsibleId && responsibleId !== actor.id) {
      return NextResponse.json({ error: "Operation is assigned to another specialist" }, { status: 403 });
    }

    const guardedSeasonId = await resolveOperationSeasonIdForGuard(supabase, {
      companyId,
      cropStructureId: (operation as any).crop_structure_id,
    });
    await assertSeasonWritableForMutation(supabase, {
      companyId,
      seasonId: guardedSeasonId,
      actionLabel: "Operation completion",
    });

    const isProductionOperation = requiresCropStructure(
      String(operation.operation_category_slug || ""),
      String(operation.operation_type_slug || ""),
      String(operation.operation_type || "")
    );

    if (isProductionOperation && !operation.crop_structure_id) {
      return NextResponse.json(
        { error: "Production operation cannot be completed without crop_structure_id" },
        { status: 400 }
      );
    }

    if (isProductionOperation && !comment) {
      return NextResponse.json({ error: "Completion comment is required" }, { status: 400 });
    }

    let completedOperationMaterialsForHistory: any[] = [];

    if (isProductionOperation) {
      const { data: lines, error: linesError } = await supabase
        .from("operation_lines")
        .select("id,planned_area_ha,actual_area_ha")
        .eq("operation_id", operationId)
        .eq("company_id", companyId);
      if (linesError) {
        return NextResponse.json({ error: linesError.message }, { status: 400 });
      }

      let normalizedLines = lines || [];
      const lineFactsById = new Map<string, number | null>();
      for (const rawFact of lineFacts) {
        const lineId = String(rawFact?.lineId || rawFact?.id || "").trim();
        if (!lineId) continue;
        const actualArea = nullablePositiveNumber(rawFact?.actualAreaHa ?? rawFact?.actual_area_ha);
        if (actualArea == null || actualArea <= 0) {
          return NextResponse.json({ error: "Actual area must be greater than zero" }, { status: 400 });
        }
        lineFactsById.set(lineId, actualArea);
      }

      if (lineFactsById.size > 0 || (fallbackActualArea != null && normalizedLines.length === 1)) {
        const updatedLines: any[] = [];
        for (const line of normalizedLines as any[]) {
          const actualArea = lineFactsById.get(String(line.id)) ?? (normalizedLines.length === 1 ? fallbackActualArea : null);
          if (actualArea == null) {
            updatedLines.push(line);
            continue;
          }
          const plannedArea = Number(line.planned_area_ha || 0);
          if (plannedArea > 0 && actualArea > plannedArea + 0.000001) {
            return NextResponse.json(
              { error: "Actual area cannot exceed planned area", line_id: line.id },
              { status: 400 }
            );
          }
          const { data: updatedLine, error: lineUpdateError } = await supabase
            .from("operation_lines")
            .update({ actual_area_ha: Number(actualArea.toFixed(3)) })
            .eq("id", line.id)
            .eq("operation_id", operationId)
            .eq("company_id", companyId)
            .select("id,planned_area_ha,actual_area_ha")
            .single();
          if (lineUpdateError || !updatedLine?.id) {
            return NextResponse.json(
              { error: lineUpdateError?.message || "Failed to update actual area" },
              { status: 400 }
            );
          }
          updatedLines.push(updatedLine);
        }
        normalizedLines = updatedLines;
      }

      const hasActualArea = (normalizedLines || []).some((line: any) => hasPositiveNumber(line.actual_area_ha));
      if (!hasActualArea) {
        return NextResponse.json({ error: "Actual area is required before completion" }, { status: 400 });
      }

      const plannedAreaForCompletion = (normalizedLines || []).reduce(
        (sum: number, line: any) => sum + Number(line.planned_area_ha || 0),
        0
      );
      const actualAreaForCompletion = (normalizedLines || []).reduce(
        (sum: number, line: any) => sum + Number(line.actual_area_ha || 0),
        0
      );
      if (plannedAreaForCompletion > 0 && actualAreaForCompletion + 0.000001 < plannedAreaForCompletion) {
        return NextResponse.json(
          {
            error:
              "Operation cannot be completed while actual area is below planned area. Submit progress instead.",
            planned_area_ha: Number(plannedAreaForCompletion.toFixed(4)),
            actual_area_ha: Number(actualAreaForCompletion.toFixed(4)),
            remaining_area_ha: Number((plannedAreaForCompletion - actualAreaForCompletion).toFixed(4)),
          },
          { status: 409 }
        );
      }

      const { data: materials, error: materialsError } = await supabase
        .from("operation_materials")
        .select("id,product_id,actual_rate,planned_quantity,issued_quantity,consumed_quantity,returned_quantity,loss_quantity")
        .eq("operation_id", operationId)
        .eq("company_id", companyId);
      if (materialsError) {
        return NextResponse.json({ error: materialsError.message }, { status: 400 });
      }

      let normalizedMaterials = materials || [];
      if (materialFacts.length > 0 && normalizedMaterials.length > 0) {
        const materialFactsById = new Map<string, any>();
        for (const rawFact of materialFacts) {
          const materialId = String(rawFact?.materialId || rawFact?.id || "").trim();
          if (!materialId) continue;
          const actualRate = rawFact?.actualRate === null || rawFact?.actualRate === undefined || rawFact?.actualRate === ""
            ? null
            : nullablePositiveNumber(rawFact.actualRate);
          const consumedQuantity = rawFact?.consumedQuantity === null || rawFact?.consumedQuantity === undefined || rawFact?.consumedQuantity === ""
            ? null
            : nullablePositiveNumber(rawFact.consumedQuantity);
          const returnedQuantity = rawFact?.returnedQuantity === null || rawFact?.returnedQuantity === undefined || rawFact?.returnedQuantity === ""
            ? null
            : nullablePositiveNumber(rawFact.returnedQuantity);
          const lossQuantity = rawFact?.lossQuantity === null || rawFact?.lossQuantity === undefined || rawFact?.lossQuantity === ""
            ? 0
            : nullablePositiveNumber(rawFact.lossQuantity);
          if (
            (rawFact?.actualRate !== null && rawFact?.actualRate !== undefined && rawFact?.actualRate !== "" && actualRate == null) ||
            (rawFact?.consumedQuantity !== null && rawFact?.consumedQuantity !== undefined && rawFact?.consumedQuantity !== "" && consumedQuantity == null) ||
            (rawFact?.returnedQuantity !== null && rawFact?.returnedQuantity !== undefined && rawFact?.returnedQuantity !== "" && returnedQuantity == null) ||
            (rawFact?.lossQuantity !== null && rawFact?.lossQuantity !== undefined && rawFact?.lossQuantity !== "" && lossQuantity == null)
          ) {
            return NextResponse.json({ error: "Material fact values must be zero or positive" }, { status: 400 });
          }
          materialFactsById.set(materialId, { actualRate, consumedQuantity, returnedQuantity, lossQuantity });
        }

        const updatedMaterials: any[] = [];
        for (const material of normalizedMaterials as any[]) {
          const fact = materialFactsById.get(String(material.id));
          if (!fact) {
            updatedMaterials.push(material);
            continue;
          }
          const issued = Number(material.issued_quantity || 0);
          const consumed = fact.consumedQuantity ?? material.consumed_quantity ?? null;
          const returned = fact.returnedQuantity ?? material.returned_quantity ?? 0;
          const loss = fact.lossQuantity ?? material.loss_quantity ?? 0;
          if (issued > 0 && Number(consumed || 0) + Number(returned || 0) + Number(loss || 0) > issued + 0.000001) {
            return NextResponse.json(
              { error: "Material fact cannot exceed issued quantity", material_id: material.id },
              { status: 400 }
            );
          }
          let updateQuery = supabase
            .from("operation_materials")
            .update({
              actual_rate: fact.actualRate,
              consumed_quantity: consumed,
              returned_quantity: returned,
              loss_quantity: loss,
            })
            .eq("id", material.id)
            .eq("operation_id", operationId)
            .eq("company_id", companyId)
            .select("id,product_id,actual_rate,planned_quantity,issued_quantity,consumed_quantity,returned_quantity,loss_quantity")
            .single();
          let { data: updatedMaterial, error: materialUpdateError }: { data: any | null; error: any } = await updateQuery;
          if (materialUpdateError && isV5SchemaError(materialUpdateError)) {
            const fallback = await supabase
              .from("operation_materials")
              .update({
                actual_rate: fact.actualRate,
                consumed_quantity: consumed,
                returned_quantity: returned,
              })
              .eq("id", material.id)
              .eq("operation_id", operationId)
              .eq("company_id", companyId)
              .select("id,product_id,actual_rate,planned_quantity,issued_quantity,consumed_quantity,returned_quantity")
              .single();
            updatedMaterial = fallback.data;
            materialUpdateError = fallback.error;
          }
          if (materialUpdateError || !updatedMaterial?.id) {
            return NextResponse.json(
              { error: materialUpdateError?.message || "Failed to update material facts" },
              { status: 400 }
            );
          }
          updatedMaterials.push(updatedMaterial);
        }
        normalizedMaterials = updatedMaterials;
      }

      const incompleteMaterial = (normalizedMaterials || []).find((material: any) => {
        const actualRateSet = material.actual_rate !== null && material.actual_rate !== undefined;
        const consumedSet = material.consumed_quantity !== null && material.consumed_quantity !== undefined;
        const returnedSet = material.returned_quantity !== null && material.returned_quantity !== undefined;
        const issued = Number(material.issued_quantity || 0);
        if (issued > 0) return !consumedSet || !returnedSet;
        return !actualRateSet && !consumedSet;
      });

      if (incompleteMaterial) {
        return NextResponse.json(
          { error: "Actual material usage and returns are required before completion", material_id: incompleteMaterial.id },
          { status: 400 }
        );
      }

      const impossibleMaterialFact = (normalizedMaterials || []).find((material: any) => {
        const issued = Number(material.issued_quantity || 0);
        const consumed = Number(material.consumed_quantity || 0);
        const returned = Number(material.returned_quantity || 0);
        const loss = Number(material.loss_quantity || 0);
        return issued > 0 && consumed + returned + loss > issued;
      });

      if (impossibleMaterialFact) {
        return NextResponse.json(
          {
            error: "Material fact cannot exceed issued quantity",
            material_id: impossibleMaterialFact.id,
          },
          { status: 400 }
        );
      }

      const linkedRequestItemByProduct = new Map<string, any>();
      const { data: closeCheckRequests, error: closeCheckRequestsError } = await supabase
        .from("warehouse_issue_requests")
        .select("id")
        .eq("operation_id", operationId)
        .eq("company_id", companyId)
        .in("status", ["issued", "issued_by_warehouse", "partially_issued", "received_confirmed"]);

      if (closeCheckRequestsError) {
        return NextResponse.json(
          { error: closeCheckRequestsError.message || "Failed to load linked material requests" },
          { status: 400 }
        );
      }

      const closeCheckRequestIds = (closeCheckRequests || [])
        .map((requestRow: any) => String(requestRow.id))
        .filter(Boolean);

      if (closeCheckRequestIds.length > 0) {
        const requestItemsResult = await supabase
          .from("warehouse_issue_request_items")
          .select("product_id,return_received_quantity,substitution_status,planned_product_id,actual_product_id")
          .eq("company_id", companyId)
          .in("request_id", closeCheckRequestIds);

        if (requestItemsResult.error) {
          if (!isV5SchemaError(requestItemsResult.error)) {
            return NextResponse.json(
              { error: requestItemsResult.error.message || "Failed to load linked request item facts" },
              { status: 400 }
            );
          }
        } else {
          for (const item of requestItemsResult.data || []) {
            const productId = String((item as any).product_id || "");
            if (productId && !linkedRequestItemByProduct.has(productId)) {
              linkedRequestItemByProduct.set(productId, item);
            }
          }
        }
      }

      const unreconciledMaterial = (normalizedMaterials || []).map((material: any) => {
        const requestItem = linkedRequestItemByProduct.get(String(material.product_id || ""));
        const reconciliation = calculateMaterialReconciliation({
          plannedQuantity: Number(material.planned_quantity || 0),
          plannedAreaHa: plannedAreaForCompletion,
          actualCompletedAreaHa: actualAreaForCompletion,
          issuedQuantity: Number(material.issued_quantity || 0),
          consumedQuantity: material.consumed_quantity,
          returnedQuantity: material.returned_quantity,
          returnReceivedQuantity: requestItem?.return_received_quantity,
          lossQuantity: material.loss_quantity || 0,
          substitutionStatus: requestItem?.substitution_status,
          plannedProductId: requestItem?.planned_product_id,
          actualProductId: requestItem?.actual_product_id,
        });
        return { material, reconciliation };
      }).find((row: any) => !row.reconciliation.canClose);

      if (unreconciledMaterial) {
        return NextResponse.json(
          {
            error: "Material reconciliation is required before operation close",
            material_id: unreconciledMaterial.material.id,
            reasons: unreconciledMaterial.reconciliation.closeBlockingReasons,
          },
          { status: 409 }
        );
      }

      const materialFactsForRequests = (normalizedMaterials || []).filter((material: any) => {
        return (
          material.product_id &&
          material.consumed_quantity !== null &&
          material.consumed_quantity !== undefined &&
          material.returned_quantity !== null &&
          material.returned_quantity !== undefined
        );
      });

      if (materialFactsForRequests.length > 0) {
        const { data: linkedRequests, error: linkedRequestsError } = await supabase
          .from("warehouse_issue_requests")
          .select("id")
          .eq("operation_id", operationId)
          .eq("company_id", companyId)
          .in("status", ["issued", "issued_by_warehouse", "partially_issued", "received_confirmed"]);

        if (linkedRequestsError) {
          return NextResponse.json(
            { error: linkedRequestsError.message || "Failed to load linked material requests" },
            { status: 400 }
          );
        }

        const requestIds = (linkedRequests || []).map((requestRow: any) => String(requestRow.id)).filter(Boolean);
        if (requestIds.length > 0) {
          for (const material of materialFactsForRequests as any[]) {
            const reconciliation = calculateMaterialReconciliation({
              plannedQuantity: Number(material.planned_quantity || 0),
              plannedAreaHa: plannedAreaForCompletion,
              actualCompletedAreaHa: actualAreaForCompletion,
              issuedQuantity: Number(material.issued_quantity || 0),
              consumedQuantity: Number(material.consumed_quantity || 0),
              returnedQuantity: Number(material.returned_quantity || 0),
              lossQuantity: Number(material.loss_quantity || 0),
            });

            if (!reconciliation.canClose) {
              return NextResponse.json(
                {
                  error: "Material reconciliation is required before operation close",
                  material_id: material.id,
                  reasons: reconciliation.closeBlockingReasons,
                },
                { status: 409 }
              );
            }

            let requestItemSyncResult = await supabase
              .from("warehouse_issue_request_items")
              .update({
                consumed_quantity: roundMaterialQuantity(Number(material.consumed_quantity || 0)),
                returned_quantity: roundMaterialQuantity(Number(material.returned_quantity || 0)),
                loss_quantity: roundMaterialQuantity(Number(material.loss_quantity || 0)),
                expected_consumed_quantity: reconciliation.expectedConsumedQuantity,
                expected_return_quantity: reconciliation.expectedReturnQuantity,
                shortage_quantity: reconciliation.shortageQuantity,
                reconciliation_status: reconciliation.reconciliationStatus,
              })
              .eq("company_id", companyId)
              .eq("product_id", material.product_id)
              .in("request_id", requestIds);

            if (requestItemSyncResult.error && isV5SchemaError(requestItemSyncResult.error)) {
              requestItemSyncResult = await supabase
                .from("warehouse_issue_request_items")
                .update({
                  consumed_quantity: roundMaterialQuantity(Number(material.consumed_quantity || 0)),
                  returned_quantity: roundMaterialQuantity(Number(material.returned_quantity || 0)),
                })
                .eq("company_id", companyId)
                .eq("product_id", material.product_id)
                .in("request_id", requestIds);
            }

            if (requestItemSyncResult.error) {
              return NextResponse.json(
                { error: requestItemSyncResult.error.message || "Failed to sync request material facts" },
                { status: 400 }
              );
            }
          }
        }
      }

      completedOperationMaterialsForHistory = normalizedMaterials || [];
    }

    const nowIso = new Date().toISOString();
    const { data: completedLines } = await supabase
      .from("operation_lines")
      .select("planned_area_ha,actual_area_ha")
      .eq("operation_id", operationId)
      .eq("company_id", companyId);
    const plannedFromLines = (completedLines || []).reduce((sum: number, line: any) => sum + Number(line.planned_area_ha || 0), 0);
    const actualFromLines = (completedLines || []).reduce((sum: number, line: any) => sum + Number(line.actual_area_ha || 0), 0);
    const finalPlannedArea = plannedFromLines > 0 ? plannedFromLines : Number(fallbackActualArea || 0);
    const finalActualArea = actualFromLines > 0 ? actualFromLines : Number(fallbackActualArea || 0);
    const finalProgressPercent = finalPlannedArea > 0 ? Math.min((finalActualArea / finalPlannedArea) * 100, 100) : 100;
    const baseCompletionPatch = {
      work_status: "completed",
      status: "completed",
      completed_at: nowIso,
      specialist_comment: comment || null,
      updated_at: nowIso,
    };
    const v5CompletionPatch = {
      ...baseCompletionPatch,
      operation_status: "completed",
      specialist_task_status: "completed",
      planned_area_ha: Number(finalPlannedArea.toFixed(4)),
      completed_area_ha: Number(finalActualArea.toFixed(4)),
      remaining_area_ha: Math.max(Number((finalPlannedArea - finalActualArea).toFixed(4)), 0),
      progress_percent: Number(finalProgressPercent.toFixed(2)),
      last_progress_at: nowIso,
    };

    let updateResult = await supabase
      .from("operations")
      .update(v5CompletionPatch)
      .eq("id", operationId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (updateResult.error && isV5SchemaError(updateResult.error)) {
      updateResult = await supabase
        .from("operations")
        .update(baseCompletionPatch)
        .eq("id", operationId)
        .eq("company_id", companyId)
        .select("*")
        .single();
    }

    if (updateResult.error || !updateResult.data?.id) {
      return NextResponse.json(
        { error: updateResult.error?.message || "Failed to complete operation" },
        { status: 400 }
      );
    }

    if (isProductionOperation && operation.field_id && guardedSeasonId) {
      const { data: seasonRow } = await supabase
        .from("seasons")
        .select("year,name")
        .eq("id", guardedSeasonId)
        .eq("company_id", companyId)
        .maybeSingle();
      const seasonYear = Number((seasonRow as any)?.year || (seasonRow as any)?.name || new Date().getFullYear());
      const materialFactsForHistory = (completedOperationMaterialsForHistory || []).map((material: any) => ({
        product_id: material.product_id,
        planned_quantity: Number(material.planned_quantity || 0),
        issued_quantity: Number(material.issued_quantity || 0),
        consumed_quantity: Number(material.consumed_quantity || 0),
        returned_quantity: Number(material.returned_quantity || 0),
        loss_quantity: Number(material.loss_quantity || 0),
        actual_rate: material.actual_rate,
      }));
      const historyBase = {
        company_id: companyId,
        field_id: operation.field_id,
        season_id: guardedSeasonId,
        season_year: Number.isFinite(seasonYear) ? seasonYear : new Date().getFullYear(),
        history_value: `Operation completed: ${operation.operation_type || "field work"}`,
        original_raw_value: operation.operation_type || "operation completed",
        source: "operation_close",
        notes: comment || null,
      };
      let historyInsertResult = await supabase.from("field_history_entries").insert({
        ...historyBase,
        operation_id: operationId,
        actual_completed_area_ha: Number(finalActualArea.toFixed(4)),
        material_facts: materialFactsForHistory,
        material_reconciliation_status: "reconciled",
      });
      if (historyInsertResult.error && isV5SchemaError(historyInsertResult.error)) {
        historyInsertResult = await supabase.from("field_history_entries").insert(historyBase);
      }
      if (historyInsertResult.error) {
        return NextResponse.json(
          { error: historyInsertResult.error.message || "Failed to write field history" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ operation: updateResult.data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SeasonGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
