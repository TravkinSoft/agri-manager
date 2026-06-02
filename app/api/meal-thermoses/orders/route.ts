import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_BRIGADIER_WRITE_ROLES,
  MEAL_THERMOS_READ_ROLES,
  MEAL_TYPE_VALUES,
  asArray,
  asMealThermosError,
  cleanString,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";

function parsePeople(body: any): string[] {
  const direct = asArray<string>(body?.people)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (direct.length > 0) return direct;

  const rawList = String(body?.people_text || body?.peopleText || "").trim();
  if (!rawList) return [];
  return rawList
    .split(/\r?\n|,|;/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isMealType(value: string): value is (typeof MEAL_TYPE_VALUES)[number] {
  return MEAL_TYPE_VALUES.includes(value as any);
}

export async function GET(request: NextRequest) {
  try {
    const mealDate = cleanString(request.nextUrl.searchParams.get("mealDate"));
    const status = cleanString(request.nextUrl.searchParams.get("status"));

    const { actor, companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_READ_ROLES,
    });

    let query = supabase
      .from("meal_orders")
      .select(
        `
          *,
          fields:field_id(id,name),
          people:meal_order_people(
            id,
            meal_order_id,
            person_name,
            employee_id,
            comment,
            thermos_id,
            thermos_number,
            issue_status,
            issued_at,
            returned_at,
            created_at,
            updated_at
          )
        `
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (mealDate) query = query.eq("meal_date", mealDate);
    if (status && status !== "all") query = query.eq("status", status);
    if (actor.role === "brigadier") query = query.eq("requested_by_user_id", actor.id);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ orders: data || [] });
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
      allowedRoles: MEAL_THERMOS_BRIGADIER_WRITE_ROLES,
      requestedCompanyId,
    });

    const mealDate = cleanString(body?.meal_date || body?.mealDate);
    const mealTypeRaw = cleanString(body?.meal_type || body?.mealType) || "lunch";
    const mealType = mealTypeRaw.toLowerCase();
    const people = parsePeople(body);

    if (!mealDate) {
      return NextResponse.json({ error: "meal_date is required" }, { status: 400 });
    }
    if (!isMealType(mealType)) {
      return NextResponse.json({ error: "Invalid meal_type" }, { status: 400 });
    }
    if (people.length === 0) {
      return NextResponse.json({ error: "At least one person is required" }, { status: 400 });
    }

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", actor.id)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const orderPayload = {
      company_id: companyId,
      requested_by_user_id: actor.id,
      brigadier_name: cleanString(body?.brigadier_name || body?.brigadierName) || cleanString(profileRow?.full_name),
      meal_date: mealDate,
      meal_type: mealType,
      field_id: cleanString(body?.field_id || body?.fieldId),
      delivery_location_text: cleanString(body?.delivery_location_text || body?.deliveryLocationText),
      comment: cleanString(body?.comment),
      status: "new",
      people_count: people.length,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data: order, error: orderError } = await supabase
      .from("meal_orders")
      .insert(orderPayload)
      .select("*")
      .single();

    if (orderError || !order?.id) {
      return NextResponse.json({ error: orderError?.message || "Failed to create meal order" }, { status: 400 });
    }

    const peopleRows = people.map((personName) => ({
      company_id: companyId,
      meal_order_id: order.id,
      person_name: personName,
      comment: null,
      issue_status: "pending",
      created_at: nowIso,
      updated_at: nowIso,
    }));

    const { data: peopleData, error: peopleError } = await supabase
      .from("meal_order_people")
      .insert(peopleRows)
      .select("*");

    if (peopleError) {
      await supabase.from("meal_orders").delete().eq("id", order.id).eq("company_id", companyId);
      return NextResponse.json({ error: peopleError.message }, { status: 400 });
    }

    return NextResponse.json({
      order: {
        ...order,
        people: peopleData || [],
      },
    });
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

