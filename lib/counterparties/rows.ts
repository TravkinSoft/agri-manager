import { COUNTERPARTY_COUNTRY_LABELS } from "@/lib/counterparties/catalog";
import type { Counterparty, CounterpartyCountryCode, GlobalCounterparty } from "@/lib/types/counterparty";

export const COUNTERPARTY_SELECT = [
  "id",
  "company_id",
  "global_counterparty_id",
  "name",
  "counterparty_type",
  "roles",
  "aliases",
  "short_name",
  "bin_iin",
  "country_code",
  "phone",
  "contact_person",
  "notes",
  "is_active",
  "archived",
  "first_used_at",
  "created_at",
  "updated_at",
  "global:global_counterparties(id,legal_name,normalized_name,tax_id,country_code,aliases,short_name,is_active,archived,created_at,updated_at)",
].join(",");

function nestedGlobal(row: any): GlobalCounterparty | null {
  const value = Array.isArray(row?.global) ? row.global[0] : row?.global;
  return value?.id ? (value as GlobalCounterparty) : null;
}

export function normalizeCounterpartyRow(row: any): Counterparty {
  const global = nestedGlobal(row);
  const countryCode = String(global?.country_code || row?.country_code || "") as CounterpartyCountryCode;
  const legalName = String(global?.legal_name || row?.name || "Контрагент");
  const taxId = global?.tax_id == null ? row?.bin_iin ?? null : String(global.tax_id);
  const globalAliases = global && Array.isArray(global.aliases) ? global.aliases : [];
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    global_counterparty_id: global?.id ? String(global.id) : row.global_counterparty_id ?? null,
    name: legalName,
    legal_name: legalName,
    counterparty_type: String(row.counterparty_type || "other") as Counterparty["counterparty_type"],
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    aliases: Array.from(new Set([...globalAliases, ...(Array.isArray(row.aliases) ? row.aliases : [])].map(String).filter(Boolean))),
    short_name: String(global?.short_name || row.short_name || "").trim() || null,
    bin_iin: taxId,
    tax_id: taxId,
    country_code: countryCode === "KZ" || countryCode === "RU" ? countryCode : null,
    country_name: countryCode === "KZ" || countryCode === "RU"
      ? COUNTERPARTY_COUNTRY_LABELS[countryCode]
      : null,
    phone: row.phone ?? null,
    contact_person: row.contact_person ?? null,
    notes: row.notes ?? null,
    is_active: row.is_active !== false,
    archived: row.archived === true,
    source: global ? "global" : "local",
    first_used_at: row.first_used_at ?? null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}
