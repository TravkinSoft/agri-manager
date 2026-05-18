import { supabase } from "@/lib/supabase/client";
import { createOperation } from "@/lib/services/operations";

export type CareSeason = { id: string; year: number };
export type CareCrop = { id: string; name_ru: string | null; name_en: string | null; name: string | null };
export type CareVariety = { id: string; crop_id: string; name: string };
export type CareField = { id: string; name: string; area: number };

export type TreatmentStepProduct = {
  id: string;
  product_id: string;
  product_name: string;
  dose_value: number | null;
  dose_unit: string | null;
  product_role: string | null;
  is_optional: boolean;
};

export type TreatmentStep = {
  id: string;
  step_no: number;
  step_name: string;
  agronomic_purpose: string | null;
  timing_note: string | null;
  condition_note: string | null;
  is_mandatory: boolean;
  products: TreatmentStepProduct[];
};

export type TreatmentProgram = {
  id: string;
  company_id: string;
  season_id: string | null;
  crop_id: string;
  variety_id: string;
  name_ru: string;
  description: string | null;
  status: "draft" | "approved" | "archived";
  is_active: boolean;
  crop_name: string;
  variety_name: string;
  steps: TreatmentStep[];
};

export type ProgramField = {
  link_id: string;
  field_id: string;
  field_name: string;
  field_area: number;
  planned_area: number;
  link_status: "active" | "completed" | "stopped";
};

export type StepExecution = {
  id: string;
  treatment_program_field_link_id: string;
  treatment_program_step_id: string;
  status: "waiting" | "ready" | "done" | "skipped" | "overdue";
  actual_operation_id: string | null;
  actual_date: string | null;
  notes: string | null;
};

export type CareContextData = {
  seasons: CareSeason[];
  crops: CareCrop[];
  varieties: CareVariety[];
  fields: CareField[];
  programs: TreatmentProgram[];
};

function cropLabel(crop: CareCrop): string {
  return String(crop.name_ru || crop.name || crop.name_en || "-");
}

export async function loadCareSystemsContext(
  companyId: string,
  filters: { seasonId?: string; cropId?: string; varietyId?: string } = {}
): Promise<CareContextData> {
  const [seasonsRes, cropsRes, varietiesRes, fieldsRes] = await Promise.all([
    supabase.from("seasons").select("id,year").eq("company_id", companyId).eq("archived", false).order("year", { ascending: false }),
    supabase.from("crops").select("id,name_ru,name_en,name").is("company_id", null).eq("archived", false).eq("is_active", true).order("name_ru"),
    supabase.from("varieties").select("id,crop_id,name").is("company_id", null).eq("archived", false).eq("is_active", true).order("name"),
    supabase.from("fields").select("id,name,area").eq("company_id", companyId).eq("archived", false).order("name"),
  ]);
  if (seasonsRes.error) throw new Error(seasonsRes.error.message);
  if (cropsRes.error) throw new Error(cropsRes.error.message);
  if (varietiesRes.error) throw new Error(varietiesRes.error.message);
  if (fieldsRes.error) throw new Error(fieldsRes.error.message);

  let programQuery = supabase
    .from("treatment_programs")
    .select("id,company_id,season_id,crop_id,variety_id,name_ru,description,status,is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  if (filters.seasonId) {
    programQuery = programQuery.or(`season_id.eq.${filters.seasonId},season_id.is.null`);
  }
  if (filters.cropId) programQuery = programQuery.eq("crop_id", filters.cropId);
  if (filters.varietyId) programQuery = programQuery.eq("variety_id", filters.varietyId);

  const programsRes = await programQuery;
  if (programsRes.error) throw new Error(programsRes.error.message);

  const crops = (cropsRes.data || []) as CareCrop[];
  const varieties = (varietiesRes.data || []) as CareVariety[];
  const cropMap = new Map(crops.map((x) => [x.id, x]));
  const varietyMap = new Map(varieties.map((x) => [x.id, x]));
  const rawPrograms = (programsRes.data || []) as any[];
  const programIds = rawPrograms.map((x) => x.id);

  const stepsByProgram = new Map<string, TreatmentStep[]>();
  if (programIds.length > 0) {
    const stepRes = await supabase
      .from("treatment_program_steps")
      .select("id,treatment_program_id,step_no,step_name,agronomic_purpose,timing_note,condition_note,is_mandatory")
      .in("treatment_program_id", programIds)
      .order("step_no", { ascending: true });
    if (stepRes.error) throw new Error(stepRes.error.message);
    const rawSteps = (stepRes.data || []) as any[];
    const stepIds = rawSteps.map((x) => x.id);

    const productsByStep = new Map<string, TreatmentStepProduct[]>();
    if (stepIds.length > 0) {
      const prodRes = await supabase
        .from("treatment_program_step_products")
        .select("id,treatment_program_step_id,product_id,dose_value,dose_unit,product_role,is_optional")
        .in("treatment_program_step_id", stepIds);
      if (prodRes.error) throw new Error(prodRes.error.message);
      const rawStepProducts = (prodRes.data || []) as any[];
      const productIds = Array.from(new Set(rawStepProducts.map((x) => x.product_id)));
      const namesRes = productIds.length
        ? await supabase.from("products").select("id,trade_name,name").in("id", productIds)
        : ({ data: [], error: null } as any);
      if (namesRes.error) throw new Error(namesRes.error.message);
      const productNameMap = new Map<string, string>((namesRes.data || []).map((x: any) => [x.id, String(x.trade_name || x.name || "-")]));
      for (const row of rawStepProducts) {
        const next: TreatmentStepProduct = {
          id: row.id,
          product_id: row.product_id,
          product_name: productNameMap.get(row.product_id) || "-",
          dose_value: row.dose_value,
          dose_unit: row.dose_unit,
          product_role: row.product_role || null,
          is_optional: Boolean(row.is_optional),
        };
        productsByStep.set(row.treatment_program_step_id, [...(productsByStep.get(row.treatment_program_step_id) || []), next]);
      }
    }

    for (const row of rawSteps) {
      const next: TreatmentStep = {
        id: row.id,
        step_no: row.step_no,
        step_name: row.step_name,
        agronomic_purpose: row.agronomic_purpose,
        timing_note: row.timing_note,
        condition_note: row.condition_note,
        is_mandatory: Boolean(row.is_mandatory),
        products: productsByStep.get(row.id) || [],
      };
      stepsByProgram.set(row.treatment_program_id, [...(stepsByProgram.get(row.treatment_program_id) || []), next]);
    }
  }

  const programs: TreatmentProgram[] = rawPrograms.map((row) => {
    const crop = cropMap.get(row.crop_id);
    const variety = varietyMap.get(row.variety_id);
    return {
      id: row.id,
      company_id: row.company_id,
      season_id: row.season_id,
      crop_id: row.crop_id,
      variety_id: row.variety_id,
      name_ru: row.name_ru,
      description: row.description,
      status: row.status,
      is_active: row.is_active,
      crop_name: crop ? cropLabel(crop) : "-",
      variety_name: variety?.name || "-",
      steps: (stepsByProgram.get(row.id) || []).sort((a, b) => a.step_no - b.step_no),
    };
  });

  return {
    seasons: (seasonsRes.data || []) as CareSeason[],
    crops,
    varieties,
    fields: (fieldsRes.data || []) as CareField[],
    programs,
  };
}

