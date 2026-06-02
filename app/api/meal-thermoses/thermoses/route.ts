import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_ADMIN_WRITE_ROLES,
  MEAL_THERMOS_READ_ROLES,
  THERMOS_STATUS_VALUES,
  asMealThermosError,
  cleanString,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";

const THERMOS_STATUS_SET = new Set<string>(THERMOS_STATUS_VALUES);

export async function GET(request: NextRequest) {
  try {
    const requestedCompanyId = cleanString(request.nextUrl.searchParams.get("companyId"));
    const status = cleanString(request.nextUrl.searchParams.get("status"));
    const includeInactive = String(request.nextUrl.searchParams.get("includeInactive") || "false").toLowerCase() === "true";

    const { companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_READ_ROLES,
      requestedCompanyId,
    });

    let query = supabase
      .from("thermoses")
      .select("*")
      .eq("company_id", companyId)
      .order("number", { ascending: true });

    if (status && status !== "all") {
      query = query.eq("status", status);
    } else if (!includeInactive) {
      query = query.neq("status", "inactive");
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ thermoses: data || [] });
  } catch (error) {
    const sessionError = asMealThermosError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = cleanString(body?.companyId || body?.company_id);

    const { actor, companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_ADMIN_WRITE_ROLES,
      requestedCompanyId,
    });

    const number = cleanString(body?.number);
    const status = (cleanString(body?.status) || "available").toLowerCase();
    const label = cleanString(body?.label);
    const volumeRaw = cleanString(body?.volume_l || body?.volumeL);
    const volumeValue = volumeRaw ? Number(volumeRaw) : null;

    if (!number) {
      return NextResponse.json({ error: "Thermos number is required" }, { status: 400 });
    }
    if (!THERMOS_STATUS_SET.has(status)) {
      return NextResponse.json({ error: "Invalid thermos status" }, { status: 400 });
    }
    if (volumeValue != null && (!Number.isFinite(volumeValue) || volumeValue <= 0)) {
      return NextResponse.json({ error: "volume_l must be a positive number" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const payload = {
      company_id: companyId,
      number,
      label,
      volume_l: volumeValue,
      status,
      current_holder_name: null,
      current_meal_order_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from("thermoses")
      .insert(payload)
      .select("*")
      .single();

    if (error || !data?.id) {
      return NextResponse.json({ error: error?.message || "Failed to create thermos" }, { status: 400 });
    }

    const { error: eventError } = await supabase.from("thermos_events").insert({
      company_id: companyId,
      thermos_id: data.id,
      meal_order_id: null,
      meal_order_person_id: null,
      event_type: "created",
      actor_user_id: actor.id,
      holder_name: null,
      comment: null,
      created_at: nowIso,
    });
    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 400 });
    }

    return NextResponse.json({ thermos: data });
  } catch (error) {
    const sessionError = asMealThermosError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

