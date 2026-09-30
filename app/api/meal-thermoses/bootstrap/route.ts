import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_READ_ROLES,
  asMealThermosError,
  cleanString,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

export async function GET(request: NextRequest) {
  try {
    const mealDate = cleanString(request.nextUrl.searchParams.get("mealDate"));
    const status = cleanString(request.nextUrl.searchParams.get("status"));

    const { companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_READ_ROLES,
    });

    let ordersQuery = supabase
      .from("meal_orders")
      .select(
        `
          id,
          company_id,
          requested_by_user_id,
          brigadier_name,
          meal_date,
          meal_type,
          field_id,
          delivery_location_text,
          comment,
          status,
          people_count,
          created_at,
          updated_at,
          accepted_at,
          issued_at,
          returned_at,
          cancelled_at,
          fields:field_id(id,name),
          people:meal_order_people(
            id,
            company_id,
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

    if (mealDate) {
      ordersQuery = ordersQuery.eq("meal_date", mealDate);
    }
    if (status && status !== "all") {
      ordersQuery = ordersQuery.eq("status", status);
    }

    const [
      { data: orders, error: ordersError },
      { data: thermoses, error: thermosesError },
      { data: fields, error: fieldsError },
      { data: thermosEvents, error: thermosEventsError },
    ] = await Promise.all([
        ordersQuery,
        supabase
          .from("thermoses")
          .select(
            `
              id,
              company_id,
              number,
              label,
              volume_l,
              status,
              current_holder_name,
              current_meal_order_id,
              last_issued_at,
              last_returned_at,
              created_at,
              updated_at
            `
          )
          .eq("company_id", companyId)
          .order("number", { ascending: true }),
        supabase
          .from("fields")
          .select("id,name,area")
          .eq("company_id", companyId)
          .order("name", { ascending: true }),
        supabase
          .from("thermos_events")
          .select("id,company_id,thermos_id,meal_order_id,meal_order_person_id,event_type,actor_user_id,holder_name,comment,created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(300),
      ]);

    if (ordersError) {
      return NextResponse.json({ error: ordersError.message }, { status: 400 });
    }
    if (thermosesError) {
      return NextResponse.json({ error: thermosesError.message }, { status: 400 });
    }
    if (fieldsError) {
      return NextResponse.json({ error: fieldsError.message }, { status: 400 });
    }
    if (thermosEventsError) {
      return NextResponse.json({ error: thermosEventsError.message }, { status: 400 });
    }

    const orderRows = (Array.isArray(orders) ? orders : [])
      .map((order: any) => ({
        ...order,
        people: (Array.isArray(order.people) ? order.people : []).filter(
          (person: any) =>
            !hasQaDataMarker(
              `${person.person_name || ""} ${person.employee_id || ""} ${person.comment || ""} ${person.thermos_number || ""}`
            )
        ),
      }))
      .filter(
        (order: any) =>
          !hasQaDataMarker(
            `${order.brigadier_name || ""} ${order.delivery_location_text || ""} ${order.comment || ""} ${order.status || ""}`
          )
      );
    const eventRows = (Array.isArray(thermosEvents) ? thermosEvents : []).filter(
      (event: any) => !hasQaDataMarker(`${event.holder_name || ""} ${event.comment || ""}`)
    );
    const eventsByThermosId = new Map<string, any[]>();
    eventRows.forEach((event: any) => {
      const key = String(event.thermos_id || "");
      if (!key) return;
      if (!eventsByThermosId.has(key)) eventsByThermosId.set(key, []);
      eventsByThermosId.get(key)?.push(event);
    });
    const thermosRows = (Array.isArray(thermoses) ? thermoses : [])
      .filter(
        (thermos: any) =>
          !hasQaDataMarker(
            `${thermos.number || ""} ${thermos.label || ""} ${thermos.current_holder_name || ""}`
          )
      )
      .map((thermos: any) => ({
        ...thermos,
        recent_events: (eventsByThermosId.get(String(thermos.id)) || []).slice(0, 5),
      }));
    const fieldRows = Array.isArray(fields) ? fields : [];
    const today = new Date().toISOString().slice(0, 10);

    const awaitingReturns = orderRows.flatMap((order: any) => {
      const people = Array.isArray(order.people) ? order.people : [];
      return people
        .filter((person: any) => String(person.issue_status || "") === "issued")
        .map((person: any) => ({
          meal_order_id: order.id,
          meal_order_person_id: person.id,
          meal_date: order.meal_date,
          meal_type: order.meal_type,
          order_status: order.status,
          brigadier_name: order.brigadier_name || null,
          field_id: order.field_id || null,
          field_name: order.fields?.name || null,
          person_name: person.person_name || null,
          thermos_id: person.thermos_id || null,
          thermos_number: person.thermos_number || null,
          issued_at: person.issued_at || null,
          delivery_location_text: order.delivery_location_text || null,
        }));
    });

    const summary = {
      orders_today: orderRows.filter((order: any) => String(order.meal_date || "") === today).length,
      lunches_today: orderRows.filter(
        (order: any) => String(order.meal_date || "") === today && String(order.meal_type || "") === "lunch"
      ).length,
      thermoses_issued: thermosRows.filter((item: any) => String(item.status || "") === "issued").length,
      awaiting_return: awaitingReturns.length,
      thermoses_lost: thermosRows.filter((item: any) => String(item.status || "") === "lost").length,
      thermoses_damaged: thermosRows.filter((item: any) => String(item.status || "") === "damaged").length,
    };

    return NextResponse.json({
      orders: orderRows,
      thermoses: thermosRows,
      thermos_events: eventRows,
      fields: fieldRows,
      awaiting_returns: awaitingReturns,
      summary,
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