export async function createTreatmentProgram(input: {
  companyId: string;
  seasonId?: string | null;
  cropId: string;
  varietyId: string;
  nameRu: string;
  description?: string | null;
  userId: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("treatment_programs")
    .insert({
      company_id: input.companyId,
      season_id: input.seasonId || null,
      crop_id: input.cropId,
      variety_id: input.varietyId,
      name_ru: input.nameRu,
      description: input.description || null,
      created_by_user_id: input.userId,
      status: "draft",
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (input.seasonId) {
    await syncTreatmentProgramLinks(input.companyId, input.seasonId);
  }
  return String(data.id);
}

export async function addTreatmentProgramStep(input: {
  programId: string;
  stepNo: number;
  stepName: string;
  agronomicPurpose?: string | null;
  timingNote?: string | null;
  conditionNote?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from("treatment_program_steps")
    .upsert(
      {
        treatment_program_id: input.programId,
        step_no: input.stepNo,
        step_name: input.stepName,
        agronomic_purpose: input.agronomicPurpose || null,
        timing_note: input.timingNote || null,
        condition_note: input.conditionNote || null,
      },
      { onConflict: "treatment_program_id,step_no" }
    );
  if (error) throw new Error(error.message);
}

export async function getProgramFields(
  companyId: string,
  programId: string,
  seasonId?: string | null
): Promise<ProgramField[]> {
  let query = supabase
    .from("treatment_program_field_links")
    .select("id,field_id,season_id,crop_structure_row_id,status")
    .eq("company_id", companyId)
    .eq("treatment_program_id", programId)
    .neq("status", "stopped");
  if (seasonId) query = query.eq("season_id", seasonId);
  const linksRes = await query;
  if (linksRes.error) throw new Error(linksRes.error.message);
  const links = (linksRes.data || []) as any[];
  if (!links.length) return [];

  const fieldIds = Array.from(new Set(links.map((x) => x.field_id)));
  const cropRowsIds = Array.from(new Set(links.map((x) => x.crop_structure_row_id).filter(Boolean)));
  const [fieldsRes, cropRowsRes] = await Promise.all([
    supabase.from("fields").select("id,name,area").in("id", fieldIds),
    cropRowsIds.length ? supabase.from("crop_structure").select("id,area").in("id", cropRowsIds) : ({ data: [], error: null } as any),
  ]);
  if (fieldsRes.error) throw new Error(fieldsRes.error.message);
  if (cropRowsRes.error) throw new Error(cropRowsRes.error.message);
  const fieldMap = new Map<string, any>((fieldsRes.data || []).map((x: any) => [x.id, x]));
  const cropRowMap = new Map<string, any>((cropRowsRes.data || []).map((x: any) => [x.id, x]));

  return links.map((x) => ({
    link_id: x.id,
    field_id: x.field_id,
    field_name: fieldMap.get(x.field_id)?.name || "-",
    field_area: Number(fieldMap.get(x.field_id)?.area || 0),
    planned_area: Number(cropRowMap.get(x.crop_structure_row_id)?.area || 0),
    link_status: x.status,
  }));
}

export async function getStepExecutions(
  companyId: string,
  linkId: string
): Promise<StepExecution[]> {
  const { data, error } = await supabase
    .from("treatment_program_step_executions")
    .select("id,treatment_program_field_link_id,treatment_program_step_id,status,actual_operation_id,actual_date,notes")
    .eq("company_id", companyId)
    .eq("treatment_program_field_link_id", linkId);
  if (error) throw new Error(error.message);
  return (data || []) as StepExecution[];
}

export async function syncTreatmentProgramLinks(
  companyId: string,
  seasonId: string,
  fieldId?: string
): Promise<void> {
  const { error } = await supabase.rpc("sync_treatment_program_links", {
    p_company_id: companyId,
    p_season_id: seasonId,
    p_field_id: fieldId || null,
  });
  if (error) throw new Error(error.message);
}

export async function createOperationFromTreatmentStep(input: {
  companyId: string;
  linkId: string;
  stepId: string;
}): Promise<string> {
  const linkRes = await supabase
    .from("treatment_program_field_links")
    .select("id,field_id,treatment_program_id")
    .eq("company_id", input.companyId)
    .eq("id", input.linkId)
    .single();
  if (linkRes.error) throw new Error(linkRes.error.message);

  const [stepRes, productsRes] = await Promise.all([
    supabase
      .from("treatment_program_steps")
      .select("id,step_no,step_name,agronomic_purpose,timing_note")
      .eq("treatment_program_id", linkRes.data.treatment_program_id)
      .eq("id", input.stepId)
      .single(),
    supabase
      .from("treatment_program_step_products")
      .select("id,product_id,dose_value,dose_unit,product_role")
      .eq("treatment_program_step_id", input.stepId),
  ]);
  if (stepRes.error) throw new Error(stepRes.error.message);
  if (productsRes.error) throw new Error(productsRes.error.message);

  const productIds = (productsRes.data || []).map((x: any) => x.product_id);
  const namesRes = productIds.length
    ? await supabase.from("products").select("id,trade_name,name").in("id", productIds)
    : ({ data: [], error: null } as any);
  if (namesRes.error) throw new Error(namesRes.error.message);
  const productMap = new Map((namesRes.data || []).map((x: any) => [x.id, String(x.trade_name || x.name || "-")]));

  const noteLines = (productsRes.data || []).map((x: any) => {
    const dose = x.dose_value != null ? `${x.dose_value}${x.dose_unit ? ` ${x.dose_unit}` : ""}` : "-";
    return `- ${productMap.get(x.product_id) || "-"} (${x.product_role || "main"}, доза: ${dose})`;
  });

  const created = await createOperation(input.companyId, {
    field_id: linkRes.data.field_id,
    crop_structure_id: null,
    operation_type: stepRes.data.step_name,
    date: new Date().toISOString().slice(0, 10),
    responsible_user_id: null,
    notes: [
      `Программа обработок: ${stepRes.data.step_name}`,
      stepRes.data.agronomic_purpose ? `Цель: ${stepRes.data.agronomic_purpose}` : "",
      stepRes.data.timing_note ? `Окно: ${stepRes.data.timing_note}` : "",
      noteLines.length ? "Продукты:\n" + noteLines.join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const execRes = await supabase
    .from("treatment_program_step_executions")
    .update({
      status: "done",
      actual_operation_id: created.id,
      actual_date: new Date().toISOString().slice(0, 10),
    })
    .eq("company_id", input.companyId)
    .eq("treatment_program_field_link_id", input.linkId)
    .eq("treatment_program_step_id", input.stepId);
  if (execRes.error) throw new Error(execRes.error.message);

  return created.id;
}

export async function updateTreatmentExecutionStatus(input: {
  companyId: string;
  executionId: string;
  status: StepExecution["status"];
  notes?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from("treatment_program_step_executions")
    .update({
      status: input.status,
      notes: input.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", input.executionId);
  if (error) throw new Error(error.message);
}
