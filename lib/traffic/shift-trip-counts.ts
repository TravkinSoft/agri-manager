/** A completed harvest receipt is one trip, not one line/plot/weight reading.
 * Corrections inherit the original shift and physical trip identity. */
export type TripTicket = {
  id: string; shift_id: string | null; vehicle_id: string | null; driver_id: string | null;
  op_type: string; status: string; is_finalized: boolean; is_voided: boolean | null;
  correction_of_ticket_id: string | null; replacement_ticket_id: string | null;
  ptc_event_id: string | null; ptc_cycle: number | null;
};

export function countCompletedDriverTrips(shiftId: string, tickets: TripTicket[]): Map<string, number> {
  const byId = new Map(tickets.map(ticket => [ticket.id, ticket]));
  const trips = new Map<string, Set<string>>();
  for (const ticket of Array.from(byId.values())) {
    if (ticket.op_type !== "harvest_incoming" || ticket.status !== "finalized" || !ticket.is_finalized
      || ticket.is_voided || ticket.replacement_ticket_id || !ticket.driver_id || !ticket.vehicle_id) continue;
    let root = ticket;
    const seen = new Set([root.id]);
    while (root.correction_of_ticket_id) {
      const parent = byId.get(root.correction_of_ticket_id);
      if (!parent || seen.has(parent.id)) throw new Error("Incomplete trip correction history");
      seen.add(parent.id);
      root = parent;
    }
    if (root.shift_id !== shiftId) continue;
    const event = root.ptc_event_id ?? ticket.ptc_event_id;
    const cycle = root.ptc_cycle ?? ticket.ptc_cycle;
    const key = event ? `event:${event}` : cycle != null ? `cycle:${root.vehicle_id ?? ticket.vehicle_id}:${cycle}` : `ticket:${root.id}`;
    const driverTrips = trips.get(ticket.driver_id) ?? new Set<string>();
    driverTrips.add(key);
    trips.set(ticket.driver_id, driverTrips);
  }
  return new Map(Array.from(trips, ([driverId, keys]) => [driverId, keys.size]));
}
