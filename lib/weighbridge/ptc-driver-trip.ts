export type PtcLoadedVehicleState = {
  vehicle_id?: unknown;
  assigned?: unknown;
  state?: unknown;
  cycle?: unknown;
};

export type PtcLoadedEvent = {
  id?: unknown;
  vehicle_id?: unknown;
  driver_id?: unknown;
  to_state?: unknown;
  cycle?: unknown;
  created_at?: unknown;
};

export type PtcDriverTripResolution =
  | { status: "none" | "ambiguous"; candidateCount: number }
  | {
      status: "matched";
      candidateCount: 1;
      vehicleId: string;
      eventId: string;
      cycle: number;
    };

const id = (value: unknown) => String(value || "").trim();

/**
 * Resolves the one currently loaded PTC trip for a driver. The driver id is
 * canonical; the displayed full name is never used as a database key.
 *
 * This is intentionally strict. If a driver is attached to two loaded vehicle
 * states, the weighbridge must not guess which physical vehicle arrived.
 */
export function resolveUniqueLoadedPtcTripByDriver(params: {
  driverId: unknown;
  states: PtcLoadedVehicleState[];
  events: PtcLoadedEvent[];
}): PtcDriverTripResolution {
  const driverId = id(params.driverId);
  if (!driverId) return { status: "none", candidateCount: 0 };

  const candidates = params.states.flatMap((state) => {
    const vehicleId = id(state.vehicle_id);
    const cycle = Number(state.cycle);
    if (!vehicleId || state.assigned !== true || state.state !== "loaded" || !Number.isFinite(cycle)) {
      return [];
    }

    const event = params.events
      .filter((row) => (
        id(row.vehicle_id) === vehicleId
        && id(row.driver_id) === driverId
        && row.to_state === "loaded"
        && Number(row.cycle) === cycle
        && id(row.id)
      ))
      .sort((left, right) => {
        const byTime = String(right.created_at || "").localeCompare(String(left.created_at || ""));
        return byTime || id(right.id).localeCompare(id(left.id));
      })[0];

    return event
      ? [{ vehicleId, eventId: id(event.id), cycle }]
      : [];
  });

  if (candidates.length === 0) return { status: "none", candidateCount: 0 };
  if (candidates.length !== 1) {
    return { status: "ambiguous", candidateCount: candidates.length };
  }
  return { status: "matched", candidateCount: 1, ...candidates[0] };
}
