export type WeighbridgeTransportKind = {
  type?: string | null;
  fleetType?: string | null;
  fleet_type?: string | null;
  category?: string | null;
  transportCategory?: string | null;
};

const CARGO_TYPES = new Set([
  "truck",
  "grain_truck",
  "dump_truck",
  "tractor_unit",
  "special_vehicle",
]);

const normalizedKinds = (transport: WeighbridgeTransportKind | null | undefined) =>
  [
    transport?.type,
    transport?.fleetType,
    transport?.fleet_type,
    transport?.category,
    transport?.transportCategory,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

export function isTrailerTransport(transport: WeighbridgeTransportKind | null | undefined) {
  const kinds = normalizedKinds(transport);
  return kinds.some((kind) => kind === "trailer" || kind === "semi_trailer" || kind === "tractor_trailer");
}

export function isCargoVehicle(transport: WeighbridgeTransportKind | null | undefined) {
  const kinds = normalizedKinds(transport);
  if (kinds.includes("light_vehicle") || isTrailerTransport(transport)) return false;
  return kinds.some((kind) => CARGO_TYPES.has(kind));
}

export function isCargoTractor(transport: WeighbridgeTransportKind | null | undefined) {
  return normalizedKinds(transport).includes("tractor");
}
