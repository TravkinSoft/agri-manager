import { NextRequest, NextResponse } from "next/server";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";

function isUuidLike(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(value || "").trim());
}

async function activateImport(params: {
  importId: string;
  companyId: string;
  supabase: Awaited<ReturnType<typeof resolveFieldsMapContext>>["supabase"];
}) {
  const { importId, companyId, supabase } = params;
  const geometriesRes = await supabase
    .from("field_geometries")
    .select("id,field_id,created_at")
    .eq("company_id", companyId)
    .eq("import_id", importId)
    .order("created_at", { ascending: false });

  if (geometriesRes.error) {
    throw new Error(geometriesRes.error.message);
  }

  const geometries = geometriesRes.data || [];
  const latestByField = new Map<string, string>();
  geometries.forEach((row: any) => {
    const fieldId = String(row.field_id || "");
    if (!fieldId || latestByField.has(fieldId)) return;
    latestByField.set(fieldId, String(row.id));
  });

  const resetOwnRes = await supabase
    .from("field_geometries")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("import_id", importId);
  if (resetOwnRes.error) {
    throw new Error(resetOwnRes.error.message);
  }

  const latestEntries = Array.from(latestByField.entries());
  for (let index = 0; index < latestEntries.length; index += 1) {
    const [fieldId, geometryId] = latestEntries[index];
    const deactivateFieldRes = await supabase
      .from("field_geometries")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("field_id", fieldId)
      .eq("is_active", true);
    if (deactivateFieldRes.error) {
      throw new Error(deactivateFieldRes.error.message);
    }

    const activateFieldRes = await supabase
      .from("field_geometries")
      .update({ is_active: true })
      .eq("company_id", companyId)
      .eq("id", geometryId);
    if (activateFieldRes.error) {
      throw new Error(activateFieldRes.error.message);
    }
  }

  const deactivateImportsRes = await supabase
    .from("field_map_imports")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .neq("id", importId);
  if (deactivateImportsRes.error) {
    throw new Error(deactivateImportsRes.error.message);
  }

  const updateRes = await supabase
    .from("field_map_imports")
    .update({ is_active: true, status: "imported" })
    .eq("company_id", companyId)
    .eq("id", importId);
  if (updateRes.error) {
    throw new Error(updateRes.error.message);
  }
}

async function deactivateImport(params: {
  importId: string;
  companyId: string;
  supabase: Awaited<ReturnType<typeof resolveFieldsMapContext>>["supabase"];
}) {
  const { importId, companyId, supabase } = params;
  const importUpdate = await supabase
    .from("field_map_imports")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("id", importId);
  if (importUpdate.error) {
    throw new Error(importUpdate.error.message);
  }
  const geoUpdate = await supabase
    .from("field_geometries")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("import_id", importId);
  if (geoUpdate.error) {
    throw new Error(geoUpdate.error.message);
  }
}

async function archiveImport(params: {
  importId: string;
  companyId: string;
  supabase: Awaited<ReturnType<typeof resolveFieldsMapContext>>["supabase"];
}) {
  await deactivateImport(params);
  const archiveRes = await params.supabase
    .from("field_map_imports")
    .update({ status: "archived", is_active: false })
    .eq("company_id", params.companyId)
    .eq("id", params.importId);
  if (archiveRes.error) {
    throw new Error(archiveRes.error.message);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await resolveFieldsMapContext(request, { write: true });
    const { companyId, supabase } = context;
    const importId = String(params.id || "").trim();
    if (!isUuidLike(importId)) {
      return NextResponse.json({ error: "Некорректный import id" }, { status: 400 });
    }

    const body = await request.json();
    const action = String(body?.action || "").trim().toLowerCase();

    const importRes = await supabase
      .from("field_map_imports")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", importId)
      .maybeSingle();
    if (importRes.error || !importRes.data?.id) {
      return NextResponse.json({ error: importRes.error?.message || "Импорт не найден" }, { status: 404 });
    }

    if (action === "activate") {
      await activateImport({ importId, companyId, supabase });
      return NextResponse.json({ ok: true, action: "activate" });
    }
    if (action === "deactivate") {
      await deactivateImport({ importId, companyId, supabase });
      return NextResponse.json({ ok: true, action: "deactivate" });
    }
    if (action === "delete") {
      await archiveImport({ importId, companyId, supabase });
      return NextResponse.json({ ok: true, action: "delete" });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await resolveFieldsMapContext(request, { write: true });
    const { companyId, supabase } = context;
    const importId = String(params.id || "").trim();
    if (!isUuidLike(importId)) {
      return NextResponse.json({ error: "Некорректный import id" }, { status: 400 });
    }
    await archiveImport({ importId, companyId, supabase });
    return NextResponse.json({ ok: true, action: "delete" });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
