import type { HarvestBatchSummary, WeighbridgeTicket } from "@/lib/types/weighbridge";

export const HARVEST_TIME_ZONE = "Asia/Qyzylorda";
export const ASTYK_STEM_OPERATIONAL_DAY_START_HOUR = 7;

export type HarvestPeriodPreset = "current_day" | "previous_day" | "current_shift" | "last_24_hours" | "season" | "custom";

export type HarvestPeriod = {
  preset: HarvestPeriodPreset;
  start: string;
  end: string;
  label: string;
  operationalDayStartHour: number;
  shiftAvailable: boolean;
};

export type HarvestDashboardFilters = {
  cropId?: string | null;
  varietyId?: string | null;
  reproductionId?: string | null;
  fieldId?: string | null;
  warehouseId?: string | null;
};

export type HarvestFilterOption = { id: string; label: string };

export type HarvestFilterOptions = {
  crops: HarvestFilterOption[];
  varieties: HarvestFilterOption[];
  reproductions: HarvestFilterOption[];
  fields: HarvestFilterOption[];
  warehouses: HarvestFilterOption[];
};

export type HarvestIdentity = {
  cropId: string | null;
  crop: string;
  varietyId: string | null;
  variety: string | null;
  reproductionId: string | null;
  reproduction: string | null;
  label: string;
  complete: boolean;
};

export type HarvestIssue = {
  key: string;
  kind: "long_open" | "missing_moisture" | "unknown_identity" | "corrected_or_voided" | "unusual_tare" | "stale_field";
  title: string;
  detail: string;
  ticketId?: string;
};

export type HarvestPartyTicket = {
  ticketId: string;
  ticketNo: string;
  occurredAt: string;
  fieldId: string | null;
  fieldName: string;
  vehicleLabel: string;
  driverName: string;
  destinationId: string | null;
  destinationName: string;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  moisturePercent: number | null;
  waitingTareMinutes: number | null;
  statusLabel: string;
};

export type HarvestParty = {
  key: string;
  seasonId: string | null;
  cropId: string | null;
  cropName: string;
  varietyId: string | null;
  varietyName: string | null;
  reproductionId: string | null;
  reproductionName: string | null;
  identityLabel: string;
  complete: boolean;
  currentStockKg: number;
  receivedKg: number;
  openTicketCount: number;
  completedTicketCount: number;
  lastTrip: HarvestPartyTicket | null;
  openTickets: HarvestPartyTicket[];
  completedTickets: HarvestPartyTicket[];
  fields: Array<{
    key: string;
    fieldId: string | null;
    fieldName: string;
    receivedKg: number;
    trips: number;
    lastTripAt: string;
    lastTripKg: number;
  }>;
  warehouses: Array<{ warehouseId: string; warehouseName: string; currentKg: number }>;
  moisture: {
    latestPercent: number;
    averagePercent: number;
    minimumPercent: number;
    maximumPercent: number;
    measuredTrips: number;
    totalTrips: number;
  } | null;
  issues: HarvestIssue[];
};

export type HarvestOverview = {
  period: HarvestPeriod;
  completedTripCount: number;
  openTicketCount: number;
  parties: HarvestParty[];
  cropTotals: Array<{ key: string; cropId: string | null; cropName: string; receivedKg: number; trips: number }>;
  openTickets: Array<{
    ticketId: string;
    ticketNo: string;
    openedAt: string;
    fieldName: string;
    identityLabel: string;
    vehicleLabel: string;
    grossWeightKg: number;
    waitingTareMinutes: number;
  }>;
  completedEvents: Array<{
    ticketId: string;
    ticketNo: string;
    occurredAt: string;
    fieldName: string;
    identityLabel: string;
    destinationName: string;
    netWeightKg: number;
  }>;
  fields: Array<{
    key: string;
    fieldId: string | null;
    fieldName: string;
    identityLabel: string;
    destinationName: string;
    receivedKg: number;
    trips: number;
    lastTripAt: string;
    lastTicketId: string;
    lastTicketNo: string;
  }>;
  moisture: Array<{
    key: string;
    fieldName: string;
    cropName: string;
    latestPercent: number;
    averagePercent: number;
    minimumPercent: number;
    maximumPercent: number;
    measuredTrips: number;
    totalTrips: number;
  }>;
  issues: HarvestIssue[];
};

