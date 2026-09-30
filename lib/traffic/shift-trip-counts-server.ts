import type { SupabaseClient } from "@supabase/supabase-js";
import { countCompletedDriverTrips, type TripTicket } from "./shift-trip-counts";

const COLUMNS = "id,shift_id,vehicle_id,driver_id,op_type,status,is_finalized,is_voided,correction_of_ticket_id,replacement_ticket_id,ptc_event_id,ptc_cycle";
const PAGE = 500;

/** Read-only, tenant-scoped. An open shift wins; otherwise show the latest shift.
 * Shift IDs, not calendar dates, preserve trips across midnight and day repairs. */
export async function readShiftTripCounts(db: SupabaseClient, companyId: string) {
  const [open, latest] = await Promise.all([
    db.from("weighbridge_shifts").select("id").eq("company_id", companyId).eq("status", "open").order("opened_at", { ascending: false }).order("id").limit(1).maybeSingle(),
    db.from("weighbridge_shifts").select("id").eq("company_id", companyId).order("opened_at", { ascending: false }).order("id").limit(1).maybeSingle(),
  ]);
  if (open.error || latest.error) throw open.error || latest.error;
  const shiftId = open.data?.id ?? latest.data?.id;
  if (!shiftId) return null;
  const rows = new Map<string, TripTicket>();
  let after = "";
  for (;;) {
    let query = db.from("tickets").select(COLUMNS).eq("company_id", companyId).eq("shift_id", shiftId).order("id").limit(PAGE);
    if (after) query = query.gt("id", after);
    const result = await query;
    if (result.error) throw result.error;
    const page = (result.data ?? []) as TripTicket[];
    page.forEach(row => rows.set(row.id, row));
    if (page.length < PAGE) break;
    after = page[page.length - 1].id;
  }
  // Include originals/replacements even when the correction was made in another
  // shift. A draft replacement doesn't remove a still-valid original receipt.
  for (let depth = 0; ; depth++) {
    const missing = Array.from(new Set(Array.from(rows.values()).flatMap(row =>
      [row.correction_of_ticket_id, row.replacement_ticket_id].filter((id): id is string => !!id && !rows.has(id)))));
    if (!missing.length) break;
    if (depth >= 32) throw new Error("Trip correction history is too deep");
    for (let start = 0; start < missing.length; start += 100) {
      const ids = missing.slice(start, start + 100);
      const result = await db.from("tickets").select(COLUMNS).eq("company_id", companyId).in("id", ids).order("id");
      if (result.error) throw result.error;
      if (result.data?.length !== ids.length) throw new Error("Incomplete trip correction history");
      (result.data as TripTicket[]).forEach(row => rows.set(row.id, row));
    }
  }
  return countCompletedDriverTrips(shiftId, Array.from(rows.values()));
}
