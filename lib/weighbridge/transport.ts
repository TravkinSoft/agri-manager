export type WeighbridgeTransportKind = {
  type?: string | null;
  fleetType?: string | null;
  fleet_type?: string | null;
  category?: string | null;
  transportCategory?: string | null;
};

export type TransportIdentityInput = {
  name?: unknown;
  customName?: unknown;
  custom_name?: unknown;
  fullName?: unknown;
  full_name?: unknown;
  brand?: unknown;
  model?: unknown;
  series?: unknown;
  plate?: unknown;
  plate_number?: unknown;
  license_plate?: unknown;
  sourceRawName?: unknown;
  source_raw_name?: unknown;
};

export type TransportIdentity = {
  name: string;
  plate: string;
  label: string;
  searchTerms: string[];
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
const SYNTHETIC_NAME_SUFFIX = /\s+#\d+\s*$/u;
const HIDDEN_IMPORT_SERIES = /^\d{5}-\d{3}$/u;

const cleanTransportPart = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ");

export function stripSyntheticTransportSuffix(value: unknown) {
  return cleanTransportPart(value).replace(SYNTHETIC_NAME_SUFFIX, "").trim();
}

const includesPart = (value: string, part: string) =>
  value.toLocaleLowerCase("ru-RU").includes(part.toLocaleLowerCase("ru-RU"));

function canonicalTransportName(transport: TransportIdentityInput) {
  const brand = cleanTransportPart(transport.brand);
  const model = stripSyntheticTransportSuffix(transport.model);
  const visibleModel = HIDDEN_IMPORT_SERIES.test(model) ? "" : model;
  if (brand) {
    return stripSyntheticTransportSuffix(
      visibleModel && !includesPart(brand, visibleModel) ? `${brand} ${visibleModel}` : brand
    );
  }

  const named = [
    transport.customName,
    transport.custom_name,
    transport.fullName,
    transport.full_name,
    transport.name,
  ]
    .map(stripSyntheticTransportSuffix)
    .find((value) => value && !GENERIC_TRANSPORT_NAMES.test(value));
  if (named) {
    if (model && HIDDEN_IMPORT_SERIES.test(model) && includesPart(named, model)) {
      const escapedModel = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return named.replace(new RegExp(`\\s*${escapedModel}`, "iu"), "").trim() || named;
    }
    return named;
  }
  return visibleModel;
}

export function resolveTransportIdentity(transport: TransportIdentityInput): TransportIdentity {
  const name = canonicalTransportName(transport);
  const rawPlate = [transport.plate, transport.plate_number, transport.license_plate]
    .find((value) => cleanTransportPart(value));
  const plate = isRealVehiclePlate(rawPlate) ? formatVehiclePlate(rawPlate) : "";
  const rawSearchTerms = [
    transport.name,
    transport.customName,
    transport.custom_name,
    transport.fullName,
    transport.full_name,
    transport.brand,
    transport.model,
    transport.series,
    rawPlate,
    plate,
    transport.sourceRawName,
    transport.source_raw_name,
  ]
    .map(cleanTransportPart)
    .filter(Boolean);
  const compactPlate = plate.replace(/[^\p{L}\p{N}]+/gu, "");
  if (compactPlate) rawSearchTerms.push(compactPlate, compactPlate.slice(-4));

  return {
    name,
    plate,
    label: [name, plate].filter(Boolean).join(" · "),
    searchTerms: Array.from(new Set(rawSearchTerms)),
  };
}

export function transportDisplayName(transport: TransportIdentityInput) {
  return resolveTransportIdentity(transport).name;
}

export function transportPickerLabel(transport: TransportIdentityInput) {
  return resolveTransportIdentity(transport).label;
}