export type WarehouseHarvestRow = {
  key: string;
  harvestLotId: string | null;
  seasonId: string | null;
  warehouseId: string;
  cropId: string | null;
  varietyId: string | null;
  reproductionId: string | null;
  warehouseName: string;
  identityLabel: string;
  currentKg: number;
  trips: number;
  requiresReview: boolean;
};

export function cleanLabel(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text || text === "-" || /^без\s+/i.test(text) || /не уточн/i.test(text)) return null;
  return text;
}

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

function localDateTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute?: number; second?: number },
  timeZone: string
): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0, parts.second || 0);
  let candidate = target;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += target - actualUtc;
  }
  return new Date(candidate);
}

function moveLocalDate(parts: { year: number; month: number; day: number }, days: number) {
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

function formatPeriodPoint(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value).replace(",", "");
}

export function resolveHarvestPeriod(input: {
  preset?: HarvestPeriodPreset;
  now?: Date;
  customStart?: string | null;
  customEnd?: string | null;
  shift?: { opened_at?: string | null; closed_at?: string | null; status?: string | null } | null;
  season?: { start_date?: string | null; end_date?: string | null; year?: number | null } | null;
  timeZone?: string;
  operationalDayStartHour?: number;
}): HarvestPeriod {
  const now = input.now || new Date();
  const timeZone = input.timeZone || HARVEST_TIME_ZONE;
  const operationalDayStartHour = Math.min(23, Math.max(0, Number(input.operationalDayStartHour ?? ASTYK_STEM_OPERATIONAL_DAY_START_HOUR)));
  const localNow = zonedParts(now, timeZone);
  const operationalDate = localNow.hour < operationalDayStartHour
    ? moveLocalDate(localNow, -1)
    : { year: localNow.year, month: localNow.month, day: localNow.day };
  const currentStart = localDateTimeToUtc({ ...operationalDate, hour: operationalDayStartHour }, timeZone);
  const requestedPreset = input.preset || "current_day";
  let preset = requestedPreset;
  let start = currentStart;
  let end = now;
  const shiftAvailable = Boolean(input.shift?.opened_at && input.shift?.status === "open");

  if (requestedPreset === "previous_day") {
    const previousDate = moveLocalDate(operationalDate, -1);
    start = localDateTimeToUtc({ ...previousDate, hour: operationalDayStartHour }, timeZone);
    end = currentStart;
  } else if (requestedPreset === "last_24_hours") {
    start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (requestedPreset === "current_shift") {
    if (shiftAvailable) {
      start = new Date(String(input.shift?.opened_at));
    } else {
      preset = "current_day";
    }
  } else if (requestedPreset === "season") {
    const seasonYear = Number(input.season?.year || localNow.year);
    const startDate = input.season?.start_date ? new Date(`${input.season.start_date}T00:00:00Z`) : new Date(Date.UTC(seasonYear, 0, 1));
    const localStart = { year: startDate.getUTCFullYear(), month: startDate.getUTCMonth() + 1, day: startDate.getUTCDate() };
    start = localDateTimeToUtc({ ...localStart, hour: operationalDayStartHour }, timeZone);
  } else if (requestedPreset === "custom") {
    const parsedStart = input.customStart ? new Date(input.customStart) : null;
    const parsedEnd = input.customEnd ? new Date(input.customEnd) : null;
    if (parsedStart && parsedEnd && !Number.isNaN(parsedStart.getTime()) && !Number.isNaN(parsedEnd.getTime()) && parsedStart < parsedEnd) {
      start = parsedStart;
      end = parsedEnd > now ? now : parsedEnd;
    } else {
      preset = "current_day";
    }
  }

  return {
    preset,
    start: start.toISOString(),
    end: end.toISOString(),
    label: `${formatPeriodPoint(start, timeZone)} — ${Math.abs(end.getTime() - now.getTime()) < 60_000 ? "сейчас" : formatPeriodPoint(end, timeZone)}`,
    operationalDayStartHour,
    shiftAvailable,
  };
}

export function dateKey(value: string | Date, timeZone = HARVEST_TIME_ZONE): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function isEffectiveFinalizedHarvestTicket(ticket: WeighbridgeTicket): boolean {
  return ticket.op_type === "harvest_incoming"
    && ticket.status === "finalized"
    && ticket.is_finalized === true
    && ticket.is_voided !== true
    && !ticket.replacement_ticket_id;
}

export function isOpenHarvestTicket(ticket: WeighbridgeTicket): boolean {
  return ticket.op_type === "harvest_incoming"
    && !ticket.is_voided
    && !ticket.is_finalized
    && ["draft", "active", "ready_to_close"].includes(ticket.status);
}

export function ticketIdentity(ticket: WeighbridgeTicket): HarvestIdentity {
  const line = ticket.lines?.[0];
  const crop = cleanLabel(ticket.crop_name_snapshot) || cleanLabel(line?.product_name) || "Культура не указана";
  const variety = cleanLabel(ticket.variety_name_snapshot) || cleanLabel(line?.variety_name);
  const reproduction = cleanLabel(ticket.reproduction_name_snapshot) || cleanLabel(line?.reproduction_name);
  const complete = Boolean(variety && reproduction);
  return {
    cropId: cleanLabel(line?.crop_id) || null,
    crop,
    varietyId: cleanLabel(line?.variety_id) || null,
    variety,
    reproductionId: cleanLabel(line?.reproduction_id) || null,
    reproduction,
    complete,
    label: complete ? [crop, variety, reproduction].join(" · ") : `${crop} · Требуется уточнение`,
  };
}

export function isPotatoLabel(value: unknown): boolean {
  return /картоф|potato|картоп/i.test(String(value || ""));
}

export function isMoistureApplicable(value: unknown): boolean {
  if (isPotatoLabel(value)) return false;
  return /пшениц|ячмен|ов[её]с|рож|кукуруз|рапс|л[её]н|подсолнеч|соя|горох|прос|греч|сорго|wheat|barley|oat|rye|corn|maize|rapeseed|flax|sunflower|soy|pea/i.test(String(value || ""));
}

function ticketMatchesFilters(ticket: WeighbridgeTicket, filters: HarvestDashboardFilters): boolean {
  const identity = ticketIdentity(ticket);
  const line = ticket.lines?.[0];
  if (filters.cropId && identity.cropId !== filters.cropId) return false;
  if (filters.varietyId && identity.varietyId !== filters.varietyId) return false;
  if (filters.reproductionId && identity.reproductionId !== filters.reproductionId) return false;
  if (filters.fieldId && ticket.field_id !== filters.fieldId) return false;
  if (filters.warehouseId && ticket.warehouse_to_id !== filters.warehouseId && line?.warehouse_to_id !== filters.warehouseId) return false;
  return true;
}

function ticketTime(ticket: WeighbridgeTicket): number {
  return new Date(ticket.finalized_at || ticket.updated_at || ticket.created_at).getTime();
}

function destinationName(ticket: WeighbridgeTicket): string {
  return cleanLabel(ticket.warehouse_to_name_snapshot) || "Место приёмки не указано";
}

function vehicleLabel(ticket: WeighbridgeTicket): string {
  return [cleanLabel(ticket.vehicle_name_snapshot), cleanLabel(ticket.vehicle_plate_snapshot)].filter(Boolean).join(" · ") || "Машина не указана";
}

function partyIdentityFingerprint(seasonId: string | null | undefined, identity: HarvestIdentity): string {
  return [seasonId || "season?", identity.cropId || identity.crop, identity.varietyId || "variety?", identity.reproductionId || "reproduction?"].join("|");
}

function partyKeyFromIdentity(ticket: WeighbridgeTicket, identity: HarvestIdentity, knownPartyByIdentity?: Map<string, string>): string {
  if (ticket.harvest_lot_id) return `lot:${ticket.harvest_lot_id}`;
  const identityKey = partyIdentityFingerprint(ticket.season_id, identity);
  const knownPartyKey = identity.complete ? knownPartyByIdentity?.get(identityKey) : null;
  if (knownPartyKey) return knownPartyKey;
  return identity.complete ? `identity:${identityKey}` : `provisional:${ticket.id}`;
}

function partyKeyFromWarehouse(row: WarehouseHarvestRow): string {
  if (row.harvestLotId) return `lot:${row.harvestLotId}`;
  const identityKey = [row.seasonId || "season?", row.cropId || row.identityLabel, row.varietyId || "variety?", row.reproductionId || "reproduction?"].join("|");
  return row.requiresReview ? `provisional-stock:${row.key}` : `identity:${identityKey}`;
}

function pluralRu(value: number, one: string, few: string, many: string): string {
  const normalized = Math.abs(Math.trunc(value));
  if (normalized % 100 >= 11 && normalized % 100 <= 14) return many;
  if (normalized % 10 === 1) return one;
  if (normalized % 10 >= 2 && normalized % 10 <= 4) return few;
  return many;
}

export function buildHarvestFilterOptions(tickets: WeighbridgeTicket[], warehouseRows: WarehouseHarvestRow[] = []): HarvestFilterOptions {
  const maps = {
    crops: new Map<string, string>(), varieties: new Map<string, string>(), reproductions: new Map<string, string>(),
    fields: new Map<string, string>(), warehouses: new Map<string, string>(),
  };
  for (const ticket of tickets.filter((row) => row.op_type === "harvest_incoming")) {
    const identity = ticketIdentity(ticket);
    if (identity.cropId) maps.crops.set(identity.cropId, identity.crop);
    if (identity.varietyId && identity.variety) maps.varieties.set(identity.varietyId, identity.variety);
    if (identity.reproductionId && identity.reproduction) maps.reproductions.set(identity.reproductionId, identity.reproduction);
    if (ticket.field_id) maps.fields.set(ticket.field_id, cleanLabel(ticket.field_name_snapshot) || "Поле не указано");
    if (ticket.warehouse_to_id) maps.warehouses.set(ticket.warehouse_to_id, destinationName(ticket));
  }
  for (const row of warehouseRows) {
    if (row.cropId) maps.crops.set(row.cropId, row.identityLabel.split(" · ")[0]);
    if (row.varietyId) maps.varieties.set(row.varietyId, row.identityLabel.split(" · ")[1] || "Сорт не указан");
    if (row.reproductionId) maps.reproductions.set(row.reproductionId, row.identityLabel.split(" · ")[2] || "Репродукция не указана");
    if (row.warehouseId) maps.warehouses.set(row.warehouseId, row.warehouseName);
  }
  const values = (map: Map<string, string>) => Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  return { crops: values(maps.crops), varieties: values(maps.varieties), reproductions: values(maps.reproductions), fields: values(maps.fields), warehouses: values(maps.warehouses) };
}

export function buildHarvestOverview(
  tickets: WeighbridgeTicket[],
  options: { period: HarvestPeriod; filters?: HarvestDashboardFilters; now?: Date; warehouseRows?: WarehouseHarvestRow[] }
): HarvestOverview {
  const now = options.now || new Date();
  const filters = options.filters || {};
  const startMs = new Date(options.period.start).getTime();
  const endMs = new Date(options.period.end).getTime();
  const harvestTickets = tickets.filter((ticket) => ticket.op_type === "harvest_incoming" && ticketMatchesFilters(ticket, filters));
  const finalized = harvestTickets.filter((ticket) => isEffectiveFinalizedHarvestTicket(ticket) && ticketTime(ticket) >= startMs && ticketTime(ticket) <= endMs);
  const open = harvestTickets.filter(isOpenHarvestTicket);
  const warehouseRows = options.warehouseRows || [];

  const cropMap = new Map<string, HarvestOverview["cropTotals"][number]>();
  const fieldMap = new Map<string, HarvestOverview["fields"][number]>();
  const moistureMap = new Map<string, { key: string; fieldName: string; cropName: string; samples: Array<{ percent: number; kg: number; occurredAt: string }>; totalTrips: number }>();
  const partyMap = new Map<string, HarvestParty>();
  const knownPartyByIdentity = new Map<string, string>();

  const ensureParty = (key: string, identity: HarvestIdentity, seasonId: string | null): HarvestParty => {
    const existing = partyMap.get(key);
    if (existing) return existing;
    const party: HarvestParty = {
      key,
      seasonId,
      cropId: identity.cropId,
      cropName: identity.crop,
      varietyId: identity.varietyId,
      varietyName: identity.variety,
      reproductionId: identity.reproductionId,
      reproductionName: identity.reproduction,
      identityLabel: identity.label,
      complete: identity.complete,
      currentStockKg: 0,
      receivedKg: 0,
      openTicketCount: 0,
      completedTicketCount: 0,
      lastTrip: null,
      openTickets: [],
      completedTickets: [],
      fields: [],
      warehouses: [],
      moisture: null,
      issues: [],
    };
    partyMap.set(key, party);
    return party;
  };

  for (const row of warehouseRows) {
    if (filters.cropId && row.cropId !== filters.cropId) continue;
    if (filters.varietyId && row.varietyId !== filters.varietyId) continue;
    if (filters.reproductionId && row.reproductionId !== filters.reproductionId) continue;
    if (filters.warehouseId && row.warehouseId !== filters.warehouseId) continue;
    const parts = row.identityLabel.split(" · ");
    const identity: HarvestIdentity = {
      cropId: row.cropId,
      crop: parts[0] || "Культура не указана",
      varietyId: row.varietyId,
      variety: row.requiresReview ? null : parts[1] || null,
      reproductionId: row.reproductionId,
      reproduction: row.requiresReview ? null : parts[2] || null,
      label: row.identityLabel,
      complete: !row.requiresReview,
    };
    const partyKey = partyKeyFromWarehouse(row);
    if (identity.complete) knownPartyByIdentity.set(partyIdentityFingerprint(row.seasonId, identity), partyKey);
    const party = ensureParty(partyKey, identity, row.seasonId);
    party.currentStockKg += row.currentKg;
    party.warehouses.push({ warehouseId: row.warehouseId, warehouseName: row.warehouseName, currentKg: row.currentKg });
  }

  for (const ticket of finalized) {
    const identity = ticketIdentity(ticket);
    const party = ensureParty(partyKeyFromIdentity(ticket, identity, knownPartyByIdentity), identity, ticket.season_id || null);
    const fieldName = cleanLabel(ticket.field_name_snapshot) || "Поле не указано";
    const netKg = Number(ticket.net_weight_kg || 0);
    const occurredAt = ticket.finalized_at || ticket.updated_at;
    const partyTicket: HarvestPartyTicket = {
      ticketId: ticket.id,
      ticketNo: ticket.ticket_no,
      occurredAt,
      fieldId: ticket.field_id || null,
      fieldName,
      vehicleLabel: vehicleLabel(ticket),
      driverName: cleanLabel(ticket.driver_name_snapshot) || "Водитель не указан",
      destinationId: ticket.warehouse_to_id || ticket.lines?.[0]?.warehouse_to_id || null,
      destinationName: destinationName(ticket),
      grossWeightKg: ticket.gross_weight_kg == null ? null : Number(ticket.gross_weight_kg),
      netWeightKg: netKg,
      moisturePercent: ticket.lines?.[0]?.moisture_percent == null ? null : Number(ticket.lines[0].moisture_percent),
      waitingTareMinutes: null,
      statusLabel: "Завершён",
    };
    party.receivedKg += netKg;
    party.completedTicketCount += 1;
    party.completedTickets.push(partyTicket);
    if (!party.lastTrip || new Date(occurredAt).getTime() >= new Date(party.lastTrip.occurredAt).getTime()) party.lastTrip = partyTicket;
    const cropKey = identity.cropId || identity.crop;
    const cropRow = cropMap.get(cropKey) || { key: cropKey, cropId: identity.cropId, cropName: identity.crop, receivedKg: 0, trips: 0 };
    cropRow.receivedKg += netKg;
    cropRow.trips += 1;
    cropMap.set(cropKey, cropRow);

    const fieldKey = `${ticket.field_id || fieldName}|${identity.cropId || identity.crop}|${identity.varietyId || "?"}|${identity.reproductionId || "?"}`;
    const fieldRow = fieldMap.get(fieldKey) || {
      key: fieldKey, fieldId: ticket.field_id || null, fieldName, identityLabel: identity.label,
      destinationName: destinationName(ticket), receivedKg: 0, trips: 0, lastTripAt: occurredAt,
      lastTicketId: ticket.id, lastTicketNo: ticket.ticket_no,
    };
    fieldRow.receivedKg += netKg;
    fieldRow.trips += 1;
    if (new Date(occurredAt).getTime() >= new Date(fieldRow.lastTripAt).getTime()) {
      fieldRow.lastTripAt = occurredAt;
      fieldRow.lastTicketId = ticket.id;
      fieldRow.lastTicketNo = ticket.ticket_no;
      fieldRow.destinationName = destinationName(ticket);
    }
    fieldMap.set(fieldKey, fieldRow);

    if (isMoistureApplicable(identity.crop)) {
      const moistureKey = `${fieldKey}|moisture`;
      const row = moistureMap.get(moistureKey) || { key: moistureKey, fieldName, cropName: identity.crop, samples: [], totalTrips: 0 };
      row.totalTrips += 1;
      const measured = ticket.lines?.[0]?.moisture_percent;
      if (measured != null && Number.isFinite(Number(measured))) row.samples.push({ percent: Number(measured), kg: netKg, occurredAt });
      moistureMap.set(moistureKey, row);
    }
  }

  for (const ticket of open) {
    const identity = ticketIdentity(ticket);
    const party = ensureParty(partyKeyFromIdentity(ticket, identity, knownPartyByIdentity), identity, ticket.season_id || null);
    const waitMinutes = Math.max(0, Math.floor((now.getTime() - new Date(ticket.weighing_1_at || ticket.created_at).getTime()) / 60_000));
    party.openTicketCount += 1;
    party.openTickets.push({
      ticketId: ticket.id,
      ticketNo: ticket.ticket_no,
      occurredAt: ticket.weighing_1_at || ticket.created_at,
      fieldId: ticket.field_id || null,
      fieldName: cleanLabel(ticket.field_name_snapshot) || "Поле не указано",
      vehicleLabel: vehicleLabel(ticket),
      driverName: cleanLabel(ticket.driver_name_snapshot) || "Водитель не указан",
      destinationId: ticket.warehouse_to_id || ticket.lines?.[0]?.warehouse_to_id || null,
      destinationName: destinationName(ticket),
      grossWeightKg: ticket.gross_weight_kg == null ? null : Number(ticket.gross_weight_kg),
      netWeightKg: null,
      moisturePercent: null,
      waitingTareMinutes: waitMinutes,
      statusLabel: "Ожидает тару",
    });
  }

  const fields = Array.from(fieldMap.values()).sort((a, b) => b.receivedKg - a.receivedKg);
  const moisture = Array.from(moistureMap.values()).filter((row) => row.samples.length > 0).map((row) => {
    const samples = [...row.samples].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    const weightedKg = samples.reduce((sum, sample) => sum + sample.kg, 0);
    return {
      key: row.key, fieldName: row.fieldName, cropName: row.cropName,
      latestPercent: samples[0].percent,
      averagePercent: weightedKg > 0 ? samples.reduce((sum, sample) => sum + sample.percent * sample.kg, 0) / weightedKg : samples.reduce((sum, sample) => sum + sample.percent, 0) / samples.length,
      minimumPercent: Math.min(...samples.map((sample) => sample.percent)),
      maximumPercent: Math.max(...samples.map((sample) => sample.percent)),
      measuredTrips: samples.length,
      totalTrips: row.totalTrips,
    };
  });

  for (const party of Array.from(partyMap.values())) {
    const partyCompleted = party.completedTickets;
    const fieldRows = new Map<string, HarvestParty["fields"][number]>();
    const moistureSamples = partyCompleted
      .filter((ticket) => ticket.moisturePercent != null)
      .map((ticket) => ({ percent: Number(ticket.moisturePercent), kg: Number(ticket.netWeightKg || 0), occurredAt: ticket.occurredAt }));
    for (const ticket of partyCompleted) {
      const key = ticket.fieldId || ticket.fieldName;
      const row = fieldRows.get(key) || { key, fieldId: ticket.fieldId, fieldName: ticket.fieldName, receivedKg: 0, trips: 0, lastTripAt: ticket.occurredAt, lastTripKg: Number(ticket.netWeightKg || 0) };
      row.receivedKg += Number(ticket.netWeightKg || 0);
      row.trips += 1;
      if (new Date(ticket.occurredAt).getTime() >= new Date(row.lastTripAt).getTime()) {
        row.lastTripAt = ticket.occurredAt;
        row.lastTripKg = Number(ticket.netWeightKg || 0);
      }
      fieldRows.set(key, row);
    }
    party.fields = Array.from(fieldRows.values()).sort((a, b) => b.receivedKg - a.receivedKg);
    party.openTickets.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    party.completedTickets.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    party.warehouses.sort((a, b) => b.currentKg - a.currentKg);
    if (isMoistureApplicable(party.cropName) && moistureSamples.length) {
      const samples = [...moistureSamples].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      const weightedKg = samples.reduce((sum, sample) => sum + sample.kg, 0);
      party.moisture = {
        latestPercent: samples[0].percent,
        averagePercent: weightedKg > 0 ? samples.reduce((sum, sample) => sum + sample.percent * sample.kg, 0) / weightedKg : samples.reduce((sum, sample) => sum + sample.percent, 0) / samples.length,
        minimumPercent: Math.min(...samples.map((sample) => sample.percent)),
        maximumPercent: Math.max(...samples.map((sample) => sample.percent)),
        measuredTrips: samples.length,
        totalTrips: partyCompleted.length,
      };
    }
  }

  const issues: HarvestIssue[] = [];
  for (const ticket of open) {
    const waitMinutes = Math.max(0, Math.floor((now.getTime() - new Date(ticket.weighing_1_at || ticket.created_at).getTime()) / 60_000));
    if (waitMinutes >= 90) issues.push({ key: `long-${ticket.id}`, kind: "long_open", title: "Талон долго открыт", detail: `${ticket.ticket_no} ждёт тару ${waitMinutes} мин.`, ticketId: ticket.id });
  }
  for (const [key, row] of Array.from(moistureMap.entries())) {
    if (row.samples.length < row.totalTrips) issues.push({ key: `moisture-${key}`, kind: "missing_moisture", title: "Не вся влажность измерена", detail: `${row.cropName} · ${row.fieldName}: ${row.samples.length} из ${row.totalTrips} рейсов.` });
  }
  const incomplete = finalized.filter((ticket) => !ticketIdentity(ticket).complete);
  if (incomplete.length) issues.push({ key: "unknown-identity", kind: "unknown_identity", title: "Нужно уточнить сорт или репродукцию", detail: `${incomplete.length} завершённых ${pluralRu(incomplete.length, "рейс", "рейса", "рейсов")} за выбранный период.` });
  const corrected = harvestTickets.filter((ticket) => (ticket.is_voided || ticket.replacement_ticket_id || ticket.correction_of_ticket_id) && ticketTime(ticket) >= startMs && ticketTime(ticket) <= endMs);
  if (corrected.length) issues.push({ key: "corrected", kind: "corrected_or_voided", title: "Есть исправленные или аннулированные талоны", detail: `${corrected.length} ${pluralRu(corrected.length, "документ", "документа", "документов")} за выбранный период.` });
  const unusual = finalized.filter((ticket) => /"tare_variance_confirmed"\s*:\s*true/i.test(JSON.stringify(ticket.audit_json || {})));
  if (unusual.length) issues.push({ key: "tare", kind: "unusual_tare", title: "Подтверждена необычная тара", detail: `${unusual.length} ${pluralRu(unusual.length, "рейс", "рейса", "рейсов")} за выбранный период.` });
  if (["current_day", "current_shift"].includes(options.period.preset)) {
    for (const row of fields.filter((field) => field.trips >= 2)) {
      const idleMinutes = Math.floor((now.getTime() - new Date(row.lastTripAt).getTime()) / 60_000);
      if (idleMinutes >= 240) issues.push({ key: `stale-${row.key}`, kind: "stale_field", title: "Давно нет рейсов с поля", detail: `${row.fieldName}: последний рейс ${idleMinutes} мин. назад.` });
    }
  }


  for (const party of Array.from(partyMap.values())) {
    const ticketIds = new Set([...party.openTickets, ...party.completedTickets].map((ticket) => ticket.ticketId));
    const relatedPeriodTickets = harvestTickets.filter((ticket) => {
      if (ticketTime(ticket) < startMs || ticketTime(ticket) > endMs) return false;
      return partyKeyFromIdentity(ticket, ticketIdentity(ticket), knownPartyByIdentity) === party.key;
    });
    const partyIssues: HarvestIssue[] = issues.filter((issue) => Boolean(issue.ticketId && ticketIds.has(issue.ticketId)));

    if (!party.complete && party.completedTicketCount > 0) {
      partyIssues.push({
        key: `unknown-${party.key}`,
        kind: "unknown_identity",
        title: "Нужно уточнить сорт или репродукцию",
        detail: `${party.completedTicketCount} ${pluralRu(party.completedTicketCount, "завершённый рейс", "завершённых рейса", "завершённых рейсов")} за выбранный период.`,
      });
    }
    if (isMoistureApplicable(party.cropName) && party.completedTicketCount > 0) {
      const measuredTrips = party.moisture?.measuredTrips || 0;
      if (measuredTrips < party.completedTicketCount) {
        partyIssues.push({
          key: `moisture-${party.key}`,
          kind: "missing_moisture",
          title: "Не вся влажность измерена",
          detail: `${party.cropName}: ${measuredTrips} из ${party.completedTicketCount} рейсов.`,
        });
      }
    }
    const correctedCount = relatedPeriodTickets.filter((ticket) => ticket.is_voided || ticket.replacement_ticket_id || ticket.correction_of_ticket_id).length;
    if (correctedCount > 0) {
      partyIssues.push({
        key: `corrected-${party.key}`,
        kind: "corrected_or_voided",
        title: "Есть исправленные или аннулированные талоны",
        detail: `${correctedCount} ${pluralRu(correctedCount, "документ", "документа", "документов")} за выбранный период.`,
      });
    }
    const unusualCount = relatedPeriodTickets.filter((ticket) => isEffectiveFinalizedHarvestTicket(ticket) && /"tare_variance_confirmed"\s*:\s*true/i.test(JSON.stringify(ticket.audit_json || {}))).length;
    if (unusualCount > 0) {
      partyIssues.push({
        key: `tare-${party.key}`,
        kind: "unusual_tare",
        title: "Подтверждена необычная тара",
        detail: `${unusualCount} ${pluralRu(unusualCount, "рейс", "рейса", "рейсов")} за выбранный период.`,
      });
    }
    if (["current_day", "current_shift"].includes(options.period.preset)) {
      for (const field of party.fields.filter((row) => row.trips >= 2)) {
        const idleMinutes = Math.floor((now.getTime() - new Date(field.lastTripAt).getTime()) / 60_000);
        if (idleMinutes >= 240) {
          partyIssues.push({
            key: `stale-${party.key}-${field.key}`,
            kind: "stale_field",
            title: "Давно нет рейсов с поля",
            detail: `${field.fieldName}: последний рейс ${idleMinutes} мин. назад.`,
          });
        }
      }
    }
    party.issues = partyIssues;
  }

  return {
    period: options.period,
    completedTripCount: finalized.length,
    openTicketCount: open.length,
    parties: Array.from(partyMap.values())
      .filter((party) => party.currentStockKg > 0 || party.receivedKg > 0 || party.openTicketCount > 0)
      .sort((a, b) => b.openTicketCount - a.openTicketCount || b.receivedKg - a.receivedKg || b.currentStockKg - a.currentStockKg),
    cropTotals: Array.from(cropMap.values()).sort((a, b) => b.receivedKg - a.receivedKg),
    openTickets: open.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((ticket) => ({
      ticketId: ticket.id, ticketNo: ticket.ticket_no, openedAt: ticket.weighing_1_at || ticket.created_at,
      fieldName: cleanLabel(ticket.field_name_snapshot) || "Поле не указано", identityLabel: ticketIdentity(ticket).label,
      vehicleLabel: vehicleLabel(ticket), grossWeightKg: Number(ticket.gross_weight_kg || 0),
      waitingTareMinutes: Math.max(0, Math.floor((now.getTime() - new Date(ticket.weighing_1_at || ticket.created_at).getTime()) / 60_000)),
    })),
    completedEvents: [...finalized].sort((a, b) => ticketTime(b) - ticketTime(a)).slice(0, 8).map((ticket) => ({
      ticketId: ticket.id, ticketNo: ticket.ticket_no, occurredAt: ticket.finalized_at || ticket.updated_at,
      fieldName: cleanLabel(ticket.field_name_snapshot) || "Поле не указано", identityLabel: ticketIdentity(ticket).label,
      destinationName: destinationName(ticket), netWeightKg: Number(ticket.net_weight_kg || 0),
    })),
    fields,
    moisture,
    issues,
  };
}

export function buildWarehouseHarvestRows(batches: HarvestBatchSummary[], filters: HarvestDashboardFilters = {}): WarehouseHarvestRow[] {
  return batches
    .filter((batch) => Number(batch.cleanMassKg || 0) > 0)
    .filter((batch) => !filters.cropId || batch.cropId === filters.cropId)
    .filter((batch) => !filters.varietyId || batch.varietyId === filters.varietyId)
    .filter((batch) => !filters.reproductionId || batch.reproductionId === filters.reproductionId)
    .filter((batch) => !filters.warehouseId || batch.warehouseId === filters.warehouseId)
    .map((batch) => {
      const complete = cleanLabel(batch.varietyName) && cleanLabel(batch.reproductionName);
      return {
        key: `${batch.id}|${batch.warehouseId}`,
        harvestLotId: batch.aggregateLotId || (batch.aggregateLot ? batch.id : null),
        seasonId: batch.seasonId || null,
        warehouseId: batch.warehouseId,
        cropId: batch.cropId,
        varietyId: batch.varietyId,
        reproductionId: batch.reproductionId,
        warehouseName: cleanLabel(batch.warehouseName) || "Склад не указан",
        identityLabel: complete
          ? [batch.cropName, batch.varietyName, batch.reproductionName].filter(Boolean).join(" · ")
          : `${cleanLabel(batch.cropName) || "Культура не указана"} · Требуется уточнение`,
        currentKg: Number(batch.cleanMassKg || 0),
        trips: Number(batch.tripCount || 0),
        requiresReview: batch.reviewState === "requires_review" || !complete,
      };
    })
    .sort((a, b) => b.currentKg - a.currentKg);
}
