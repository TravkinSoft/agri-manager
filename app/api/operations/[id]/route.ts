import { NextRequest, NextResponse } from "next/server";
import { PlanCalculationError } from "@/lib/materials/operation-plan-calculation";
import { calculateTreatmentRequest, isVersionedTreatment, treatmentRows } from "@/lib/server/treatment-plan-calculation";
import { mergeTreatmentPlanContext } from "@/lib/server/treatment-plan-context";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";
import {
  isMachineryCompatible,
  machineryCompatibilityMessage,
} from "@/lib/operations/machinery-compatibility";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) return NextResponse.json({ error: "operation id is required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyIdInput = String(body.companyId || "").trim() || null;
    const operationPatch =
      body.operationPatch && typeof body.operationPatch === "object"
        ? (body.operationPatch as Record<string, unknown>)
        : {};
    let materials = Array.isArray(body.materials) ? body.materials : null;
    if (!materials) return NextResponse.json({ error: "Complete material set is required" }, { status: 400 });

    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, companyIdInput);
    const supabase = await getUserScopedClientFromRequest(request);
    const idempotency = requireOperationIdempotency(request, { ...body, operationId, action: "material_edit" });

    const { data: existingOperation, error: existingError } = await supabase
      .from("operations")
      .select("id,operation_category_slug,operation_type_slug,operation_type,machine_id,equipment_id,operation_config,planned_area_ha,spray_volume_per_ha")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingError || !existingOperation?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Operation not found" },
        { status: 404 }
      );
    }

    const storedConfig = existingOperation.operation_config || {};
    const treatmentType = isVersionedTreatment(existingOperation.operation_type_slug) || isVersionedTreatment(String(operationPatch.operation_type_slug || ""));
    const rollout = treatmentType ? await supabase.rpc("agro_a1_enabled", { p_company_id: companyId }) : null;
    if (rollout?.error) throw new PlanCalculationError("Не удалось проверить доступность расчёта A1.");
    if ((treatmentType && rollout?.data === true) || storedConfig.plan_calculation) {
      if (body.calculation_revision !== true) {
        return NextResponse.json({ error: "Подтвердите новую ревизию расчёта. Сохранённый план не пересчитывается автоматически." }, { status: 409 });
      }
      // The database also checks the revision while holding the operation lock.
      const expected = Number(body.calculation_expected_revision);
      if (!Number.isInteger(expected) || expected < 0) {
        return NextResponse.json({ error: "План изменён. Откройте актуальную версию." }, { status: 409 });
      }
      const mergedConfig = mergeTreatmentPlanContext(storedConfig, operationPatch.operation_config);
      const requestedConfig = operationPatch.operation_config as Record<string, any> | undefined;
      const snapshot = calculateTreatmentRequest({
        area: Object.hasOwn(operationPatch,"planned_area_ha") ? operationPatch.planned_area_ha : existingOperation.planned_area_ha,
        solutionRate: requestedConfig?.tank_mix?.total_solution_l_ha ?? operationPatch.spray_volume_per_ha ?? existingOperation.spray_volume_per_ha,
        materials, actorId: actor.id, now: new Date().toISOString(),
      });
      materials = treatmentRows(snapshot, materials);
      operationPatch.operation_config = { ...mergedConfig,
        plan_calculation: snapshot, calculation_revision: expected + 1,
        calculation_expected_revision: expected,
        // History is appended by the database from its own stored rows.
        calculation_history: storedConfig.calculation_history || [],
        tank_mix: { ...mergedConfig.tank_mix, total_solution_l_ha: snapshot.input.solution_rate_l_ha, components: materials },
      };
      operationPatch.spray_volume_per_ha = snapshot.input.solution_rate_l_ha;
    }

    const operationCategory =
      operationPatch.operation_category_slug ?? existingOperation.operation_category_slug;
    const operationType =
      operationPatch.operation_type_slug ??
      existingOperation.operation_type_slug ??
      operationPatch.operation_type ??
      existingOperation.operation_type;
    const machineId = String(
      operationPatch.machine_id ?? existingOperation.machine_id ?? ""
    ).trim();
    const equipmentId = String(
      operationPatch.equipment_id ?? existingOperation.equipment_id ?? ""
    ).trim();

    if (machineId) {
      const { data: machine, error: machineError } = await supabase
        .from("reference_machines")
        .select("id,type,category,machine_category,machinery_type,global_model:global_machine_model_id(category)")
        .eq("id", machineId)
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_active", true)
        .maybeSingle();
      if (machineError || !machine?.id) {
        return NextResponse.json({ error: "Selected machine is unavailable" }, { status: 400 });
      }
      if (
        !isMachineryCompatible({
          operationCategory,
          operationType,
          assetKind: "machine",
          asset: machine,
        })
      ) {
        return NextResponse.json({ error: machineryCompatibilityMessage("machine") }, { status: 409 });
      }
    }
    if (equipmentId) {
      const { data: equipment, error: equipmentError } = await supabase
        .from("reference_equipment")
        .select("id,category,equipment_category,global_model:global_equipment_model_id(category,equipment_type)")
        .eq("id", equipmentId)
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_active", true)
        .maybeSingle();
      if (equipmentError || !equipment?.id) {
        return NextResponse.json({ error: "Selected equipment is unavailable" }, { status: 400 });
      }
      if (
        !isMachineryCompatible({
          operationCategory,
          operationType,
          assetKind: "equipment",
          asset: equipment,
        })
      ) {
        return NextResponse.json({ error: machineryCompatibilityMessage("equipment") }, { status: 409 });
      }
    }

    const { data, error } = await supabase.rpc("replace_operation_materials_atomic_v13", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_operation_id: operationId,
      p_operation_patch: operationPatch,
      p_materials: materials,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Operation changes were not saved");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof PlanCalculationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SessionAuthError || error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = operationMutationError(error, "Unknown error");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
