const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LedgerOriginRow = {
  inventory_batch_id?: unknown;
  batch_id?: unknown;
  batch_id_text?: unknown;
  ticket_id?: unknown;
};

export type HarvestLedgerOriginRefs = {
  batchIds: Set<string>;
  ticketIds: Set<string>;
};

function unique(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function chunks<T>(values: T[], size = 400): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function resolveLedgerBatchId(row: LedgerOriginRow): string | null {
  const direct = String(row.inventory_batch_id || "").trim();
  if (UUID_RE.test(direct)) return direct;
  const text = String(row.batch_id_text || "").trim();
  if (UUID_RE.test(text)) return text;
  const legacy = String(row.batch_id || "").trim();
  return UUID_RE.test(legacy) ? legacy : null;
}

export function isHarvestLedgerRow(
  row: LedgerOriginRow,
  refs: HarvestLedgerOriginRefs
): boolean {
  const batchId = resolveLedgerBatchId(row);
  if (batchId && refs.batchIds.has(batchId)) return true;
  const ticketId = String(row.ticket_id || "").trim();
  return Boolean(ticketId && refs.ticketIds.has(ticketId));
}

export async function loadHarvestLedgerOriginRefs(
  supabase: any,
  companyId: string,
  rows: LedgerOriginRow[]
): Promise<HarvestLedgerOriginRefs> {
  const batchIds = unique(rows.map(resolveLedgerBatchId));
  const ticketIds = unique(rows.map((row) => row.ticket_id));
  const queries = [
    ...chunks(batchIds).map((part) =>
      supabase
        .from("harvest_lot_batches")
        .select("inventory_batch_id,source_ticket_id")
        .eq("company_id", companyId)
        .in("inventory_batch_id", part)
    ),
    ...chunks(ticketIds).map((part) =>
      supabase
        .from("harvest_lot_batches")
        .select("inventory_batch_id,source_ticket_id")
        .eq("company_id", companyId)
        .in("source_ticket_id", part)
    ),
  ];
  const results = await Promise.all(queries);
  const error = results.map((result: any) => result.error).find(Boolean);
  if (error) throw new Error(error.message || "Не удалось определить происхождение складского остатка");
  const links = results.flatMap((result: any) => result.data || []);
  return {
    batchIds: new Set(unique(links.map((row: any) => row.inventory_batch_id))),
    ticketIds: new Set(unique(links.map((row: any) => row.source_ticket_id))),
  };
}
