import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

const READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "warehouse",
  "warehouse_operator",
  "brigadier",
] as const;

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function isPotatoCrop(cropName: string): boolean {
  const normalized = normalizeText(cropName).toLowerCase();
  return normalized.includes("картоф") || normalized.includes("potato");
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
      .order("created_at", { ascending: false })
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
    const operationIds = Array.from(new Set(lineRows.map((row: any) => String(row.operation_id || "")).filter(Boolean)));

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

    lineRows.forEach((line: any) => {
      const lineId = String(line.id);
      const operationId = String(line.operation_id || "");
      const matchedConsumptions = (consumptions || []).filter((item: any) => {
        if (String(item.operation_line_id || "") === lineId) return true;
        if (item.operation_line_id) return false;
        return String(item.operation_id || "") === operationId;
      });

      const plannedArea = asNumber(line.planned_area_ha);
      const actualAreaRaw = line.actual_area_ha == null ? null : asNumber(line.actual_area_ha);
      const actualArea = actualAreaRaw == null || actualAreaRaw <= 0 ? null : actualAreaRaw;
      const completionPct = actualArea != null && plannedArea > 0 ? (actualArea / plannedArea) * 100 : null;

      if (!matchedConsumptions.length) {
        resultRows.push({
          operation_id: operationId,
          operation_line_id: lineId,
          operation_date: line.operations?.date || null,
          field_name: line.fields?.name || "—",
          crop_name: line.crops?.name || "Картофель",
          variety_name: line.varieties?.name || null,
          reproduction_name: line.reproductions?.name || null,
          planned_area_ha: plannedArea,
          actual_area_ha: actualArea,
          completion_pct: completionPct,
          material_name: "—",
          material_category: null,
          issued_qty_kg: 0,
          fact_qty_per_ha: null,
          planned_norm_per_ha: null,
          deviation_per_ha: null,
        });
        return;
      }

      const byMaterial = new Map<string, { qty: number; norms: number[]; category: string | null; name: string }>();
      matchedConsumptions.forEach((item: any) => {
        const materialName = normalizeText(item.products?.name) || "Материал";
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
      });

      byMaterial.forEach((value) => {
        const plannedNorm = value.norms.length
          ? value.norms.reduce((sum, n) => sum + n, 0) / value.norms.length
          : null;
        const factPerHa = actualArea && actualArea > 0 ? value.qty / actualArea : null;
        resultRows.push({
          operation_id: operationId,
          operation_line_id: lineId,
          operation_date: line.operations?.date || null,
          field_name: line.fields?.name || "—",
          crop_name: line.crops?.name || "Картофель",
          variety_name: line.varieties?.name || null,
          reproduction_name: line.reproductions?.name || null,
          planned_area_ha: plannedArea,
          actual_area_ha: actualArea,
          completion_pct: completionPct,
          material_name: value.name,
          material_category: value.category,
          issued_qty_kg: value.qty,
          fact_qty_per_ha: factPerHa,
          planned_norm_per_ha: plannedNorm,
          deviation_per_ha: factPerHa != null && plannedNorm != null ? factPerHa - plannedNorm : null,
        });
      });
    });

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
