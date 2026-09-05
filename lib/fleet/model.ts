export interface FleetVehicle {
  id: string;
  name: string;
  plate: string | null;
  driver: string | null;
}

export interface FleetSnapshot {
  companyId: string;
  vehicles: FleetVehicle[];
}

export function filterFleet(vehicles: FleetVehicle[], search: string, unassigned: boolean) {
  const query = search.trim().toLocaleLowerCase().replace(/\s+/g, "");
  return vehicles.filter(vehicle => (!unassigned || !vehicle.driver) &&
    (!query || [vehicle.name, vehicle.plate, vehicle.driver].some(value =>
      value?.toLocaleLowerCase().replace(/\s+/g, "").includes(query))));
}
