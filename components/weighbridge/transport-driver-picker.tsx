"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/weighbridge/searchable-combobox";
import type {
  OpenTransportAssignment,
  RecentTransportPair,
} from "@/lib/weighbridge/transport-pairing";
import { formatVehiclePlate, transportPickerLabel } from "@/lib/weighbridge/transport";

type Vehicle = {
  id: string;
  name: string;
  model: string;
  plate: string;
  type: string;
  searchTerms?: string[];
};

type Driver = {
  id: string;
  name: string;
  position?: string;
  department?: string;
};

type Props = {
  vehicleId: string;
  driverId: string;
  vehicles: Vehicle[];
  drivers: Driver[];
  recentPairs: RecentTransportPair[];
  latestDriverByVehicle: Record<string, string>;
  latestVehicleByDriver: Record<string, string>;
  openAssignments: OpenTransportAssignment[];
  optional?: boolean;
  disabled?: boolean;
  onChange: (vehicleId: string, driverId: string) => void;
  onBlockedAssignment: (assignment: OpenTransportAssignment) => void;
  onComplete?: () => void;
};

const vehicleTitle = (vehicle: Vehicle) => transportPickerLabel(vehicle);

export function TransportDriverSelects({
  vehicleId,
  driverId,
  vehicles,
  drivers,
  recentPairs,
  latestDriverByVehicle,
  latestVehicleByDriver,
  openAssignments,
  optional = false,
  disabled = false,
  onChange,
  onBlockedAssignment,
  onComplete,
}: Props) {
  const vehicleById = useMemo(() => new Map(vehicles.map((item) => [item.id, item])), [vehicles]);
  const driverById = useMemo(() => new Map(drivers.map((item) => [item.id, item])), [drivers]);
  const assignmentByVehicle = useMemo(() => {
    const map = new Map<string, OpenTransportAssignment>();
    openAssignments.forEach((item) => { if (item.vehicleId) map.set(item.vehicleId, item); });
    return map;
  }, [openAssignments]);
  const assignmentByDriver = useMemo(() => {
    const map = new Map<string, OpenTransportAssignment>();
    openAssignments.forEach((item) => { if (item.driverId) map.set(item.driverId, item); });
    return map;
  }, [openAssignments]);
  const recentVehicleIds = useMemo(
    () => Array.from(new Set(recentPairs.map((pair) => pair.vehicleId))),
    [recentPairs]
  );
  const recentDriverIds = useMemo(
    () => Array.from(new Set(recentPairs.map((pair) => pair.driverId))),
    [recentPairs]
  );

  const vehicleOptions = useMemo<SearchableComboboxOption[]>(() => {
    const recentOrder = new Map(recentVehicleIds.map((id, index) => [id, index]));
    return [...vehicles]
      .sort((a, b) => {
        const aRecent = recentOrder.get(a.id);
        const bRecent = recentOrder.get(b.id);
        if (aRecent != null || bRecent != null) return (aRecent ?? 999) - (bRecent ?? 999);
        return vehicleTitle(a).localeCompare(vehicleTitle(b), "ru");
      })
      .map((vehicle) => {
        const assignment = assignmentByVehicle.get(vehicle.id);
        return {
          value: vehicle.id,
          label: vehicleTitle(vehicle),
          status: assignment ? "Ждёт тару" : undefined,
          group: recentOrder.has(vehicle.id) ? "Недавно использованные" : "Остальные",
          keywords: [vehicle.name, vehicle.model, vehicle.plate, vehicle.type, ...(vehicle.searchTerms || [])].concat([
            formatVehiclePlate(vehicle.plate),
            String(vehicle.plate || "").replace(/[^\p{L}\p{N}]+/gu, "").slice(-4),
          ]),
        };
      });
  }, [vehicles, recentVehicleIds, assignmentByVehicle]);

  const driverOptions = useMemo<SearchableComboboxOption[]>(() => {
    const recentOrder = new Map(recentDriverIds.map((id, index) => [id, index]));
    return [...drivers]
      .sort((a, b) => {
        const aRecent = recentOrder.get(a.id);
        const bRecent = recentOrder.get(b.id);
        if (aRecent != null || bRecent != null) return (aRecent ?? 999) - (bRecent ?? 999);
        return a.name.localeCompare(b.name, "ru");
      })
      .map((driver) => {
        const assignment = assignmentByDriver.get(driver.id);
        return {
          value: driver.id,
          label: driver.name,
          description: [
            driver.position,
            driver.department,
            assignment ? `Ждёт тару${assignment.ticketNo ? ` · ${assignment.ticketNo}` : ""}` : "",
          ].filter(Boolean).join(" · "),
          group: recentOrder.has(driver.id) ? "Недавно использованные" : "Остальные",
          keywords: [driver.name, driver.position || "", driver.department || ""],
        };
      });
  }, [drivers, recentDriverIds, assignmentByDriver]);

  const chooseVehicle = (nextVehicleId: string) => {
    const assignment = assignmentByVehicle.get(nextVehicleId);
    if (assignment) {
      onBlockedAssignment(assignment);
      return;
    }
    let nextDriverId = driverId;
    if (!nextDriverId) {
      const suggestedDriverId = latestDriverByVehicle[nextVehicleId] || "";
      if (suggestedDriverId && driverById.has(suggestedDriverId) && !assignmentByDriver.has(suggestedDriverId)) {
        nextDriverId = suggestedDriverId;
      }
    }
    onChange(nextVehicleId, nextDriverId);
    if (nextDriverId) onComplete?.();
  };

  const chooseDriver = (nextDriverId: string) => {
    const assignment = assignmentByDriver.get(nextDriverId);
    if (assignment) {
      onBlockedAssignment(assignment);
      return;
    }
    let nextVehicleId = vehicleId;
    if (!nextVehicleId) {
      const suggestedVehicleId = latestVehicleByDriver[nextDriverId] || "";
      if (suggestedVehicleId && vehicleById.has(suggestedVehicleId) && !assignmentByVehicle.has(suggestedVehicleId)) {
        nextVehicleId = suggestedVehicleId;
      }
    }
    onChange(nextVehicleId, nextDriverId);
    if (nextVehicleId) onComplete?.();
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <Label>Транспорт{optional ? "" : " *"}</Label>
        <SearchableCombobox
          value={vehicleId}
          options={vehicleOptions}
          onValueChange={chooseVehicle}
          placeholder="Выберите транспорт"
          searchPlaceholder="Машина, модель или госномер"
          emptyLabel="Транспорт не найден"
          ariaLabel="Транспорт"
          disabled={disabled}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label>Водитель{optional ? "" : " *"}</Label>
        <SearchableCombobox
          value={driverId}
          options={driverOptions}
          onValueChange={chooseDriver}
          placeholder="Выберите водителя"
          searchPlaceholder="Имя или фамилия водителя"
          emptyLabel="Водитель не найден"
          ariaLabel="Водитель"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
