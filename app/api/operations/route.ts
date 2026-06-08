import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { ensureMaterialRequestForOperation } from "@/app/api/operations/_material-request-helper";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import {
  buildExecutionFactModelMetadata,
  buildWarehouseWorkflowMetadata,
  getTankMixComponentDefinition,
  normalizePurposeList,
  resolveCanonicalOperationType,
  toStorageMaterialType,
} from "@/lib/operations/operation-engine";

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
  purposes?: unknown;
  tank_mix?: {
    enabled?: boolean | null;
    water_rate_l_ha?: number | null;
    total_solution_l_ha?: number | null;
    components?: Array<{
      component_type?: string | null;
      material_type?: string | null;
      product_id?: string | null;
      batch_id?: string | null;
      planned_rate?: number | null;
      actual_rate?: number | null;
      unit?: string | null;
      notes?: string | null;
    }>;
  } | null;
  materials?: Array<{
    component_type?: string | null;
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
  "water",
  "other",
]);

const MATERIAL_UNITS = new Set(["kg", "l", "pcs"]);

function inferUnitByMaterialType(materialType: string): "kg" | "l" | "pcs" {
  if (
    materialType === "pesticide" ||
    materialType === "adjuvant" ||
    materialType === "ph_corrector" ||
    materialType === "defoamer" ||
    materialType === "water"
  ) {
    return "l";
  }
  if (materialType === "seed" || materialType === "fertilizer" || materialType === "organic" || materialType === "biological") {
    return "kg";
  }
  return "kg";
}

function allowsDefaultOperationLine(categorySlug: string | null, typeSlug: string | null, operationType: string): boolean {
  const canonical = resolveCanonicalOperationType({ categorySlug, typeSlug, operationType });
  if (canonical?.requiresCropStructure) return true;
  const category = String(categorySlug || "").trim().toLowerCase();
  const merged = `${category} ${String(typeSlug || "").toLowerCase()} ${operationType.toLowerCase()}`;
  return ["seed", "sow", "plant", "harvest", "\u043f\u043e\u0441\u0435\u0432", "\u043f\u043e\u0441\u0430\u0434", "\u0443\u0431\u043e\u0440\u043a"].some((token) => merged.includes(token));
}

