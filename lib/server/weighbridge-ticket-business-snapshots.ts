import type { SupabaseClient } from "@supabase/supabase-js";
import { ticketAuditSnapshots } from "@/lib/weighbridge/ticket-audit";
import { resolveTransportIdentity } from "@/lib/weighbridge/transport";

type TicketRow = Record<string, any>;

const ids = (values: unknown[]) => Array.from(new Set(
  values.map((value) => String(value || "").trim()).filter(Boolean)
));

const label = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return null;
};

/**
 * Hydrate list rows without sacrificing historical truth. Server-written audit
 * snapshots are authoritative; mutable catalogs are only a legacy fallback.
 */
export async function enrichTicketBusinessSnapshots(
  supabase: SupabaseClient,
  companyId: string,
  tickets: TicketRow[]
): Promise<TicketRow[]> {
  if (tickets.length === 0) return [];

  const vehicleIds = ids(tickets.map((ticket) => ticket.vehicle_id));
  const driverIds = ids(tickets.map((ticket) => ticket.driver_id));
  const [vehiclesResult, machinesResult, peopleResult, specialistsResult, profilesResult] = await Promise.all([
    vehicleIds.length
      ? supabase.from("reference_vehicles")
          .select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name")
          .eq("company_id", companyId)
          .in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null }),
    vehicleIds.length
      ? supabase.from("reference_machines")
          .select("id,name,full_name,brand,model,series,license_plate,source_raw_name")
          .eq("company_id", companyId)
          .in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? supabase.from("company_people").select("id,full_name").eq("company_id", companyId).in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? supabase.from("reference_specialists")
          .select("id,full_name,name_ru,name_kz,name_en")
          .eq("company_id", companyId)
          .in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? supabase.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = [vehiclesResult, machinesResult, peopleResult, specialistsResult, profilesResult]
    .map((result) => result.error)
    .find(Boolean);
  if (firstError) throw firstError;

  const byId = (rows: any[]) => new Map(rows.map((row) => [String(row.id), row]));
  const vehicleById = byId([...(vehiclesResult.data || []), ...(machinesResult.data || [])]);
  const driverById = byId([...(peopleResult.data || []), ...(specialistsResult.data || []), ...(profilesResult.data || [])]);

  return tickets.map((ticket) => {
    const snapshots = ticketAuditSnapshots(ticket.audit_json);
    const vehicle = vehicleById.get(String(ticket.vehicle_id || ""));
    const currentTransport = resolveTransportIdentity(vehicle || {});
    const driver = driverById.get(String(ticket.driver_id || ""));
    return {
      ...ticket,
      vehicle_name_snapshot: label(snapshots.vehicleName, ticket.vehicle_name_snapshot, currentTransport.name),
      vehicle_plate_snapshot: label(snapshots.vehiclePlate, ticket.vehicle_plate_snapshot, currentTransport.plate),
      trailer_id: label(snapshots.trailerId, ticket.trailer_id),
      trailer_name_snapshot: label(snapshots.trailerName, ticket.trailer_name_snapshot),
      trailer_plate_snapshot: label(snapshots.trailerPlate, ticket.trailer_plate_snapshot),
      driver_name_snapshot: label(
        snapshots.driverName,
        ticket.driver_name_snapshot,
        driver?.full_name,
        driver?.name_ru,
        driver?.name_en,
        driver?.name_kz,
        driver?.email
      ),
    };
  });
}
