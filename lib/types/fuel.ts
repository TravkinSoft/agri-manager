export type FuelType = "diesel" | "gasoline" | "adblue" | "oil" | "other";
export type FuelSourceType = "stationary_azs" | "barrel" | "fuel_truck" | "mobile_tank";

export interface FuelSource {
  id: string;
  company_id: string;
  name: string;
  source_type: FuelSourceType;
  fuel_type: FuelType;
  capacity_liters: number | null;
  current_balance_liters: number;
  location: string | null;
  assigned_vehicle_id: string | null;
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface FuelVehicle {
  id: string;
  name: string;
  plate_number: string | null;
  vehicle_type: string | null;
  is_active: boolean;
  primary_responsible_personnel_id: string | null;
}

export interface FuelMechanizator {
  id: string;
  full_name: string;
  personnel_type: string | null;
  status: string | null;
}

export interface FuelIssueView {
  id: string;
  issued_at: string;
  fuel_source_id: string;
  fuel_source_name: string;
  fuel_type: FuelType;
  vehicle_id: string;
  vehicle_name: string;
  mechanizator_id: string | null;
  mechanizator_name: string | null;
  liters: number;
  comment: string | null;
}

export interface FuelTransferView {
  id: string;
  transferred_at: string;
  from_fuel_source_id: string;
  from_fuel_source_name: string;
  to_fuel_source_id: string;
  to_fuel_source_name: string;
  fuel_type: FuelType;
  liters: number;
  operator_personnel_id: string | null;
  operator_personnel_name: string | null;
  comment: string | null;
}

export interface FuelLimitView {
  id: string;
  period_month: string;
  fuel_type: FuelType;
  vehicle_id: string | null;
  mechanizator_id: string | null;
  target_label: string;
  limit_liters: number;
  issued_liters: number;
  remaining_liters: number;
  exceeded: boolean;
}

export interface FuelBootstrap {
  sources: FuelSource[];
  vehicles: FuelVehicle[];
  mechanizators: FuelMechanizator[];
  recentIssues: FuelIssueView[];
  recentTransfers: FuelTransferView[];
  limits: FuelLimitView[];
}

export interface CreateFuelIssueInput {
  companyId: string;
  actorUserId: string;
  fuelSourceId: string;
  vehicleId: string;
  mechanizatorId?: string | null;
  liters: number;
  comment?: string | null;
  issuedAt?: string | null;
}

export interface CreateFuelTransferInput {
  companyId: string;
  actorUserId: string;
  fromFuelSourceId: string;
  toFuelSourceId: string;
  liters: number;
  operatorPersonnelId?: string | null;
  comment?: string | null;
  transferredAt?: string | null;
}

export interface CreateFuelSourceInput {
  companyId: string;
  actorUserId: string;
  name: string;
  sourceType: FuelSourceType;
  fuelType: FuelType;
  capacityLiters?: number | null;
  currentBalanceLiters?: number | null;
  location?: string | null;
  assignedVehicleId?: string | null;
  isActive?: boolean;
}

export interface UpdateFuelSourceInput {
  companyId: string;
  actorUserId: string;
  name?: string;
  sourceType?: FuelSourceType;
  fuelType?: FuelType;
  capacityLiters?: number | null;
  currentBalanceLiters?: number | null;
  location?: string | null;
  assignedVehicleId?: string | null;
  isActive?: boolean;
  archived?: boolean;
}

export interface UpsertFuelLimitInput {
  companyId: string;
  actorUserId: string;
  periodMonth: string;
  fuelType: FuelType;
  vehicleId?: string | null;
  mechanizatorId?: string | null;
  limitLiters: number;
  note?: string | null;
  isActive?: boolean;
}
