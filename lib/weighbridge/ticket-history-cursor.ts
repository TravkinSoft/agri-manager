import { Buffer } from "node:buffer";

export type TicketHistoryCursor = Readonly<{
  createdAt: string;
  id: string;
}>;

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function normalizeCreatedAt(value: unknown): string {
  const raw = String(value || "").trim();
  if (!TIMESTAMPTZ_RE.test(raw) || !Number.isFinite(Date.parse(raw))) {
    throw new Error("Invalid ticket history cursor timestamp");
  }
  return raw;
}
function normalizeId(value: unknown): string {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new Error("Invalid ticket history cursor id");
  }
  return id;
}

export function encodeTicketHistoryCursor(row: { created_at: unknown; id: unknown }): string {
  const payload = {
    v: CURSOR_VERSION,
    createdAt: normalizeCreatedAt(row.created_at),
    id: normalizeId(row.id),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeTicketHistoryCursor(value: string): TicketHistoryCursor {
  const encoded = String(value || "").trim();
  if (!encoded || encoded.length > MAX_CURSOR_LENGTH || !BASE64URL_RE.test(encoded)) {
    throw new Error("Invalid ticket history cursor encoding");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid ticket history cursor payload");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid ticket history cursor payload");
  }

  const record = payload as Record<string, unknown>;
  if (record.v !== CURSOR_VERSION) {
    throw new Error("Unsupported ticket history cursor version");
  }

  return Object.freeze({
    createdAt: normalizeCreatedAt(record.createdAt),
    id: normalizeId(record.id),
  });
}

/**
 * The values are decoded from a server-issued cursor and normalized above, so
 * interpolating them into PostgREST's raw `.or()` syntax cannot add operators.
 */
export function ticketHistoryCursorFilter(cursor: TicketHistoryCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}
