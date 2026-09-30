import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_KITCHEN_WRITE_ROLES,
  asMealThermosError,
  cleanString,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const orderId = String(id || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "Order id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = cleanString(body?.companyId || body?.company_id);
    const { actor, companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_KITCHEN_WRITE_ROLES,
      requestedCompanyId,
    });

    const [{ data: order, error: orderError }, { data: peopleRows, error: peopleError }] = await Promise.all([
      supabase
        .from("meal_orders")
        .select("id,status")
        .eq("id", orderId)
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("meal_order_people")
        .select("id,person_name,thermos_id,thermos_number,issue_status")
        .eq("company_id", companyId)
        .eq("meal_order_id", orderId),
    ]);

    if (orderError || !order?.id) {
      return NextResponse.json({ error: orderError?.message || "Meal order not found" }, { status: 404 });
    }
    if (peopleError) {
      return NextResponse.json({ error: peopleError.message }, { status: 400 });
    }

    const forbiddenStatuses = new Set(["cancelled", "returned"]);
    if (forbiddenStatuses.has(String(order.status || ""))) {
      return NextResponse.json({ error: "Order is cancelled/closed and cannot be issued" }, { status: 409 });
    }

    const people = Array.isArray(peopleRows) ? peopleRows : [];
    if (people.length === 0) {
      return NextResponse.json({ error: "Cannot issue order without people rows" }, { status: 409 });
    }

    const missingThermos = people.find((item: any) => !item.thermos_id);
    if (missingThermos) {
      return NextResponse.json(
        { error: `Cannot issue order: person ${missingThermos.person_name || missingThermos.id} has no assigned thermos` },
        { status: 409 }
      );
    }

    const notReady = people.find((item: any) => !["assigned", "issued"].includes(String(item.issue_status || "")));
    if (notReady) {
      return NextResponse.json(
        { error: `Cannot issue order: person ${notReady.person_name || notReady.id} is not in assigned state` },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const toIssuePeople = people.filter((item: any) => String(item.issue_status || "") !== "issued");
    if (toIssuePeople.length === 0) {
      return NextResponse.json({ error: "Meal order is already issued" }, { status: 409 });
    }
    if (toIssuePeople.length > 0) {
      const personIds = toIssuePeople.map((item: any) => item.id);
      const { error: peopleUpdateError } = await supabase
        .from("meal_order_people")
        .update({
          issue_status: "issued",
          issued_at: nowIso,
          updated_at: nowIso,
        })
        .eq("company_id", companyId)
        .eq("meal_order_id", orderId)
        .in("id", personIds);
      if (peopleUpdateError) {
        return NextResponse.json({ error: peopleUpdateError.message }, { status: 400 });
      }
    }

    for (const person of people as any[]) {
      const thermosId = String(person.thermos_id || "").trim();
      if (!thermosId) continue;
      const { error: thermosError } = await supabase
        .from("thermoses")
        .update({
          status: "issued",
          current_holder_name: person.person_name || null,
          current_meal_order_id: orderId,
          last_issued_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", thermosId)
        .eq("company_id", companyId);
      if (thermosError) {
        return NextResponse.json({ error: thermosError.message }, { status: 400 });
      }
    }

    const issueEvents = toIssuePeople.map((person: any) => ({
      company_id: companyId,
      thermos_id: person.thermos_id,
      meal_order_id: orderId,
      meal_order_person_id: person.id,
      event_type: "issued",
      actor_user_id: actor.id,
      holder_name: person.person_name || null,
      comment: null,
      created_at: nowIso,
    }));
    const { error: eventsError } = await supabase.from("thermos_events").insert(issueEvents);
    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 400 });
    }

    const { data: updatedOrder, error: orderUpdateError } = await supabase
      .from("meal_orders")
      .update({
        status: "issued",
        issued_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", orderId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (orderUpdateError || !updatedOrder?.id) {
      return NextResponse.json({ error: orderUpdateError?.message || "Failed to update order" }, { status: 400 });
    }

    return NextResponse.json({
      order: updatedOrder,
      issued_people: toIssuePeople.length,
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
