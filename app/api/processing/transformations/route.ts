import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";

const STORED_OUTPUT_TYPES = new Set([
  "cleaned_seed",
  "commodity",
  "forage_fraction",
  "waste_fraction",
  "treated_seed",
  "calibrated_fraction",
  "potato_marketable",
  "potato_seed",
  "potato_small",
  "potato_rotten",
  "other",
]);

const nameOf = (row: any, fallback = "-") =>
  String(row?.name_ru || row?.name || row?.full_name || row?.batch_code || fallback);

const batchLabel = (batch: any) => {
  if (!batch) return "Партия";
  const product = nameOf(batch.product || batch.crop, "Продукт");
  const variety = nameOf(batch.variety, "-");
  const reproduction = nameOf(batch.reproduction, "-");
  const code = batch.batch_code ? ` · ${batch.batch_code}` : "";
  return `${product} / ${variety} / ${reproduction}${code}`;
};

async function loadTransformationItems(supabase: ReturnType<typeof getServiceClient>, companyId: string) {
  const { data: transformations, error } = await supabase
    .from("batch_transformations")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  const rows = transformations || [];
  const ids = rows.map((row: any) => row.id);
  if (ids.length === 0) return [];

  const [
    { data: inputs, error: inputsError },
    { data: outputs, error: outputsError },
    { data: nodes },
  ] = await Promise.all([
    supabase.from("batch_transformation_inputs").select("*").in("transformation_id", ids),
    supabase.from("batch_transformation_outputs").select("*").in("transformation_id", ids),
    supabase.from("processing_nodes").select("id,name,type").eq("company_id", companyId),
  ]);

  if (inputsError) throw new Error(inputsError.message);
  if (outputsError) throw new Error(outputsError.message);

  const batchIds = Array.from(
    new Set([
      ...(inputs || []).map((row: any) => String(row.batch_id || "")).filter(Boolean),
      ...(outputs || []).map((row: any) => String(row.output_batch_id || "")).filter(Boolean),
    ])
  );
  const warehouseIds = Array.from(
    new Set([
      ...(inputs || []).map((row: any) => String(row.warehouse_from_id || "")).filter(Boolean),
      ...(outputs || []).map((row: any) => String(row.warehouse_to_id || "")).filter(Boolean),
    ])
  );

  const [{ data: batches }, { data: warehouses }] = await Promise.all([
    batchIds.length
      ? supabase
          .from("inventory_batches")
          .select(`
            id,batch_code,batch_class,product_id,crop_id,variety_id,reproduction_id,
            product:product_id(name,name_ru,full_name),
            crop:crop_id(name,name_ru,full_name),
            variety:variety_id(name,name_ru,full_name),
            reproduction:reproduction_id(name,name_ru,full_name)
          `)
          .in("id", batchIds)
      : Promise.resolve({ data: [] as any[] }),
    warehouseIds.length
      ? supabase.from("warehouses").select("id,name").in("id", warehouseIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const inputByTransformation = new Map<string, any[]>();
  for (const input of inputs || []) {
    const key = String(input.transformation_id || "");
    inputByTransformation.set(key, [...(inputByTransformation.get(key) || []), input]);
  }

  const outputByTransformation = new Map<string, any[]>();
  for (const output of outputs || []) {
    const key = String(output.transformation_id || "");
    outputByTransformation.set(key, [...(outputByTransformation.get(key) || []), output]);
  }

  const batchMap = new Map((batches || []).map((batch: any) => [String(batch.id), batch]));
  const warehouseMap = new Map((warehouses || []).map((warehouse: any) => [String(warehouse.id), nameOf(warehouse)]));
  const nodeMap = new Map((nodes || []).map((node: any) => [String(node.id), nameOf(node)]));

  return rows.map((row: any) => {
    const firstInput = (inputByTransformation.get(String(row.id)) || [])[0];
    const inputBatch = firstInput ? batchMap.get(String(firstInput.batch_id)) : null;
    return {
      id: row.id,
      company_id: row.company_id,
      transformation_type: row.transformation_type,
      status: row.status,
      processing_node_id: row.processing_node_id,
      processing_node_name: row.processing_node_id ? nodeMap.get(String(row.processing_node_id)) || null : null,
      source_ticket_id: row.source_ticket_id || null,
      started_at: row.started_at || null,
      completed_at: row.completed_at || null,
      created_at: row.created_at,
      note: row.note || null,
      input_label: inputBatch ? batchLabel(inputBatch) : "Партия",
      input_weight_kg: Number(firstInput?.input_weight_kg || 0),
      source_warehouse_name: firstInput?.warehouse_from_id ? warehouseMap.get(String(firstInput.warehouse_from_id)) || null : null,
      outputs: (outputByTransformation.get(String(row.id)) || []).map((output: any) => ({
        line_type: output.line_type,
        batch_class: output.batch_class || "",
        warehouse_to_name: output.warehouse_to_id ? warehouseMap.get(String(output.warehouse_to_id)) || null : null,
        output_weight_kg: Number(output.output_weight_kg || 0),
      })),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
    const actorUserId = String(request.nextUrl.searchParams.get("userId") || "").trim();
    if (!companyId || !actorUserId) {
      return NextResponse.json({ error: "companyId and userId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId,
      companyId,
      allowedRoles: ["admin", "warehouse", "weighman", "agronomist"],
    });

    const items = await loadTransformationItems(supabase, companyId);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const companyId = String(body.company_id || "").trim();
    const actorUserId = String(body.actor_user_id || "").trim();
    const input = body.input || {};
    const outputs = Array.isArray(body.outputs) ? body.outputs : [];

    if (!companyId || !actorUserId) {
      return NextResponse.json({ error: "company_id and actor_user_id are required" }, { status: 400 });
    }
    if (!body.transformation_type || !input.batch_id || !input.warehouse_from_id || Number(input.input_weight_kg || 0) <= 0) {
      return NextResponse.json({ error: "Заполните тип, входную партию, склад и массу входа" }, { status: 400 });
    }
    if (outputs.length === 0) {
      return NextResponse.json({ error: "Добавьте хотя бы один выход или потерю" }, { status: 400 });
    }

    const normalizedOutputs = outputs
      .map((output: any) => ({
        line_type: String(output.line_type || "other"),
        batch_class: String(output.batch_class || "commodity"),
        warehouse_to_id: output.warehouse_to_id ? String(output.warehouse_to_id) : null,
        output_weight_kg: Number(output.output_weight_kg || 0),
      }))
      .filter((output: any) => output.output_weight_kg > 0);

    if (normalizedOutputs.length === 0) {
      return NextResponse.json({ error: "Масса выходов/потерь должна быть больше 0" }, { status: 400 });
    }

    for (const output of normalizedOutputs) {
      if (STORED_OUTPUT_TYPES.has(output.line_type) && !output.warehouse_to_id) {
        return NextResponse.json({ error: "Для складского выхода нужен склад назначения" }, { status: 400 });
      }
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId,
      companyId,
      allowedRoles: ["admin", "warehouse", "weighman"],
    });

    const { data: batch, error: batchError } = await supabase
      .from("inventory_batches")
      .select("id,company_id")
      .eq("id", input.batch_id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (batchError || !batch?.id) {
      return NextResponse.json({ error: "Входная партия не найдена" }, { status: 400 });
    }

    const { data: transformation, error: transformationError } = await supabase
      .from("batch_transformations")
      .insert({
        company_id: companyId,
        processing_node_id: body.processing_node_id || null,
        transformation_type: body.transformation_type,
        status: "draft",
        source_ticket_id: body.source_ticket_id || null,
        started_at: new Date().toISOString(),
        created_by: actorUserId,
        note: body.note || null,
      })
      .select("id")
      .single();

    if (transformationError || !transformation?.id) {
      return NextResponse.json({ error: transformationError?.message || "Не удалось создать трансформацию" }, { status: 400 });
    }

    const { error: inputError } = await supabase.from("batch_transformation_inputs").insert({
      company_id: companyId,
      transformation_id: transformation.id,
      batch_id: input.batch_id,
      warehouse_from_id: input.warehouse_from_id,
      input_weight_kg: Number(input.input_weight_kg),
      input_quality_json: body.input_quality_json || {},
    });

    if (inputError) {
      return NextResponse.json({ error: inputError.message }, { status: 400 });
    }

    const { error: outputsError } = await supabase.from("batch_transformation_outputs").insert(
      normalizedOutputs.map((output: any) => ({
        company_id: companyId,
        transformation_id: transformation.id,
        warehouse_to_id: output.warehouse_to_id,
        line_type: output.line_type,
        output_weight_kg: output.output_weight_kg,
        output_quality_json: {},
        batch_class: output.batch_class,
      }))
    );

    if (outputsError) {
      return NextResponse.json({ error: outputsError.message }, { status: 400 });
    }

    return NextResponse.json({ id: transformation.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
