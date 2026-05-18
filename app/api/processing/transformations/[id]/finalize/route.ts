import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const actorUserId = String(body.actor_user_id || "").trim();
    const transformationId = String(context.params.id || "").trim();

    if (!actorUserId || !transformationId) {
      return NextResponse.json({ error: "actor_user_id and transformation id are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: transformation, error: transformationError } = await supabase
      .from("batch_transformations")
      .select("id,company_id,status")
      .eq("id", transformationId)
      .maybeSingle();

    if (transformationError || !transformation?.id) {
      return NextResponse.json({ error: transformationError?.message || "Transformation not found" }, { status: 404 });
    }

    await assertActorAccess({
      supabase,
      actorUserId,
      companyId: transformation.company_id,
      allowedRoles: ["admin", "warehouse", "weighman"],
    });

    const { error } = await supabase.rpc("finalize_batch_transformation", {
      p_transformation_id: transformationId,
      p_actor_user_id: actorUserId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
