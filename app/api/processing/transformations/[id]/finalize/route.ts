import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const transformationId = String(id || "").trim();
    if (!transformationId) {
      return NextResponse.json({ error: "transformation id is required" }, { status: 400 });
    }

    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
    });
    const { data: transformation, error: transformationError } = await supabase
      .from("batch_transformations")
      .select("id,company_id,status")
      .eq("id", transformationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (transformationError || !transformation?.id) {
      return NextResponse.json({ error: "Переработка не найдена." }, { status: 404 });
    }
    if (transformation.status === "completed") {
      return NextResponse.json({ ok: true, idempotent_replay: true });
    }

    const { error } = await supabase.rpc("finalize_batch_transformation_for_session_v1", {
      p_transformation_id: transformationId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
