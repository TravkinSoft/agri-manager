import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

const READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "specialist",
  "warehouse",
  "warehouse_operator",
  "brigadier",
] as const;

type LinkageScope =
  | "line"
  | "operation_single_line"
  | "operation_identity_fallback"
  | "operation_first_line_fallback"
  | "none";

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function isPotatoCrop(cropName: string): boolean {
  const normalized = normalizeText(cropName).toLowerCase();
  return (
    normalized.includes("картоф") ||
    normalized.includes("potato") ||
    normalized.includes("рєр°сђс‚рѕс„")
  );
}

function matchesLineIdentity(item: any, line: any): boolean {
  const itemCropId = String(item?.crop_id || "").trim();
  const lineCropId = String(line?.crop_id || "").trim();
  if (itemCropId && lineCropId && itemCropId !== lineCropId) return false;

  const itemVarietyId = String(item?.variety_id || "").trim();
  const lineVarietyId = String(line?.variety_id || "").trim();
  if (itemVarietyId && lineVarietyId && itemVarietyId !== lineVarietyId) return false;

  const itemReproductionId = String(item?.reproduction_id || "").trim();
  const lineReproductionId = String(line?.reproduction_id || "").trim();
  if (itemReproductionId && lineReproductionId && itemReproductionId !== lineReproductionId) return false;

  return true;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const seasonYear = Number(request.nextUrl.searchParams.get("seasonYear") || 0) || null;
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 1000);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 5000) : 1000;

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    const { data: operationLines, error: operationLinesError } = await supabase
      .from("operation_lines")
      .select(`
        id,
        operation_id,
        field_id,
        crop_id,
        variety_id,
        reproduction_id,
        planned_area_ha,
        actual_area_ha,
        operations:operation_id(id,date,operation_type,company_id),
        fields:field_id(name),
        crops:crop_id(name),
        varieties:variety_id(name),
        reproductions:reproduction_id(name)
      `)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (operationLinesError) {
      return NextResponse.json({ error: operationLinesError.message }, { status: 400 });
    }

    const lineRows = (operationLines || []).filter((row: any) => {
      const cropName = normalizeText(row?.crops?.name);
      if (!isPotatoCrop(cropName)) return false;
      if (!seasonYear) return true;
      const opDate = normalizeText(row?.operations?.date);
      if (!opDate) return false;
      return new Date(opDate).getUTCFullYear() === seasonYear;
    });

    if (!lineRows.length) {
      return NextResponse.json({ rows: [] });
    }

    const operationLineIds = lineRows.map((row: any) => String(row.id));
    const operationIds = Array.from(
      new Set(lineRows.map((row: any) => String(row.operation_id || "")).filter(Boolean))
    );

    const { data: consumptions, error: consumptionsError } = await supabase
      .from("field_material_consumptions")
      .select(`
        id,
        operation_id,
        operation_line_id,
        field_id,
        crop_id,
        variety_id,
        reproduction_id,
        material_category,
        product_id,
        quantity_kg,
        norm_per_ha,
        products:product_id(name,type)
      `)
      .eq("company_id", companyId)
      .or(`operation_line_id.in.(${operationLineIds.join(",")}),operation_id.in.(${operationIds.join(",")})`);
    if (consumptionsError) {
      return NextResponse.json({ error: consumptionsError.message }, { status: 400 });
    }

    const resultRows: Array<Record<string, unknown>> = [];
    const lineIdsByOperation = new Map<string, string[]>();
    for (const line of lineRows) {
      const operationId = String(line.operation_id || "");
      const lineId = String(line.id);
      if (!operationId) continue;
      const bucket = lineIdsByOperation.get(operationId) || [];
      bucket.push(lineId);
      lineIdsByOperation.set(operationId, bucket);
    }

    const consumptionsByLine = new Map<string, any[]>();
    const consumptionsByOperation = new Map<string, any[]>();
    for (const item of consumptions || []) {
      const lineId = String(item?.operation_line_id || "").trim();
      if (lineId) {
        const bucket = consumptionsByLine.get(lineId) || [];
        bucket.push(item);
        consumptionsByLine.set(lineId, bucket);
        continue;
      }
      const operationId = String(item?.operation_id || "").trim();
      if (!operationId) continue;
      const bucket = consumptionsByOperation.get(operationId) || [];
      bucket.push(item);
      consumptionsByOperation.set(operationId, bucket);
    }
    const consumedFallbackIds = new Set<string>();

    for (const line of lineRows) {
      const lineId = String(line.id);
      const operationId = String(line.operation_id || "");
      const operationRel = relationOne<any>(line.operations);
      const fieldRel = relationOne<any>(line.fields);
      const cropRel = relationOne<any>(line.crops);
      const varietyRel = relationOne<any>(line.varieties);
      const reproductionRel = relationOne<any>(line.reproductions);
      const directMatched = consumptionsByLine.get(lineId) || [];
      let matchedConsumptions = [...directMatched];
      let linkageScope: LinkageScope = directMatched.length ? "line" : "none";

      if (!matchedConsumptions.length) {
        const opScoped = consumptionsByOperation.get(operationId) || [];
        const operationLineIdsForOperation = lineIdsByOperation.get(operationId) || [];
        if (opScoped.length > 0) {
          const singleLineOperation = operationLineIdsForOperation.length <= 1;
          if (singleLineOperation) {
            matchedConsumptions = opScoped.filter(
              (item: any) => !consumedFallbackIds.has(String(item.id || ""))
            );
            matchedConsumptions.forEach((item: any) => consumedFallbackIds.add(String(item.id || "")));
            if (matchedConsumptions.length) linkageScope = "operation_single_line";
          } else {
            const identityMatched = opScoped.filter((item: any) => {
              const itemId = String(item.id || "");
              if (consumedFallbackIds.has(itemId)) return false;
              return matchesLineIdentity(item, line);
            });
            if (identityMatched.length > 0) {
              matchedConsumptions = identityMatched;
              matchedConsumptions.forEach((item: any) => consumedFallbackIds.add(String(item.id || "")));
              linkageScope = "operation_identity_fallback";
            } else if (operationLineIdsForOperation[0] === lineId) {
              matchedConsumptions = opScoped.filter(
                (item: any) => !consumedFallbackIds.has(String(item.id || ""))
              );
              matchedConsumptions.forEach((item: any) => consumedFallbackIds.add(String(item.id || "")));
              if (matchedConsumptions.length) linkageScope = "operation_first_line_fallback";
            }
          }
        }
      }

      const plannedArea = asNumber(line.planned_area_ha);
      const actualAreaRaw = line.actual_area_ha == null ? null : asNumber(line.actual_area_ha);
      const actualArea = actualAreaRaw == null || actualAreaRaw <= 0 ? null : actualAreaRaw;
      const completionPct = actualArea != null && plannedArea > 0 ? (actualArea / plannedArea) * 100 : null;

      if (!matchedConsumptions.length) {
        resultRows.push({
          operation_id: operationId,
          operation_line_id: lineId,
          operation_date: operationRel?.date || null,
          field_name: fieldRel?.name || "-",
          crop_name: cropRel?.name || "Potato",
          variety_name: varietyRel?.name || null,
          reproduction_name: reproductionRel?.name || null,
          planned_area_ha: plannedArea,
          actual_area_ha: actualArea,
          completion_pct: completionPct,
          material_name: "-",
          material_category: null,
          issued_qty_kg: 0,
          fact_qty_per_ha: null,
          planned_norm_per_ha: null,
          planned_need_kg: null,
          remaining_need_kg: null,
          deviation_per_ha: null,
          linkage_scope: linkageScope,
        });
        continue;
      }

      const byMaterial = new Map<
        string,
        { qty: number; norms: number[]; category: string | null; name: string }
      >();
      for (const item of matchedConsumptions) {
        const materialName = normalizeText(item.products?.name) || "Material";
        const key = `${String(item.product_id || "")}|${materialName}`;
        const existing = byMaterial.get(key) || {
          qty: 0,
          norms: [],
          category: normalizeText(item.material_category) || normalizeText(item.products?.type) || null,
          name: materialName,
        };
        existing.qty += asNumber(item.quantity_kg);
        if (item.norm_per_ha != null) existing.norms.push(asNumber(item.norm_per_ha));
        byMaterial.set(key, existing);
      }

      byMaterial.forEach((value) => {
        const plannedNorm =
          value.norms.length > 0
            ? value.norms.reduce((sum, n) => sum + n, 0) / value.norms.length
            : null;
        const factPerHa = actualArea && actualArea > 0 ? value.qty / actualArea : null;
        const plannedNeedKg = plannedNorm != null && plannedArea > 0 ? plannedNorm * plannedArea : null;
        const remainingNeedKg = plannedNeedKg != null ? plannedNeedKg - value.qty : null;
        resultRows.push({
          operation_id: operationId,
          operation_line_id: lineId,
          operation_date: operationRel?.date || null,
          field_name: fieldRel?.name || "-",
          crop_name: cropRel?.name || "Potato",
          variety_name: varietyRel?.name || null,
          reproduction_name: reproductionRel?.name || null,
          planned_area_ha: plannedArea,
          actual_area_ha: actualArea,
          completion_pct: completionPct,
          material_name: value.name,
          material_category: value.category,
          issued_qty_kg: value.qty,
          fact_qty_per_ha: factPerHa,
          planned_norm_per_ha: plannedNorm,
          planned_need_kg: plannedNeedKg,
          remaining_need_kg: remainingNeedKg,
          deviation_per_ha: factPerHa != null && plannedNorm != null ? factPerHa - plannedNorm : null,
          linkage_scope: linkageScope,
        });
      });
    }

    return NextResponse.json({ rows: resultRows });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
