export type MealType = "breakfast" | "lunch" | "dinner" | "other";

export type MealOrderStatus =
  | "new"
  | "accepted"
  | "cooking"
  | "ready"
  | "issued"
  | "partially_returned"
  | "returned"
  | "cancelled";

export type MealOrderPersonStatus = "pending" | "assigned" | "issued" | "returned" | "lost" | "damaged";

export type ThermosStatus =
  | "available"
  | "assigned"
  | "issued"
  | "returned_dirty"
  | "cleaning"
  | "damaged"
  | "lost"
  | "inactive";

export type ThermosReturnAction = "returned" | "damaged" | "lost";

export type ThermosEventType =
  | "created"
  | "assigned"
  | "issued"
  | "returned"
  | "damaged"
  | "lost"
  | "cleaned"
  | "deactivated";

export interface MealOrderPerson {
  id: string;
  company_id: string;
  meal_order_id: string;
  person_name: string;
  employee_id: string | null;
  comment: string | null;
  thermos_id: string | null;
  thermos_number: string | null;
  issue_status: MealOrderPersonStatus;
  issued_at: string | null;
  returned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MealOrder {
  id: string;
  company_id: string;
  requested_by_user_id: string;
  brigadier_name: string | null;
  meal_date: string;
  meal_type: MealType;
  field_id: string | null;
  delivery_location_text: string | null;
  comment: string | null;
  status: MealOrderStatus;
  people_count: number;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  issued_at: string | null;
  returned_at: string | null;
  cancelled_at: string | null;
  fields?: {
    id: string;
    name: string | null;
  } | null;
  people: MealOrderPerson[];
}

export interface Thermos {
  id: string;
  company_id: string;
  number: string;
  label: string | null;
  volume_l: number | null;
  status: ThermosStatus;
  current_holder_name: string | null;
  current_meal_order_id: string | null;
  last_issued_at: string | null;
  last_returned_at: string | null;
  created_at: string;
  updated_at: string;
  recent_events?: ThermosEvent[];
}

export interface ThermosEvent {
  id: string;
  company_id: string;
  thermos_id: string;
  meal_order_id: string | null;
  meal_order_person_id: string | null;
  event_type: ThermosEventType;
  actor_user_id: string | null;
  holder_name: string | null;
  comment: string | null;
  created_at: string;
}

export interface MealAwaitingReturn {
  meal_order_id: string;
  meal_order_person_id: string;
  meal_date: string;
  meal_type: MealType;
  order_status: MealOrderStatus;
  brigadier_name: string | null;
  field_id: string | null;
  field_name: string | null;
  person_name: string | null;
  thermos_id: string | null;
  thermos_number: string | null;
  issued_at: string | null;
  delivery_location_text: string | null;
}

export interface MealThermosSummary {
  orders_today: number;
  lunches_today: number;
  thermoses_issued: number;
  awaiting_return: number;
  thermoses_lost: number;
  thermoses_damaged: number;
}

export interface MealThermosBootstrapPayload {
  orders: MealOrder[];
  thermoses: Thermos[];
  thermos_events: ThermosEvent[];
  fields: Array<{ id: string; name: string; area: number | null }>;
  awaiting_returns: MealAwaitingReturn[];
  summary: MealThermosSummary;
}

export interface CreateMealOrderInput {
  meal_date: string;
  meal_type: MealType;
  field_id?: string | null;
  delivery_location_text?: string | null;
  comment?: string | null;
  brigadier_name?: string | null;
  people?: string[];
  people_text?: string | null;
}

export interface CreateThermosInput {
  number: string;
  label?: string | null;
  volume_l?: number | null;
  status?: ThermosStatus;
}
