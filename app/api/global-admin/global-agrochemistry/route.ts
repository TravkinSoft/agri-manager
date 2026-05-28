import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

async function assertGlobalAdmin(supabase: ReturnType<typeof getServiceClient>, userId: string) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, status")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile?.id) throw new SessionAuthError("User profile not found", 403);
  if (String(profile.role || "").toLowerCase() !== "global_admin") {
    throw new SessionAuthError("Only global admin can manage global agrochemistry", 403);
  }
  if (String(profile.status || "active") !== "active") {
    throw new SessionAuthError("Global admin profile is inactive", 403);
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") {
      throw new SessionAuthError("Only global admin can manage global agrochemistry", 403);
    }

    const supabase = getServiceClient();
    await assertGlobalAdmin(supabase, actor.id);

    const { data, error } = await supabase
      .from("products")
      .select("id, name, type, active_ingredient, company_id")
      .in("type", ["pesticide", "fertilizer"])
      .eq("archived", false)
      .order("name", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      products: (data || []).map((row: any) => ({
        ...row,
        scope: row.company_id ? "company" : "global",
      })),
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") {
      throw new SessionAuthError("Only global admin can manage global agrochemistry", 403);
    }

    const body = await request.json();
    const type = String(body?.type || "").trim().toLowerCase();
    const name = String(body?.name || "").trim();
    const activeIngredient = String(body?.active_ingredient || "").trim();
    const manufacturer = body?.manufacturer ? String(body.manufacturer).trim() : null;
    const pesticideCategory = body?.pesticide_category ? String(body.pesticide_category).trim() : null;
    const fertilizerType = body?.fertilizer_type ? String(body.fertilizer_type).trim() : null;

    if (!name || !activeIngredient || !["pesticide", "fertilizer"].includes(type)) {
      return NextResponse.json(
        { error: "type (pesticide|fertilizer), name, active_ingredient are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    await assertGlobalAdmin(supabase, actor.id);

    const duplicate = await supabase
      .from("products")
      .select("id")
      .is("company_id", null)
      .eq("type", type)
      .ilike("name", name)
      .eq("archived", false)
      .maybeSingle();

    if (duplicate.error) return NextResponse.json({ error: duplicate.error.message }, { status: 400 });
    if (duplicate.data?.id) return NextResponse.json({ error: "Global product already exists" }, { status: 409 });

    const insertPayload = {
      name,
      type,
      company_id: null,
      user_id: actor.id,
      active_ingredient: activeIngredient,
      pesticide_category: type === "pesticide" ? pesticideCategory : null,
      fertilizer_type: type === "fertilizer" ? fertilizerType : null,
      unit: type === "pesticide" ? "l" : "kg",
      default_unit: type === "pesticide" ? "l" : "kg",
    };
    const { data, error } = await supabase.from("products").insert(insertPayload).select("id").single();
    if (error) {
      const normalizedMessage = String(error.message || "").toLowerCase();
      const canFallback =
        normalizedMessage.includes("manufacturer") ||
        normalizedMessage.includes("default_unit") ||
        normalizedMessage.includes("pesticide_category") ||
        normalizedMessage.includes("fertilizer_type");

      if (canFallback) {
        const fallbackPayload = {
          name,
          type,
          company_id: null,
          user_id: actor.id,
          active_ingredient: activeIngredient,
          unit: type === "pesticide" ? "l" : "kg",
        };
        const fallback = await supabase.from("products").insert(fallbackPayload).select("id").single();
        if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 400 });
        return NextResponse.json({ success: true, id: fallback.data.id });
      }
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
