import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_KITCHEN_WRITE_ROLES,
  asArray,
  asMealThermosError,
  cleanString,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";

type ReturnAction = "returned" | "damaged" | "lost";

type ReturnPayload = {
  meal_order_person_id?: string;
  person_id?: string;
  action?: ReturnAction;
  comment?: string;
};

const RETURN_ACTIONS = new Set<ReturnAction>(["returned", "damaged", "lost"]);

function resolveOrderStatus(rows: Array<{ issue_status: string }>): "issued" | "partially_returned" | "returned" {
  if (rows.length === 0) return "issued";
  const unresolvedCount = rows.filter((item) => !["returned", "damaged", "lost"].includes(String(item.issue_status || ""))).length;
  if (unresolvedCount === 0) return "returned";
  if (unresolvedCount < rows.length) return "partially_returned";
  return "issued";
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const orderId = String(id || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "Order id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = cleanString(body?.companyId || body?.company_id);
    const updatesRaw = asArray<ReturnPayload>(body?.updates || body?.returns);
    const updates = updatesRaw
      .map((item) => ({
        personId: cleanString(item?.meal_order_person_id || item?.person_id),
        action: String(item?.action || "").trim().toLowerCase() as ReturnAction,
        comment: cleanString(item?.comment || body?.comment),
      }))
      .filter((item) => item.personId && RETURN_ACTIONS.has(item.action)) as Array<{
      personId: string;
      action: ReturnAction;
      comment: string | null;
    }>;

    if (updates.length === 0) {
      return NextResponse.json({ error: "updates are required" }, { status: 400 });
    }

    const uniquePersonIds = Array.from(new Set(updates.map((item) => item.personId)));
    if (uniquePersonIds.length !== updates.length) {
      return NextResponse.json({ error: "Duplicate meal order people in returns payload" }, { status: 409 });
    }

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
        .select("id,meal_order_id,person_name,thermos_id,thermos_number,issue_status")
        .eq("company_id", companyId)
        .eq("meal_order_id", orderId),
    ]);

    if (orderError || !order?.id) {
      return NextResponse.json({ error: orderError?.message || "Meal order not found" }, { status: 404 });
    }
    if (peopleError) {
      return NextResponse.json({ error: peopleError.message }, { status: 400 });
    }

    const orderStatus = String(order.status || "");
    if (!["issued", "partially_returned"].includes(orderStatus)) {
      return NextResponse.json({ error: "Only issued orders can be returned" }, { status: 409 });
    }

    const people = Array.isArray(peopleRows) ? peopleRows : [];
    const peopleMap = new Map(people.map((item: any) => [String(item.id), item]));
    const nowIso = new Date().toISOString();
    const updatedRows: any[] = [];

    for (const update of updates) {
      const person = peopleMap.get(update.personId);
      if (!person) {
        return NextResponse.json({ error: `Person ${update.personId} not found in meal order` }, { status: 404 });
      }

      if (String(person.issue_status || "") !== "issued") {
        return NextResponse.json(
          { error: `Cannot return thermos for ${person.person_name || person.id}: issue status is not issued` },
          { status: 409 }
        );
      }

      if (!person.thermos_id) {
        return NextResponse.json(
          { error: `Cannot return thermos for ${person.person_name || person.id}: thermos is not assigned` },
          { status: 409 }
        );
      }

      const thermosPatch =
        update.action === "returned"
          ? {
              status: "returned_dirty",
              current_holder_name: null,
              current_meal_order_id: null,
              last_returned_at: nowIso,
              updated_at: nowIso,
            }
          : update.action === "damaged"
            ? {
                status: "damaged",
                current_holder_name: null,
                current_meal_order_id: null,
                last_returned_at: nowIso,
                updated_at: nowIso,
              }
            : {
                status: "lost",
                current_holder_name: null,
                current_meal_order_id: null,
                last_returned_at: nowIso,
                updated_at: nowIso,
              };

      const { error: thermosError } = await supabase
        .from("thermoses")
        .update(thermosPatch)
        .eq("id", String(person.thermos_id))
        .eq("company_id", companyId);
      if (thermosError) {
        return NextResponse.json({ error: thermosError.message }, { status: 400 });
      }

      const { data: updatedPerson, error: personUpdateError } = await supabase
        .from("meal_order_people")
        .update({
          issue_status: update.action,
          returned_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", update.personId)
        .eq("company_id", companyId)
        .eq("meal_order_id", orderId)
        .select("*")
        .single();
      if (personUpdateError || !updatedPerson?.id) {
        return NextResponse.json({ error: personUpdateError?.message || "Failed to update meal order person" }, { status: 400 });
      }
      updatedRows.push(updatedPerson);

      const { error: eventError } = await supabase.from("thermos_events").insert({
        company_id: companyId,
        thermos_id: person.thermos_id,
        meal_order_id: orderId,
        meal_order_person_id: update.personId,
        event_type: update.action,
        actor_user_id: actor.id,
        holder_name: person.person_name || null,
        comment: update.comment,
        created_at: nowIso,
      });
      if (eventError) {
        return NextResponse.json({ error: eventError.message }, { status: 400 });
      }
    }

    const { data: allPeopleAfterUpdate, error: allPeopleError } = await supabase
      .from("meal_order_people")
      .select("id,issue_status")
      .eq("company_id", companyId)
      .eq("meal_order_id", orderId);
    if (allPeopleError) {
      return NextResponse.json({ error: allPeopleError.message }, { status: 400 });
    }

    const allPeople = Array.isArray(allPeopleAfterUpdate) ? allPeopleAfterUpdate : [];
    const nextOrderStatus = resolveOrderStatus(allPeople.map((item: any) => ({ issue_status: String(item.issue_status || "") })));
    const orderPatch: Record<string, unknown> = {
      status: nextOrderStatus,
      updated_at: nowIso,
    };
    if (nextOrderStatus === "returned") {
      orderPatch.returned_at = nowIso;
    }

    const { data: updatedOrder, error: orderUpdateError } = await supabase
      .from("meal_orders")
      .update(orderPatch)
      .eq("id", orderId)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (orderUpdateError || !updatedOrder?.id) {
      return NextResponse.json({ error: orderUpdateError?.message || "Failed to update meal order" }, { status: 400 });
    }

    return NextResponse.json({
      order: updatedOrder,
      updated_people: updatedRows,
      count: updatedRows.length,
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
