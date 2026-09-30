import { NextRequest, NextResponse } from "next/server";
import {
  MEAL_THERMOS_KITCHEN_WRITE_ROLES,
  asArray,
  asMealThermosError,
  cleanString,
  resolveMealThermosSession,
} from "@/app/api/meal-thermoses/_helpers";

type AssignmentPayload = {
  meal_order_person_id?: string;
  person_id?: string;
  thermos_id?: string;
};

const ASSIGNABLE_THERMOS_STATUSES = new Set(["available", "assigned"]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const orderId = String(id || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "Order id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = cleanString(body?.companyId || body?.company_id);
    const assignmentsRaw = asArray<AssignmentPayload>(body?.assignments);
    const assignments = assignmentsRaw
      .map((item) => ({
        personId: cleanString(item?.meal_order_person_id || item?.person_id),
        thermosId: cleanString(item?.thermos_id),
      }))
      .filter((item) => item.personId && item.thermosId) as Array<{ personId: string; thermosId: string }>;

    if (assignments.length === 0) {
      return NextResponse.json({ error: "assignments are required" }, { status: 400 });
    }

    const uniqueThermosIds = Array.from(new Set(assignments.map((item) => item.thermosId)));
    if (uniqueThermosIds.length !== assignments.length) {
      return NextResponse.json({ error: "The same thermos cannot be assigned to multiple people" }, { status: 409 });
    }

    const { actor, companyId, supabase } = await resolveMealThermosSession(request, {
      allowedRoles: MEAL_THERMOS_KITCHEN_WRITE_ROLES,
      requestedCompanyId,
    });

    const [{ data: order, error: orderError }, { data: peopleRows, error: peopleError }, { data: thermosRows, error: thermosError }] =
      await Promise.all([
        supabase
          .from("meal_orders")
          .select("id,status")
          .eq("id", orderId)
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("meal_order_people")
          .select("id,meal_order_id,person_name,issue_status,thermos_id")
          .eq("company_id", companyId)
          .eq("meal_order_id", orderId),
        supabase
          .from("thermoses")
          .select("id,number,status,current_meal_order_id")
          .eq("company_id", companyId)
          .in("id", uniqueThermosIds),
      ]);

    if (orderError || !order?.id) {
      return NextResponse.json({ error: orderError?.message || "Meal order not found" }, { status: 404 });
    }
    if (peopleError) {
      return NextResponse.json({ error: peopleError.message }, { status: 400 });
    }
    if (thermosError) {
      return NextResponse.json({ error: thermosError.message }, { status: 400 });
    }

    const forbiddenStatuses = new Set(["cancelled", "issued", "returned"]);
    if (forbiddenStatuses.has(String(order.status || ""))) {
      return NextResponse.json({ error: "Cannot assign thermoses for current order status" }, { status: 409 });
    }

    const people = Array.isArray(peopleRows) ? peopleRows : [];
    const thermoses = Array.isArray(thermosRows) ? thermosRows : [];
    const peopleMap = new Map(people.map((item: any) => [String(item.id), item]));
    const thermosMap = new Map(thermoses.map((item: any) => [String(item.id), item]));

    const previousThermosIds = new Set<string>();
    for (const assignment of assignments) {
      const person = peopleMap.get(assignment.personId);
      if (!person) {
        return NextResponse.json({ error: `Person ${assignment.personId} not found in the order` }, { status: 404 });
      }

      const personStatus = String(person.issue_status || "");
      if (personStatus === "issued" || personStatus === "returned" || personStatus === "lost" || personStatus === "damaged") {
        return NextResponse.json({ error: `Person ${person.person_name || person.id} is already finalized` }, { status: 409 });
      }

      const thermos = thermosMap.get(assignment.thermosId);
      if (!thermos) {
        return NextResponse.json({ error: `Thermos ${assignment.thermosId} not found` }, { status: 404 });
      }

      if (!ASSIGNABLE_THERMOS_STATUSES.has(String(thermos.status || ""))) {
        return NextResponse.json({ error: `Thermos ${thermos.number || thermos.id} is not available for assignment` }, { status: 409 });
      }

      if (person.thermos_id && String(person.thermos_id) !== assignment.thermosId) {
        previousThermosIds.add(String(person.thermos_id));
      }
    }

    const assignmentPersonIds = assignments.map((item) => item.personId);
    const { data: activeThermosLinks, error: activeLinksError } = await supabase
      .from("meal_order_people")
      .select("id,thermos_id,meal_order_id,issue_status")
      .eq("company_id", companyId)
      .in("thermos_id", uniqueThermosIds)
      .in("issue_status", ["assigned", "issued"]);

    if (activeLinksError) {
      return NextResponse.json({ error: activeLinksError.message }, { status: 400 });
    }

    const activeLinks = Array.isArray(activeThermosLinks) ? activeThermosLinks : [];
    for (const row of activeLinks) {
      const rowId = String((row as any).id || "");
      if (!assignmentPersonIds.includes(rowId)) {
        return NextResponse.json(
          { error: `Thermos ${(row as any).thermos_id} is already assigned/issued in another record` },
          { status: 409 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const personPatchResults = await Promise.all(
      assignments.map(async (assignment) => {
        const person = peopleMap.get(assignment.personId)!;
        const thermos = thermosMap.get(assignment.thermosId)!;
        const { data, error } = await supabase
          .from("meal_order_people")
          .update({
            thermos_id: assignment.thermosId,
            thermos_number: thermos.number,
            issue_status: "assigned",
            updated_at: nowIso,
          })
          .eq("id", assignment.personId)
          .eq("company_id", companyId)
          .eq("meal_order_id", orderId)
          .select("*")
          .single();
        if (error || !data?.id) {
          throw new Error(error?.message || `Failed to assign thermos for ${person.person_name || person.id}`);
        }
        return data;
      })
    );

    await Promise.all(
      assignments.map(async (assignment) => {
        const person = peopleMap.get(assignment.personId)!;
        const { error } = await supabase
          .from("thermoses")
          .update({
            status: "assigned",
            current_holder_name: person.person_name || null,
            current_meal_order_id: orderId,
            updated_at: nowIso,
          })
          .eq("id", assignment.thermosId)
          .eq("company_id", companyId);
        if (error) {
          throw new Error(error.message);
        }
      })
    );

    if (previousThermosIds.size > 0) {
      const previousIds = Array.from(previousThermosIds).filter((value) => !uniqueThermosIds.includes(value));
      if (previousIds.length > 0) {
        const { data: stillInUse } = await supabase
          .from("meal_order_people")
          .select("thermos_id")
          .eq("company_id", companyId)
          .in("thermos_id", previousIds)
          .in("issue_status", ["assigned", "issued"]);
        const busy = new Set((stillInUse || []).map((row: any) => String(row.thermos_id || "")));
        const freeIds = previousIds.filter((idValue) => !busy.has(idValue));
        if (freeIds.length > 0) {
          await supabase
            .from("thermoses")
            .update({
              status: "available",
              current_holder_name: null,
              current_meal_order_id: null,
              updated_at: nowIso,
            })
            .eq("company_id", companyId)
            .in("id", freeIds);
        }
      }
    }

    const eventsPayload = assignments.map((assignment) => {
      const person = peopleMap.get(assignment.personId)!;
      return {
        company_id: companyId,
        thermos_id: assignment.thermosId,
        meal_order_id: orderId,
        meal_order_person_id: assignment.personId,
        event_type: "assigned",
        actor_user_id: actor.id,
        holder_name: person.person_name || null,
        comment: cleanString(body?.comment),
        created_at: nowIso,
      };
    });

    const { error: eventsError } = await supabase.from("thermos_events").insert(eventsPayload);
    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 400 });
    }

    return NextResponse.json({
      assigned: personPatchResults,
      count: personPatchResults.length,
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

