import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_READ_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { getServiceClient } from "@/lib/supabase/service";
import { resolveTransportIdentity } from "@/lib/weighbridge/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nameOf = (row: any) => String(row?.name_ru || row?.name || row?.name_kz || row?.name_en || row?.code || "").trim();

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await resolveWeighbridgeSession(request, { allowedRoles: WEIGHBRIDGE_READ_ROLES });
    const db = getServiceClient();
    const { data: states, error: statesError } = await db
      .from("ptc_vehicle_states")
      .select("vehicle_id,cycle,since")
      .eq("company_id", companyId)
      .eq("assigned", true)
      .eq("state", "loaded")
      .order("since", { ascending: true });
    if (statesError) throw statesError;
    if (!states?.length) return NextResponse.json({ queue: [] }, { headers: { "Cache-Control": "no-store, private" } });

    const vehicleIds = states.map((state) => String(state.vehicle_id));
    const { data: loadedEvents, error: eventsError } = await db
      .from("ptc_events")
      .select("id,vehicle_id,cycle,field_id,crop_structure_id,driver_id,created_at")
      .eq("company_id", companyId)
      .eq("to_state", "loaded")
      .in("vehicle_id", vehicleIds)
      .order("created_at", { ascending: false });
    if (eventsError) throw eventsError;
    const eventByTrip = new Map((loadedEvents || []).map((event: any) => [`${event.vehicle_id}:${event.cycle}`, event]));
    const events = states.flatMap((state) => {
      const event = eventByTrip.get(`${state.vehicle_id}:${state.cycle}`);
      return event ? [event] : [];
    });
    if (!events.length) return NextResponse.json({ queue: [] }, { headers: { "Cache-Control": "no-store, private" } });

    const eventIds = events.map((event: any) => String(event.id));
    const [ticketsResult, vehiclesResult, peopleResult, fieldsResult, structuresResult] = await Promise.all([
      db.from("tickets").select("ptc_event_id").eq("company_id", companyId).in("ptc_event_id", eventIds).neq("is_voided", true),
      db.from("reference_vehicles").select("id,name,custom_name,full_name,brand,model,plate_number,license_plate,source_raw_name").eq("company_id", companyId).in("id", vehicleIds),
      db.from("company_people").select("id,full_name").eq("company_id", companyId).in("id", events.map((event: any) => event.driver_id).filter(Boolean)),
      db.from("fields").select("id,name").eq("company_id", companyId).in("id", events.map((event: any) => event.field_id).filter(Boolean)),
      db.from("crop_structure").select("id,field_id,crop_id,variety_id,reproduction_id,area").eq("company_id", companyId).in("id", events.map((event: any) => event.crop_structure_id).filter(Boolean)),
    ]);
    const error = ticketsResult.error || vehiclesResult.error || peopleResult.error || fieldsResult.error || structuresResult.error;
    if (error) throw error;
    const used = new Set((ticketsResult.data || []).map((ticket: any) => String(ticket.ptc_event_id)));
    const map = (rows: any[]) => new Map((rows || []).map((row) => [String(row.id), row]));
    const vehicleById = map(vehiclesResult.data || []);
    const personById = map(peopleResult.data || []);
    const fieldById = map(fieldsResult.data || []);
    const structureById = map(structuresResult.data || []);
    const structures = structuresResult.data || [];
    const cropIds = Array.from(new Set(structures.map((row: any) => String(row.crop_id || "")).filter(Boolean)));
    const varietyIds = Array.from(new Set(structures.map((row: any) => String(row.variety_id || "")).filter(Boolean)));
    const reproductionIds = Array.from(new Set(structures.map((row: any) => String(row.reproduction_id || "")).filter(Boolean)));
    const [cropsResult, varietiesResult, reproductionsResult] = await Promise.all([
      cropIds.length ? db.from("crops").select("id,name,name_ru,name_kz,name_en").in("id", cropIds) : Promise.resolve({ data: [], error: null } as any),
      varietyIds.length ? db.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", varietyIds) : Promise.resolve({ data: [], error: null } as any),
      reproductionIds.length ? db.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds) : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (cropsResult.error || varietiesResult.error || reproductionsResult.error) throw cropsResult.error || varietiesResult.error || reproductionsResult.error;
    const cropById = map(cropsResult.data || []);
    const varietyById = map(varietiesResult.data || []);
    const reproductionById = map(reproductionsResult.data || []);

    const queue = events.filter((event: any) => !used.has(String(event.id))).map((event: any) => {
      const vehicle = vehicleById.get(String(event.vehicle_id));
      const identity = resolveTransportIdentity(vehicle || {});
      const structure = structureById.get(String(event.crop_structure_id || ""));
      return {
        ptcEventId: String(event.id),
        ptcCycle: Number(event.cycle),
        loadedAt: String(event.created_at),
        vehicleId: String(event.vehicle_id),
        vehicleLabel: [identity.name, identity.plate].filter(Boolean).join(" · ") || "Машина",
        driverId: event.driver_id ? String(event.driver_id) : null,
        driverName: String(personById.get(String(event.driver_id || ""))?.full_name || ""),
        fieldId: event.field_id ? String(event.field_id) : null,
        fieldName: String(fieldById.get(String(event.field_id || ""))?.name || ""),
        cropStructureId: event.crop_structure_id ? String(event.crop_structure_id) : null,
        cropName: nameOf(cropById.get(String(structure?.crop_id || ""))),
        varietyName: nameOf(varietyById.get(String(structure?.variety_id || ""))),
        reproductionName: nameOf(reproductionById.get(String(structure?.reproduction_id || ""))),
      };
    }).sort((left, right) => Date.parse(left.loadedAt) - Date.parse(right.loadedAt));
    return NextResponse.json({ queue }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie, Authorization" } });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить очередь PTC" }, { status: 500 });
  }
}
