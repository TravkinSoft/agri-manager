import { NextRequest, NextResponse } from "next/server";
import {
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
  SessionAuthError,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadActiveCompanyAssets(
  companyId: string,
  supabase: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>
) {

  const [machinesRes, equipmentRes, vehiclesRes] = await Promise.all([
    supabase
      .from("reference_machines")
      .select(`
        *,
        global_model:global_machine_model_id(id,full_name,category,brand,series,model)
      `)
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("reference_equipment")
      .select(`
        *,
        global_model:global_equipment_model_id(id,name,full_name,category,brand,series,model,equipment_type)
      `)
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("reference_vehicles")
      .select(`
        *,
        global_vehicle_brands:global_brand_id(id,name),
        global_vehicle_models:global_model_id(id,name,model_type,default_capacity_kg),
        transport_model:transport_model_id(id,full_name,category,brand,series,model),
        primary_responsible:primary_responsible_personnel_id(id,full_name,personnel_type,status)
      `)
      .eq("company_id", companyId)
      .is("source_machine_id", null)
      .eq("archived", false)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const error = machinesRes.error || equipmentRes.error || vehiclesRes.error;
  if (error) {
    throw new Error(error.message || "Failed to load company assets");
  }

  return {
    machines: machinesRes.data || [],
    equipment: equipmentRes.data || [],
    vehicles: vehiclesRes.data || [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = request.nextUrl.searchParams.get("companyId");
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = await getUserScopedClientFromRequest(request);
    const assets = await loadActiveCompanyAssets(companyId, supabase);

    return NextResponse.json({
      companyId,
      ...assets,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load company assets" },
      { status: 500 }
    );
  }
}
