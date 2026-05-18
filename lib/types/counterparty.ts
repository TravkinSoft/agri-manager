export type CounterpartyType =
  | "supplier"
  | "buyer"
  | "carrier"
  | "service"
  | "both"
  | "other";

export interface Counterparty {
  id: string;
  company_id: string;
  name: string;
  counterparty_type: CounterpartyType;
  bin_iin: string | null;
  phone: string | null;
  contact_person: string | null;
  notes: string | null;
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListCounterpartiesParams {
  companyId: string;
  userId: string;
  type?: CounterpartyType | "all";
  activeOnly?: boolean;
}

export interface CreateCounterpartyInput {
  companyId: string;
  actorUserId: string;
  name: string;
  type: CounterpartyType;
  binIin?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  comment?: string | null;
  isActive?: boolean;
}

export interface UpdateCounterpartyInput {
  companyId: string;
  actorUserId: string;
  name?: string;
  type?: CounterpartyType;
  binIin?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  comment?: string | null;
  isActive?: boolean;
  archived?: boolean;
}
