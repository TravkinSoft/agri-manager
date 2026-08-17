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

const INVALID_PLATE_PATTERNS = [
  /^OSV[-_\s]?ROW[-_\s]?/iu,
  /^IMPORT[-_\s]?/iu,
  /^(SOURCE|SRC)[-_\s]?ROW[-_\s]?/iu,
  /^(ROW|LINE)[-_\s]?\d+$/iu,
  /^\d{4,}[-/]\d+$/u,
  /^(NULL|NONE|N\/A|НЕТ|БЕЗ НОМЕРА)$/iu,
];

export function isRealVehiclePlate(value: unknown) {
  const plate = String(value || "").trim();
  if (!plate || INVALID_PLATE_PATTERNS.some((pattern) => pattern.test(plate))) return false;
  const compact = plate.replace(/[^\p{L}\p{N}]+/gu, "");
  return compact.length >= 4 && /\d/u.test(compact);
}

const GENERIC_TRANSPORT_NAMES = /^(транспорт|машина|автомобиль|vehicle|truck)$/iu;

export function transportDisplayName(transport: { name?: string; model?: string; plate?: string }) {
  const name = String(transport.name || "").trim();
  const model = String(transport.model || "").trim();
  const specificName = name && !GENERIC_TRANSPORT_NAMES.test(name) ? name : "";
  if (specificName) {
    if (model && specificName.toLocaleLowerCase("ru-RU").includes(model.toLocaleLowerCase("ru-RU"))) {
      const escapedModel = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return specificName
        .replace(new RegExp(escapedModel, "iu"), "")
        .replace(/[·,;()\-]+$/u, "")
        .trim() || specificName;
    }
    return specificName.replace(/\s+\d{4,}(?:[-/]\d+)+(?:\s.*)?$/u, "").trim() || specificName;
  }
  return model.replace(/\s+\d{4,}(?:[-/]\d+)+(?:\s.*)?$/u, "").trim() || model;
}

export function transportPickerLabel(transport: { name?: string; model?: string; plate?: string }) {
  const name = transportDisplayName(transport);
  const plate = isRealVehiclePlate(transport.plate) ? formatVehiclePlate(transport.plate) : "";
  return [name, plate].filter(Boolean).join(" · ");
}
