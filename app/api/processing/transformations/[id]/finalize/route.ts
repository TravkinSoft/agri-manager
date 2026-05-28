import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const actor = await getServerActorFromSession(request);
    const transformationId = String(context.params.id || "").trim();

    if (!transformationId) {
      return NextResponse.json({ error: "transformation id is required" }, { status: 400 });
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
      actorUserId: actor.id,
      companyId: transformation.company_id,
      allowedRoles: ["global_admin", "company_admin", "warehouse", "warehouse_operator", "weighman"],
    });

    const { error } = await supabase.rpc("finalize_batch_transformation", {
      p_transformation_id: transformationId,
      p_actor_user_id: actor.id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
