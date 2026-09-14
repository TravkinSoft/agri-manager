import { createHash } from "node:crypto";
import {
  SOURCES,
  type SourceName,
  type SourceRead,
  type Row,
  type Snapshot,
} from "./contracts";
import { AssistError, QA_ORIGIN, UUID } from "./policy";

const CATALOGS: SourceName[] = ["crops", "varieties", "seed_reproductions"];
const V2: Partial<Record<SourceName, string>> = {
  weighbridge_shared_impurity_groups: ",settlement_mode",
  weighbridge_shared_impurity_members: ",allocated_impurity_kg,clean_total_kg",
  weighbridge_shared_impurity_source_batches:
    ",allocated_impurity_kg,source_restore_ledger_entry_id,impurity_out_ledger_entry_id",
};
const KEY: Partial<Record<SourceName, string>> = {
  ptc_flows: "company_id",
  ptc_vehicle_states: "vehicle_id",
  fleet_vehicle_repairs: "vehicle_id",
  ptc_combine_operator_statuses: "operator_user_id",
};
const PAGE = 500;
const MAX = 10000;
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** A purpose-built REST reader, not a Supabase client: exposes no write or RPC method.
 * PTC service-only tables require the server credential. Every URL is generated here;
 * tenant, method, path, projection and returned tenant are checked independently. */
export function createReadOnlySourceReader(
  companyId: string,
  credential: string,
  transport: Transport = fetch,
  sourceOrigin = QA_ORIGIN,
) {
  let origin: string;
  try {
    const url = new URL(sourceOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") throw new Error("invalid origin");
    origin = url.origin;
  } catch {
    throw new AssistError("Источник данных TF Assist не настроен.", 503);
  }
  if (!UUID.test(companyId) || !credential)
    throw new AssistError("Источник данных не настроен.", 503);
  const deadline = Date.now() + 35000;
  async function page(
    table: SourceName,
    after: string,
    v2: boolean,
  ): Promise<Response> {
    if (!Object.prototype.hasOwnProperty.call(SOURCES, table))
      throw new AssistError("Источник запрещён.", 403);
    const url = new URL(`/rest/v1/${table}`, origin);
    url.searchParams.set(
      "select",
      SOURCES[table] + (v2 ? V2[table] || "" : ""),
    );
    if (CATALOGS.includes(table))
      url.searchParams.set(
        "or",
        `(company_id.eq.${companyId},company_id.is.null)`,
      );
    else url.searchParams.set("company_id", `eq.${companyId}`);
    const key = KEY[table] || "id";
    url.searchParams.set("order", `${key}.asc`);
    url.searchParams.set("limit", String(PAGE));
    if (after) url.searchParams.set(key, `gt.${after}`);
    // Redirects are rejected: a service credential must never follow a remote location.
    if (Date.now() >= deadline) throw new Error("SOURCE_DEADLINE");
    return transport(url.toString(), {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        apikey: credential,
        Authorization: `Bearer ${credential}`,
        Prefer: "count=exact",
      },
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(15000, deadline - Date.now())),
      ),
    });
  }
  return async function read(table: SourceName): Promise<SourceRead> {
    const startedAt = new Date().toISOString();
    let data: Row[] = [],
      v2 = Boolean(V2[table]);
    let state: SourceRead["state"] = "complete",
      reason: string | undefined;
    try {
      let after = "";
      for (;;) {
        let response = await page(table, after, v2);
        if (!response.ok && v2 && !after) {
          const error = await response.json().catch(() => ({}));
          // Only a missing-column error permits the explicitly supported V1 contract.
          if (error.code === "42703" || error.code === "PGRST204") {
            v2 = false;
            response = await page(table, after, false);
          }
        }
        if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
        const part: unknown = await response.json();
        if (!Array.isArray(part) || part.length > PAGE)
          throw new Error("SOURCE_SHAPE");
        for (const item of part) {
          if (!item || typeof item !== "object" || Array.isArray(item))
            throw new Error("SOURCE_SHAPE");
          const row = item as Row;
          if (
            row.company_id !== companyId &&
            !(CATALOGS.includes(table) && row.company_id === null)
          )
            throw new Error("SOURCE_TENANT");
          const key = String(row[KEY[table] || "id"] || "");
          if (!UUID.test(key) || (after && key <= after))
            throw new Error("SOURCE_ORDER");
          after = key;
          // Even a misbehaving upstream cannot add notes, auth fields or contact details.
          data.push(
            Object.fromEntries(
              (SOURCES[table] + (v2 ? V2[table] || "" : ""))
                .split(",")
                .map((field) => {
                  const key = field.split(":")[0];
                  return [key, row[key]];
                }),
            ),
          );
        }
        const remaining = Number(
          response.headers.get("content-range")?.split("/")[1],
        );
        if (!Number.isFinite(remaining) || remaining < part.length)
          throw new Error("SOURCE_COUNT");
        if (remaining === part.length) break;
        if (!part.length || data.length >= MAX) {
          state = "truncated";
          reason = "SOURCE_LIMIT";
          break;
        }
      }
    } catch (error) {
      state = "unavailable";
      reason =
        error instanceof Error && /^SOURCE_/.test(error.message)
          ? error.message
          : "SOURCE_UNAVAILABLE";
    }
    if (state !== "complete") data = [];
    return {
      table,
      state,
      rows: data,
      startedAt,
      endedAt: new Date().toISOString(),
      digest: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
      reason,
      schema: v2 ? "settlement_v2" : "base",
    };
  };
}

export async function loadSnapshot(
  companyId: string,
  read: (table: SourceName) => Promise<SourceRead>,
  tables: SourceName[] = Object.keys(SOURCES) as SourceName[],
): Promise<Snapshot> {
  const snapshot: Snapshot = {
    companyId,
    startedAt: new Date().toISOString(),
    endedAt: "",
    sources: {},
  };
  // Bounded concurrency; all failures remain visible and cannot turn into zero facts.
  for (let i = 0; i < tables.length; i += 5) {
    const chunk = await Promise.all(tables.slice(i, i + 5).map(read));
    for (const source of chunk) snapshot.sources[source.table] = source;
  }
  snapshot.endedAt = new Date().toISOString();
  return snapshot;
}
