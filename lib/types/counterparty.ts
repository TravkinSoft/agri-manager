export type CounterpartyType =
  | "supplier"
  | "buyer"
  | "carrier"
  | "service"
  | "both"
  | "other";

export type CounterpartyCountryCode = "KZ" | "RU";

export interface GlobalCounterparty {
  id: string;
  legal_name: string;
  normalized_name: string;
  tax_id: string;
  country_code: CounterpartyCountryCode;
  aliases?: string[];
  short_name?: string | null;
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Counterparty {
  id: string;
  company_id: string;
  global_counterparty_id: string | null;
  name: string;
  legal_name: string;
  counterparty_type: CounterpartyType;
  roles: string[];
  aliases: string[];
  short_name: string | null;
  bin_iin: string | null;
  tax_id: string | null;
  country_code: CounterpartyCountryCode | null;
  country_name: string | null;
  phone: string | null;
  contact_person: string | null;
  notes: string | null;
  is_active: boolean;
  archived: boolean;
  source: "global" | "local";
  first_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CounterpartySearchResult {
  key: string;
  company_counterparty_id: string | null;
  global_counterparty_id: string | null;
  legal_name: string;
  tax_id: string | null;
  country_code: CounterpartyCountryCode | null;
  country_name: string | null;
  source: "company" | "global";
  roles?: string[];
  aliases?: string[];
  short_name?: string | null;
}

export interface ListCounterpartiesParams {
  companyId: string;
  userId?: string;
  type?: CounterpartyType | "all";
  activeOnly?: boolean;
  status?: "active" | "archived" | "all";
  country?: CounterpartyCountryCode | "all";
  search?: string;
}

export interface CreateCounterpartyInput {
  companyId: string;
  actorUserId?: string;
  globalCounterpartyId?: string | null;
  name: string;
  type: CounterpartyType;
  binIin?: string | null;
  countryCode?: CounterpartyCountryCode | null;
  phone?: string | null;
  contactPerson?: string | null;
  comment?: string | null;
  isActive?: boolean;
}

export interface UpdateCounterpartyInput {
  companyId: string;
  actorUserId?: string;
  isActive?: boolean;
  archived?: boolean;
}