function requiresCropStructure(categorySlug: string | null, typeSlug: string | null, operationType: string): boolean {
  const canonical = resolveCanonicalOperationType({ categorySlug, typeSlug, operationType });
  if (canonical) return canonical.requiresCropStructure;

  const category = String(categorySlug || "").trim().toLowerCase();
  const type = String(typeSlug || "").trim().toLowerCase();
  const label = operationType.trim().toLowerCase();
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

    const fieldId = toNullableUuid(body.field_id);

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

    const operationCategorySlug = toNullableText(body.operation_category_slug);
    const requestedTypeSlug = toNullableText(body.operation_type_slug);
    const canonicalType = resolveCanonicalOperationType({
      categorySlug: operationCategorySlug,
      typeSlug: requestedTypeSlug,
      operationType,
    });
    const operationTypeSlug = canonicalType?.slug || requestedTypeSlug;
    const canonicalCategorySlug = canonicalType?.categorySlug || operationCategorySlug;
    const purposes = normalizePurposeList(body.purposes);
    const cropStructureRequired = requiresCropStructure(canonicalCategorySlug, operationTypeSlug, operationType);
    if (cropStructureRequired && !fieldId) {
      return NextResponse.json({ error: "field_id is required for production operations" }, { status: 400 });
    }
    if (cropStructureRequired && !cropStructureId) {
      return NextResponse.json(
        { error: "crop_structure_id is required for production operations" },
        { status: 400 }
      );
    }

    let resolvedCropId = toNullableUuid(body.crop_id);
    let resolvedVarietyId: string | null = null;
    let resolvedReproductionId: string | null = null;
    let resolvedStructureArea: number | null = null;
    let resolvedSeasonId: string | null = null;
    let resolvedSeasonYear: number | null = null;

    if (cropStructureId) {
      const { data: structureRow, error: structureError } = await supabase
        .from("crop_structure")
        .select("id,field_id,crop_id,variety_id,reproduction_id,area,season_id,seasons:season_id(year)")
        .eq("id", cropStructureId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (structureError) {
        return NextResponse.json({ error: structureError.message }, { status: 400 });
      }
      if (!structureRow?.id) {
        return NextResponse.json({ error: "crop_structure_id does not belong to this company" }, { status: 400 });
      }
      if (fieldId && String((structureRow as any).field_id || "") !== fieldId) {
        return NextResponse.json({ error: "crop_structure_id must belong to selected field" }, { status: 400 });
      }
      if (structureRow) {
        resolvedCropId = toNullableUuid((structureRow as any).crop_id);
        resolvedVarietyId = toNullableUuid((structureRow as any).variety_id);
        resolvedReproductionId = toNullableUuid((structureRow as any).reproduction_id);
        resolvedSeasonId = toNullableUuid((structureRow as any).season_id);
        const seasonPayload = Array.isArray((structureRow as any).seasons)
          ? (structureRow as any).seasons[0]
          : (structureRow as any).seasons;
        const seasonYear = Number(seasonPayload?.year || 0);
        resolvedSeasonYear = Number.isFinite(seasonYear) && seasonYear > 0 ? seasonYear : null;
        const structureArea = Number((structureRow as any).area || 0);
        resolvedStructureArea = Number.isFinite(structureArea) && structureArea > 0 ? structureArea : null;
      }
    }

    const effectivePlannedArea = plannedArea && plannedArea > 0 ? plannedArea : resolvedStructureArea;
    const rawMaterials = Array.isArray(body.materials) ? body.materials : [];
    const rawTankComponents = Array.isArray(body.tank_mix?.components) ? body.tank_mix?.components || [] : [];
    const operationComponents = [...rawMaterials, ...rawTankComponents].filter(
      (item, index, source) =>
        index ===
        source.findIndex(
          (candidate) =>
            String(candidate?.product_id || "") === String(item?.product_id || "") &&
            String(candidate?.component_type || candidate?.material_type || "") === String(item?.component_type || item?.material_type || "") &&
            String(candidate?.planned_rate ?? "") === String(item?.planned_rate ?? "")
        )
    );
    const productIds = Array.from(
      new Set(operationComponents.map((item) => toNullableUuid(item?.product_id)).filter(Boolean) as string[])
    );
    if (productIds.length > 0) {
      const { data: warehouseRows, error: warehouseError } = await supabase
        .from("warehouses")
        .select("id,name,warehouse_type,description,archived,is_archived")
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_archived", false);
      if (warehouseError) {
        return NextResponse.json({ error: warehouseError.message }, { status: 400 });
      }
      const productionWarehouseIds = (warehouseRows || [])
        .filter((row: any) => !hasQaDataMarker(`${row.name || ""} ${row.warehouse_type || ""} ${row.description || ""}`))
        .map((row: any) => String(row.id || ""))
        .filter(Boolean);
      if (productionWarehouseIds.length === 0) {
        return NextResponse.json(
          { error: "Нет остатка на складе для выбранного материала" },
          { status: 400 }
        );
      }
      const { data: stockRows, error: stockError } = await supabase
        .from("v_stock_balance_identity")
        .select("warehouse_id,product_id,quantity")
        .eq("company_id", companyId)
        .in("warehouse_id", productionWarehouseIds)
        .in("product_id", productIds)
        .gt("quantity", 0);
      if (stockError) {
        return NextResponse.json({ error: stockError.message }, { status: 400 });
      }
      const availableProducts = new Set((stockRows || []).map((row: any) => String(row.product_id || "")));
      const missingProductId = productIds.find((productId) => !availableProducts.has(productId));
      if (missingProductId) {
        return NextResponse.json(
          { error: "Нет остатка на складе для выбранного материала", product_id: missingProductId },
          { status: 400 }
        );
      }
    }

    const tankMixComponents = operationComponents.map((item) => {
      const componentType = String(item?.component_type || item?.material_type || "other").trim().toLowerCase();
      const definition = getTankMixComponentDefinition(componentType);
      const requestedUnit = String(item?.unit || "").trim().toLowerCase();
      const unit = (MATERIAL_UNITS.has(requestedUnit) ? requestedUnit : definition.defaultUnit) as "kg" | "l" | "pcs";
      return {
        component_type: definition.slug,
        storage_material_type: definition.storageMaterialType,
        product_id: toNullableUuid(item?.product_id),
        batch_id: toNullableUuid(item?.batch_id),
        planned_rate: toNullableNumber(item?.planned_rate),
        actual_rate: toNullableNumber(item?.actual_rate),
        unit,
        notes: toNullableText(item?.notes),
        product_required: definition.productRequired,
      };
    });

    const operationConfig = {
      operation_engine_type: canonicalType?.slug || operationTypeSlug || null,
      operation_engine_label: canonicalType?.label || operationType,
      purposes,
      tank_mix: {
        enabled: Boolean(body.tank_mix?.enabled || canonicalType?.supportsTankMix),
        water_rate_l_ha: toNullableNumber(body.tank_mix?.water_rate_l_ha),
        total_solution_l_ha: toNullableNumber(body.tank_mix?.total_solution_l_ha ?? body.spray_volume_per_ha),
        components: tankMixComponents,
      },
      warehouse_workflow: buildWarehouseWorkflowMetadata(),
      execution_fact_model: buildExecutionFactModelMetadata(),
      planned_area_ha: effectivePlannedArea,
      crop_id: resolvedCropId,
      variety_id: resolvedVarietyId,
      reproduction_id: resolvedReproductionId,
      season_id: resolvedSeasonId,
      season_year: resolvedSeasonYear,
    };

    const operationPayload = {
      company_id: companyId,
      field_id: fieldId,
      crop_structure_id: cropStructureId,
      operation_category_slug: canonicalCategorySlug,
      operation_type_slug: operationTypeSlug,
      operation_type: operationType,
      machine_id: toNullableUuid(body.machine_id),
      equipment_id: toNullableUuid(body.equipment_id),
      transport_id: toNullableUuid(body.transport_id),
      operation_target: toNullableText(body.operation_target),
      rate_per_ha: toNullableNumber(body.rate_per_ha),
      spray_volume_per_ha: toNullableNumber(body.spray_volume_per_ha),
      operation_config: operationConfig,
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

    const materialRows = operationComponents
      .map((item) => {
        const componentType = String(item?.component_type || item?.material_type || "other").trim().toLowerCase();
        const materialType = toStorageMaterialType(componentType);
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
          notes: toNullableText(item?.notes) || `component:${componentType}`,
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

    let defaultOperationLine: Record<string, unknown> | null = null;
    let operationLineWarning: string | null = null;
    if (allowsDefaultOperationLine(canonicalCategorySlug, operationTypeSlug, operationType)) {
      let effectiveArea = plannedArea && plannedArea > 0 ? plannedArea : resolvedStructureArea;
      if (!effectiveArea) {
        const { data: fieldRow } = await supabase
          .from("fields")
          .select("area")
          .eq("id", fieldId)
          .eq("company_id", companyId)
          .maybeSingle();
        const fieldArea = Number((fieldRow as any)?.area || 0);
        effectiveArea = Number.isFinite(fieldArea) && fieldArea > 0 ? fieldArea : 0;
      }

      const { data: lineRow, error: lineError } = await supabase
        .from("operation_lines")
        .insert({
          company_id: companyId,
          operation_id: String(operationRow.id),
          field_id: fieldId,
          crop_id: resolvedCropId,
          variety_id: resolvedVarietyId,
          reproduction_id: resolvedReproductionId,
          planned_area_ha: effectiveArea,
          actual_area_ha: null,
          notes: cropStructureId ? "Auto-created from operation crop structure" : "Auto-created from operation",
          created_by_user_id: actor.authUserId,
          updated_by_user_id: actor.authUserId,
        })
        .select("*")
        .single();

      if (lineError || !lineRow?.id) {
        operationLineWarning = lineError?.message || "Failed to create default operation line";
      } else {
        defaultOperationLine = lineRow as Record<string, unknown>;
      }
    }

    let materialRequestResult: Record<string, unknown> = { created: false, skipped_reason: "not_attempted" };
    if (fieldId) {
      try {
        materialRequestResult = await ensureMaterialRequestForOperation({
          supabase,
          companyId,
          operationId: String(operationRow.id),
          fieldId,
          operationDate,
          notes: toNullableText(body.notes),
          responsibleUserId,
          plannedAreaHa: effectivePlannedArea ?? plannedArea,
          cropId: resolvedCropId,
          varietyId: resolvedVarietyId,
          reproductionId: resolvedReproductionId,
        });
      } catch (requestError) {
        materialRequestResult = {
          created: false,
          skipped_reason: "request_exception",
          error: requestError instanceof Error ? requestError.message : "Failed to create material request",
        };
      }
    } else {
      materialRequestResult = { created: false, skipped_reason: "no_field_context" };
    }

    return NextResponse.json({
      operation: {
        ...operationRow,
        planned_area_ha: defaultOperationLine?.planned_area_ha ?? effectivePlannedArea ?? plannedArea,
        crop_id: resolvedCropId,
      },
      operation_line: defaultOperationLine,
      operation_line_warning: operationLineWarning,
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
