import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { ensureMaterialRequestForOperation } from "@/app/api/operations/_material-request-helper";

const CREATE_ALLOWED_ROLES = ["global_admin", "company_admin", "agronomist"] as const;

type CreateOperationBody = {
  companyId?: string | null;
  field_id?: string;
  crop_structure_id?: string | null;
  operation_category_slug?: string | null;
  operation_type_slug?: string | null;
  operation_type?: string;
  planned_area_ha?: number | null;
  crop_id?: string | null;
  machine_id?: string | null;
  equipment_id?: string | null;
  transport_id?: string | null;
  operation_target?: string | null;
  rate_per_ha?: number | null;
  spray_volume_per_ha?: number | null;
  materials?: Array<{
    material_type?: string | null;
    product_id?: string | null;
    batch_id?: string | null;
    planned_rate?: number | null;
    actual_rate?: number | null;
    unit?: string | null;
    notes?: string | null;
  }>;
  date?: string;
  responsible_user_id?: string | null;
  notes?: string | null;
};

function toNullableUuid(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toNullableText(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

const MATERIAL_TYPES = new Set([
  "seed",
  "fertilizer",
  "pesticide",
  "adjuvant",
  "ph_corrector",
  "defoamer",
  "biological",
  "fuel",
  "organic",
]);

const MATERIAL_UNITS = new Set(["kg", "l", "pcs"]);

function inferUnitByMaterialType(materialType: string): "kg" | "l" | "pcs" {
  if (materialType === "pesticide" || materialType === "adjuvant" || materialType === "ph_corrector" || materialType === "defoamer") {
    return "l";
  }
  if (materialType === "seed" || materialType === "fertilizer" || materialType === "organic" || materialType === "biological") {
    return "kg";
  }
  return "kg";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as CreateOperationBody;
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, toNullableText(body.companyId));
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...CREATE_ALLOWED_ROLES],
    });

    const fieldId = String(body.field_id || "").trim();
    if (!fieldId) return NextResponse.json({ error: "field_id is required" }, { status: 400 });

    const operationType = String(body.operation_type || "").trim();
    if (!operationType) return NextResponse.json({ error: "operation_type is required" }, { status: 400 });

    const dateRaw = String(body.date || "").trim();
    if (!dateRaw) return NextResponse.json({ error: "date is required" }, { status: 400 });
    const operationDate = normalizeDate(dateRaw);

    const plannedArea = toNullableNumber(body.planned_area_ha);
    if (plannedArea != null && plannedArea < 0) {
      return NextResponse.json({ error: "planned_area_ha must be >= 0" }, { status: 400 });
    }

    const cropStructureId = toNullableUuid(body.crop_structure_id);
    const responsibleUserId = toNullableUuid(body.responsible_user_id);

    let resolvedCropId = toNullableUuid(body.crop_id);
    let resolvedVarietyId: string | null = null;
    let resolvedReproductionId: string | null = null;

    if (cropStructureId) {
      const { data: structureRow, error: structureError } = await supabase
        .from("crop_structure")
        .select("crop_id,variety_id,reproduction_id")
        .eq("id", cropStructureId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (structureError) {
        return NextResponse.json({ error: structureError.message }, { status: 400 });
      }
      if (structureRow) {
        resolvedCropId = resolvedCropId || toNullableUuid((structureRow as any).crop_id);
        resolvedVarietyId = toNullableUuid((structureRow as any).variety_id);
        resolvedReproductionId = toNullableUuid((structureRow as any).reproduction_id);
      }
    }

    const operationPayload = {
      company_id: companyId,
      field_id: fieldId,
      crop_structure_id: cropStructureId,
      operation_category_slug: toNullableText(body.operation_category_slug),
      operation_type_slug: toNullableText(body.operation_type_slug),
      operation_type: operationType,
      machine_id: toNullableUuid(body.machine_id),
      equipment_id: toNullableUuid(body.equipment_id),
      transport_id: toNullableUuid(body.transport_id),
      operation_target: toNullableText(body.operation_target),
      rate_per_ha: toNullableNumber(body.rate_per_ha),
      spray_volume_per_ha: toNullableNumber(body.spray_volume_per_ha),
      operation_config: {},
      date: operationDate,
      responsible_user_id: responsibleUserId,
      notes: toNullableText(body.notes),
      status: "planned",
      work_status: "active",
      user_id: actor.authUserId,
    };

    const { data: operationRow, error: operationError } = await supabase
      .from("operations")
      .insert(operationPayload)
      .select("*")
      .single();

    if (operationError || !operationRow?.id) {
      return NextResponse.json({ error: operationError?.message || "Failed to create operation" }, { status: 400 });
    }

    const rawMaterials = Array.isArray(body.materials) ? body.materials : [];
    const materialRows = rawMaterials
      .map((item) => {
        const materialType = String(item?.material_type || "").trim().toLowerCase();
        const productId = toNullableUuid(item?.product_id);
        if (!MATERIAL_TYPES.has(materialType) || !productId) return null;
        const requestedUnit = String(item?.unit || "").trim().toLowerCase();
        const unit = (MATERIAL_UNITS.has(requestedUnit) ? requestedUnit : inferUnitByMaterialType(materialType)) as "kg" | "l" | "pcs";
        const plannedRate = toNullableNumber(item?.planned_rate);
        const actualRate = toNullableNumber(item?.actual_rate);
        return {
          company_id: companyId,
          operation_id: String(operationRow.id),
          operation_line_id: null,
          product_id: productId,
          batch_id: toNullableUuid(item?.batch_id),
          material_type: materialType,
          unit,
          planned_rate: plannedRate,
          actual_rate: actualRate,
          notes: toNullableText(item?.notes),
          created_by_user_id: actor.authUserId,
          updated_by_user_id: actor.authUserId,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (materialRows.length > 0) {
      const { error: materialInsertError } = await supabase.from("operation_materials").insert(materialRows);
      if (materialInsertError) {
        await supabase.from("operations").delete().eq("id", operationRow.id).eq("company_id", companyId);
        return NextResponse.json({ error: materialInsertError.message || "Failed to save operation materials" }, { status: 400 });
      }
    }

    const materialRequestResult = await ensureMaterialRequestForOperation({
      supabase,
      companyId,
      operationId: String(operationRow.id),
      fieldId,
      operationDate,
      notes: toNullableText(body.notes),
      responsibleUserId,
      plannedAreaHa: plannedArea,
      cropId: resolvedCropId,
      varietyId: resolvedVarietyId,
      reproductionId: resolvedReproductionId,
    });

    return NextResponse.json({
      operation: operationRow,
      material_request: materialRequestResult,
    });
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
