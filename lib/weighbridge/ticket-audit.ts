function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

export type TicketAuditSnapshots = Readonly<{
  driverPersonId: string | null;
  driverName: string | null;
  vehicleName: string | null;
  vehiclePlate: string | null;
  trailerId: string | null;
  trailerName: string | null;
  trailerPlate: string | null;
}>;

/**
 * Read immutable identity snapshots written by the server when a ticket opens.
 * These values must win over mutable reference catalogs when rendering history.
 */
export function ticketAuditSnapshots(value: unknown): TicketAuditSnapshots {
  const audit = isRecord(value) ? value : {};
  const driver = isRecord(audit.driver) ? audit.driver : {};
  const transport = isRecord(audit.transport) ? audit.transport : {};
  return Object.freeze({
    driverPersonId: cleanString(driver.person_id),
    driverName: cleanString(driver.full_name_snapshot),
    vehicleName: cleanString(transport.vehicle_name_snapshot),
    vehiclePlate: cleanString(transport.vehicle_plate_snapshot),
    trailerId: cleanString(transport.trailer_id),
    trailerName: cleanString(transport.trailer_name_snapshot),
    trailerPlate: cleanString(transport.trailer_plate_snapshot),
  });
}

/**
 * Only fields that are genuine ticket-form inputs may cross the API boundary.
 * Snapshots, timestamps, fingerprints, review flags, and processing provenance
 * are deliberately absent: the ticket route rebuilds those from verified data.
 */
export function sanitizeClientTicketAuditJson(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const sanitized: Record<string, unknown> = {};
  const impurityType = cleanString(value.impurity_type);
  if (impurityType) sanitized.impurity_type = impurityType;

  if (isRecord(value.transport)) {
    const transport: Record<string, unknown> = {};
    const vehicleSource = cleanString(value.transport.vehicle_source);
    const trailerId = cleanString(value.transport.trailer_id);
    if (vehicleSource) transport.vehicle_source = vehicleSource;
    if (trailerId) transport.trailer_id = trailerId;
    if (Object.keys(transport).length > 0) sanitized.transport = transport;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}
