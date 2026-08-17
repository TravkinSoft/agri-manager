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

export function formatVehiclePlate(value: unknown) {
  const readable = String(value || "").trim().toLocaleUpperCase("ru-RU").replace(/\s+/g, " ");
  const compact = readable.replace(/[^\p{L}\p{N}]+/gu, "");
  const kazakhstanPlate = compact.match(/^(\d{3})([A-ZА-ЯЁ]{1,3})(\d{2,3})$/u);
  if (kazakhstanPlate) return `${kazakhstanPlate[1]} ${kazakhstanPlate[2]} ${kazakhstanPlate[3]}`;
  return readable;
}

export function transportPickerLabel(transport: { name?: string; model?: string; plate?: string }) {
  const name = String(transport.name || "").trim();
  const model = String(transport.model || "").trim();
  const plate = formatVehiclePlate(transport.plate);
  const brand = model && name.toLocaleLowerCase("ru-RU").includes(model.toLocaleLowerCase("ru-RU"))
    ? name.replace(new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"), "").replace(/[·,;()\-]+$/u, "").trim()
    : name;
  return [brand || (name !== model ? name : "") || "Транспорт", plate].filter(Boolean).join(" · ");
}
