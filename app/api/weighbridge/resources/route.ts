import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { isCargoVehicle, isTrailerTransport, resolveTransportIdentity } from "@/lib/weighbridge/transport";
import { vehicleAllowsMachineOperator } from "@/lib/vehicles/driver-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEIGHBRIDGE_PERSONNEL_ROLES = new Set(["driver", "mechanic_operator"]);

type ResourceError = {
  resource:
    | "reference_vehicles"
    | "company_people"
    | "reference_specialists"
    | "profiles"
    | "fields"
    | "warehouses";
  code: string;
  message: string;
};

const RESOURCE_ERROR_COPY: Record<ResourceError["resource"], Omit<ResourceError, "resource">> = {
  reference_vehicles: {
    code: "WB_RESOURCES_VEHICLES",
    message: "Не удалось загрузить транспорт. Остальные данные сохранены.",
  },
  company_people: {
    code: "WB_RESOURCES_DRIVERS",
    message: "Не удалось загрузить сотрудников весовой. Остальные данные сохранены.",
  },
  reference_specialists: {
    code: "WB_RESOURCES_DRIVER_LINKS",
    message: "Не удалось обновить связи водителей и транспорта. Остальные данные сохранены.",
  },
  profiles: {
    code: "WB_RESOURCES_PROFILE_NAMES",
    message: "Не удалось обновить служебные имена. Остальные данные сохранены.",
  },
  fields: {
    code: "WB_RESOURCES_FIELDS",
    message: "Не удалось загрузить поля. Остальные данные сохранены.",
  },
  warehouses: {
    code: "WB_RESOURCES_DESTINATIONS",
    message: "Не удалось загрузить места приёмки. Остальные данные сохранены.",
  },
};

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const settled = await Promise.allSettled([
      supabase
        .from("reference_vehicles")
        .select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name,type,fleet_type,primary_responsible_personnel_id,is_active,archived,transport_model:transport_model_id(full_name,category)")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("archived", false)
        .order("name", { ascending: true }),
      supabase
        .from("company_people")
        .select("id,full_name,role_type,position,department,status,deleted_at")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("full_name", { ascending: true }),
      supabase
        .from("reference_specialists")
        .select("id,person_id,full_name,name_ru,name_kz,name_en,status,archived,personnel_type")
        .eq("company_id", companyId),
      supabase
        .from("profiles")
        .select("id,full_name,email")
        .eq("company_id", companyId),
      supabase
        .from("fields")
        .select("id,name,area,field_code")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("name", { ascending: true }),
      supabase
        .from("warehouses")
        .select("id,name,name_ru,name_kz,name_en,warehouse_type,place_type,archived,is_archived")
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_archived", false)
        .order("name", { ascending: true }),
    ]);

    const resourceNames: ResourceError["resource"][] = [
      "reference_vehicles",
      "company_people",
      "reference_specialists",
      "profiles",
      "fields",
      "warehouses",
    ];
    const resourceErrors: ResourceError[] = [];
    const readRows = (index: number) => {
      const result = settled[index];
      const resource = resourceNames[index];
      const failure = RESOURCE_ERROR_COPY[resource];
      if (result.status === "rejected") {
        console.warn(`[${failure.code}] ${resource} request rejected`);
        resourceErrors.push({ resource, ...failure });
        return [] as any[];
      }
      if (result.value.error) {
        console.warn(`[${failure.code}] ${resource} query failed`, {
          databaseCode: result.value.error.code,
          databaseMessage: result.value.error.message,
        });
        resourceErrors.push({ resource, ...failure });
        return [] as any[];
      }
      return (result.value.data || []) as any[];
    };

    const vehicleSourceRows = readRows(0);
    const peopleRows = readRows(1);
    const legacyDriverRows = readRows(2);
    const profileRows = readRows(3);
    const fieldRows = readRows(4);
    const warehouseRows = readRows(5);

    const vehicleRows = vehicleSourceRows.map((row: any) => {
      const transportModel = Array.isArray(row.transport_model)
        ? row.transport_model[0]
        : row.transport_model;
      const identity = resolveTransportIdentity(row);
      return {
        id: String(row.id),
        name: identity.name,
        model: String(transportModel?.full_name || row.model || row.name || ""),
        plate: identity.plate,
        searchTerms: identity.searchTerms,
        type: String(row.type || ""),
        fleetType: String(row.fleet_type || ""),
        transportCategory: String(transportModel?.category || ""),
        source: "reference_vehicles" as const,
        primaryPersonnelId: row.primary_responsible_personnel_id
          ? String(row.primary_responsible_personnel_id)
          : null,
      };
    });
    const vehicles = vehicleRows.filter((row) => isCargoVehicle(row));
    const trailers = vehicleRows.filter((row) => isTrailerTransport(row));

    const legacyPersonById = new Map<string, { personId: string; personnelType: string }>();
    const driverNames: Record<string, string> = {};
    legacyDriverRows.forEach((row: any) => {
      const legacyId = String(row.id);
      // Current assignments require an active driver bridge; historical names stay unfiltered.
      if (row.person_id && row.status === "active" && row.archived === false &&
          (row.personnel_type === "driver" || row.personnel_type === "machine_operator")) {
        legacyPersonById.set(legacyId, {
          personId: String(row.person_id),
          personnelType: String(row.personnel_type),
        });
      }
      driverNames[legacyId] = String(
        row.name_ru || row.full_name || row.name_en || row.name_kz || "Водитель"
      );
    });
    profileRows.forEach((row: any) => {
      driverNames[String(row.id)] = String(row.full_name || row.email || "Водитель");
    });

    const byDriver = new Map<string, string[]>();
    vehicleRows.forEach((vehicle) => {
      if (!vehicle.primaryPersonnelId) return;
      const bridge = legacyPersonById.get(vehicle.primaryPersonnelId);
      if (!bridge || (bridge.personnelType === "machine_operator" &&
          !vehicleAllowsMachineOperator(vehicle))) return;
      const assigned = byDriver.get(bridge.personId) || [];
      assigned.push(vehicle.id);
      byDriver.set(bridge.personId, assigned);
    });

    const drivers = peopleRows.filter((row: any) => WEIGHBRIDGE_PERSONNEL_ROLES.has(String(row.role_type))).map((row: any) => {
      const id = String(row.id);
      const name = String(row.full_name || "Сотрудник");
      driverNames[id] = name;
      return {
      id: String(row.id),
      name,
      machineId: null as string | null,
      roleType: String(row.role_type),
      position: String(row.position || ""),
      department: String(row.department || ""),
      assignedVehicleIds: byDriver.get(id) || [],
    };
    });
    const combineOperators = peopleRows.map((row: any) => ({
      id: String(row.id),
      name: String(row.full_name || "Сотрудник"),
      roleType: String(row.role_type || ""),
      position: String(row.position || ""),
      department: String(row.department || ""),
    }));

    const fields = fieldRows.map((row: any) => ({
      id: String(row.id),
      name: String(row.name || "Поле"),
      area: Number(row.area || 0),
      fieldCode: row.field_code ? String(row.field_code) : null,
    }));
    const destinations = warehouseRows.map((row: any) => ({
      id: String(row.id),
      name: String(row.name || "Склад"),
      name_ru: row.name_ru ? String(row.name_ru) : null,
      name_kz: row.name_kz ? String(row.name_kz) : null,
      name_en: row.name_en ? String(row.name_en) : null,
      warehouseType: String(row.warehouse_type || ""),
      placeType: String(row.place_type || "WAREHOUSE"),
    }));

    return NextResponse.json({
      companyId,
      fields,
      destinations,
      vehicles,
      trailers,
      drivers,
      driverNames,
      combineOperators,
      resourceErrors,
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load weighbridge resources" },
      { status: 500 }
    );
  }
}
