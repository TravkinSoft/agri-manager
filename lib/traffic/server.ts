import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  getServerActorFromSession,
  resolveCompanyForActor,
  SessionAuthError,
} from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { activeAssignedDriverName, vehicleAllowsMachineOperator } from "@/lib/vehicles/driver-name";
import { readVehicleRepairs } from "@/lib/fleet/repairs-server";
import { getFleetVehicleBrand } from "@/lib/fleet/model";
import {
  isPtcEligibleReferenceVehicle,
  isStructurallyPtcReferenceVehicle,
  ptcVehicleDisplayPlate,
} from "@/lib/traffic/vehicle-eligibility";
import {
  visibleVehicles,
  operatorRole,
  type TrafficRole,
  type TrafficSnapshot,
  type TrafficVehicle,
} from "./model";
import { calculateTrafficAnalytics, type TrafficAnalyticsEvent } from "./analytics";

export class TrafficError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      Vary: "Cookie, Authorization",
    },
  });
}
export function sameOrigin(request: NextRequest) {
  if (
    request.headers.get("origin") !== request.nextUrl.origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new TrafficError("Запрос с другого сайта запрещён", 403);
}
export function failed(error: unknown) {
  if (error instanceof TrafficError || error instanceof SessionAuthError)
    return noStore({ error: error.message }, error.status);
  if (error && typeof error === "object" && "issues" in error)
    return noStore({ error: "Проверьте заполненные поля" }, 400);
  const message = error instanceof Error ? error.message : "";
  const known: Record<string, [number, string]> = {
    FLEET_REPAIR_FORBIDDEN: [403, "Нет доступа к ремонту этой машины"],
    FLEET_REPAIR_INVALID: [400, "Обновите карточку машины"],
    FLEET_REPAIR_VEHICLE_UNAVAILABLE: [404, "Машина недоступна в этой компании"],
    FLEET_REPAIR_CONFLICT: [409, "Статус ремонта уже изменили. Обновите карточку и проверьте машину"],
    FLEET_VEHICLE_IN_REPAIR: [409, "Машина на ремонте. Новая загрузка недоступна до возвращения в работу"],
    PTC_UNAUTHORIZED: [401, "Войдите в кабинет заново"],
    PTC_PERSON_LINK_REQUIRED: [
      403,
      "Администратор должен связать аккаунт с одним действующим сотрудником Вашей компании",
    ],
    PTC_DISABLED: [409, "Оборот машин приостановлен агрономом"],
    PTC_NOT_ASSIGNED: [403, "Машина не назначена этому потоку"],
    PTC_COMPANY_MISMATCH: [403, "Объект не принадлежит Вашей компании"],
    PTC_VERSION_CONFLICT: [
      409,
      "Статус уже изменился. Обновите список и проверьте машину",
    ],
    PTC_KEY_CONFLICT: [409, "Это подтверждение уже использовано"],
    PTC_LINE_FORBIDDEN: [403, "Нет прав на изменение машин на линии"],
    PTC_LINE_CONFLICT: [409, "Список уже изменился. Проверьте обновлённые машины и повторите действие"],
    PTC_INVALID_FLEET: [400, "На линии может быть не более 100 машин"],
    PTC_FORBIDDEN_TRANSITION: [403, "Этот переход недоступен в Вашем кабинете"],
    PTC_ACTIVE_VEHICLE: [409, "Сначала завершите оборот занятых машин"],
    PTC_ACTIVE_FIELD: [
      409,
      "Поле можно изменить после возвращения всех машин в состояние «Пустая»",
    ],
    PTC_INELIGIBLE_VEHICLE: [409, "Эта техника не входит в картофельный оборот"],
    PTC_INACTIVE_VEHICLE: [409, "Выберите действующие машины компании"],
    PTC_LAST_VEHICLE_FORBIDDEN: [403, "Метка последней машины доступна только комбайнёру"],
    PTC_LAST_VEHICLE_INVALID: [400, "Проверьте выбранную машину"],
    PTC_LAST_VEHICLE_UNAVAILABLE: [409, "Последней можно отметить только пустую машину на линии"],
    PTC_LAST_VEHICLE_CONFLICT: [409, "Метка уже изменилась. Обновите список"],
    PTC_SHIFT_FORBIDDEN: [403, "Смена доступна только комбайнёру"],
    PTC_SHIFT_INVALID: [400, "Проверьте данные смены"],
    PTC_SHIFT_ALREADY_OPEN: [409, "Смена уже открыта"],
    PTC_SHIFT_CONFLICT: [409, "Смена уже изменилась. Обновите кабинет"],
    PTC_COMBINE_STATUS_FORBIDDEN: [403, "Статус комбайна доступен только комбайнёру"],
    PTC_COMBINE_STATUS_INVALID: [400, "Проверьте статус комбайна"],
    PTC_COMBINE_STATUS_VERSION_CONFLICT: [
      409,
      "Статус комбайна уже изменился. Обновите кабинет",
    ],
    PTC_COMBINE_STATUS_NO_CHANGE: [409, "Статус комбайна уже установлен"],
  };
  const match = Object.entries(known).find(([key]) => message.includes(key));
  return match
    ? noStore({ error: match[1][1] }, match[1][0])
    : noStore(
        {
          error:
            "Не удалось выполнить действие. Данные не подтверждены — обновите список",
        },
        500,
      );
}
export async function manager(request: NextRequest) {
  const actor = await getServerActorFromSession(request, {
    ignoreImpersonation: true,
    skipCache: true,
  });
  if (!["agronomist", "company_admin", "global_admin", "fleet_manager"].includes(actor.role))
    throw new TrafficError("Доступ только агроному, заведующему автопарком и администратору", 403);
  const companyId = resolveCompanyForActor(actor);
  await assertActorAccess({
    supabase: getServiceClient(),
    actorUserId: actor.id,
    companyId,
    allowedRoles: ["agronomist", "company_admin", "global_admin", "fleet_manager"],
  });
  return { actor, companyId };
}
export async function dashboardAgronomist(request: NextRequest) {
  const actor = await getServerActorFromSession(request, {
    skipCache: true,
  });
  if (actor.role !== "agronomist")
    throw new TrafficError("Итоги смен доступны только агроному", 403);
  const companyId = resolveCompanyForActor(actor);
  await assertActorAccess({
    supabase: getServiceClient(),
    actorUserId: actor.id,
    companyId,
    allowedRoles: ["agronomist"],
  });
  return { actor, companyId };
}
export async function fleetManager(request: NextRequest) {
  const actor = await getServerActorFromSession(request, {
    ignoreImpersonation: true,
    skipCache: true,
  });
  if (actor.role !== "fleet_manager")
    throw new TrafficError("Управление оборотом доступно только заведующему автопарком", 403);
  const companyId = resolveCompanyForActor(actor);
  await assertActorAccess({
    supabase: getServiceClient(),
    actorUserId: actor.id,
    companyId,
    allowedRoles: ["fleet_manager"],
  });
  return { actor, companyId };
}
export async function operator(request: NextRequest) {
  const actor = await getServerActorFromSession(request, {
    ignoreImpersonation: true,
    skipCache: true,
  });
  if (actor.id !== actor.authUserId)
    throw new TrafficError(
      "Учётная запись требует проверки администратором",
      403,
    );
  const companyId = resolveCompanyForActor(actor);
  const db = getServiceClient();
  // Both fresh checks depend only on the verified identity, not on one another.
  // Keep their predicates and validation even though the transition RPC rechecks them.
  const [profileResult, personResult] = await Promise.all([
    db
      .from("profiles")
      .select("id,full_name,role,status,company_id")
      .eq("id", actor.id)
      .eq("company_id", companyId)
      .maybeSingle(),
    db
      .from("company_people")
      .select("id,full_name")
      .eq("user_id", actor.id)
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(2),
  ]);
  const { data: profile, error } = profileResult;
  if (error) throw error;
  const role =
    profile?.status === "active" ? operatorRole(String(profile.role)) : null;
  if (!role)
    throw new TrafficError(
      "Кабинет доступен только комбайнёру, весовщику и бригадиру приёмки с активным аккаунтом",
      403,
    );
  const { data: people, error: personError } = personResult;
  if (personError) throw personError;
  if (role !== "weighman" && people?.length !== 1)
    throw new TrafficError(
      "Администратор должен связать аккаунт с одним действующим сотрудником Вашей компании",
      403,
    );
  return {
    companyId,
    role,
    personName: role === "weighman"
      ? String(profile?.full_name || "Весовщик")
      : String(people?.[0]?.full_name || ""),
    actorId: actor.id,
  };
}

async function readTrafficAnalyticsEvents(
  db: ReturnType<typeof getServiceClient>,
  companyId: string,
  startedAt: string,
  endedAt: string,
): Promise<TrafficAnalyticsEvent[]> {
  const rows: TrafficAnalyticsEvent[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await db
      .from("ptc_events")
      .select("id,vehicle_id,from_state,to_state,cycle,created_at")
      .eq("company_id", companyId)
      .gte("created_at", startedAt)
      .lte("created_at", endedAt)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = (result.data ?? []) as Array<TrafficAnalyticsEvent & { id: string }>;
    rows.push(...page.map(({ vehicle_id, from_state, to_state, cycle, created_at }) => ({
      vehicle_id,
      from_state,
      to_state,
      cycle,
      created_at,
    })));
    if (page.length < pageSize) return rows;
  }
}

const LIVE_ANALYTICS_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

type CombineStatusRow = {
  operator_user_id: string;
  operator_name: string;
  is_broken: boolean;
  version: number;
  changed_at: string;
};

export async function readSnapshot(
  companyId: string,
  role: TrafficRole,
  personName: string,
  includeEvents = role === "manager",
  actorId?: string,
  includeAnalytics = false,
): Promise<TrafficSnapshot> {
  const db = getServiceClient();
  const results = await Promise.all([
    db
      .from("ptc_flows")
      .select("enabled,field_id,updated_at")
      .eq("company_id", companyId)
      .maybeSingle(),
    db
      .from("ptc_vehicle_states")
      .select("vehicle_id,state,version,since,cycle,assigned")
      .eq("company_id", companyId)
      .eq("assigned", true),
    role === "manager" && includeEvents
      ? db
          .from("ptc_events")
          .select(
            "id,vehicle_id,from_state,to_state,created_at,actor_name,field_id",
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    role === "weighman"
      ? Promise.resolve({ data: null, error: null })
      : db
          .from("ptc_last_vehicle_markers")
          .select("vehicle_id,marked_at,version")
          .eq("company_id", companyId)
          .maybeSingle(),
    role === "harvester" && actorId
      ? db
          .from("ptc_combine_shifts")
          .select("id,operator_name,opened_at,closed_at,hectares_shift,hectares_field_total")
          .eq("company_id", companyId)
          .eq("operator_user_id", actorId)
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : role === "manager" && includeAnalytics
        ? db
            .from("ptc_combine_shifts")
            .select("id,operator_name,opened_at,closed_at,hectares_shift,hectares_field_total")
            .eq("company_id", companyId)
            .is("closed_at", null)
            // Several combine operators may have concurrent open shifts. The
            // manager view is company-wide, so its window must include all of them.
            .order("opened_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    db
      .from("ptc_combine_operator_statuses")
      .select("operator_user_id,operator_name,is_broken,version,changed_at")
      .eq("company_id", companyId)
      .order("changed_at", { ascending: false })
      .order("operator_user_id", { ascending: true }),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const flow = results[0].data as {
    enabled: boolean;
    field_id: string | null;
    updated_at: string;
  } | null;
  const states = (results[1].data ?? []) as Array<
    Pick<
      TrafficVehicle,
      "vehicle_id" | "state" | "version" | "since" | "cycle" | "assigned"
    >
  >;
  const history = (results[2].data ?? []) as Array<
    Omit<
      TrafficSnapshot["events"][number],
      "field_name" | "vehicle_name" | "vehicle_plate" | "vehicle_brand" | "vehicle_driver"
    >
  >;
  const marker = results[3].data as {
    vehicle_id: string;
    marked_at: string;
    version: number;
  } | null;
  const shiftRow = results[4].data as {
    id: string;
    operator_name: string;
    opened_at: string;
    closed_at: string | null;
    hectares_shift: number | string | null;
    hectares_field_total: number | string | null;
  } | null;
  const combineShift = shiftRow ? {
    id: shiftRow.id,
    operatorName: shiftRow.operator_name,
    openedAt: shiftRow.opened_at,
    closedAt: shiftRow.closed_at,
    hectaresShift: shiftRow.hectares_shift === null ? null : Number(shiftRow.hectares_shift),
    hectaresFieldTotal: shiftRow.hectares_field_total === null ? null : Number(shiftRow.hectares_field_total),
    status: shiftRow.closed_at === null ? "open" as const : "closed" as const,
  } : null;
  const combineStatusRows = (results[5].data ?? []) as CombineStatusRow[];
  const combineBreakdowns = combineStatusRows
    .filter((status) => status.is_broken)
    .map((status) => ({
      operatorUserId: status.operator_user_id,
      operatorName: status.operator_name,
      changedAt: status.changed_at,
      version: status.version,
    }));
  const ownStatusRow = role === "harvester" && actorId
    ? combineStatusRows.find((status) => status.operator_user_id === actorId)
    : undefined;
  const ownCombineStatus = role === "harvester" && actorId
    ? ownStatusRow
      ? {
          operatorUserId: ownStatusRow.operator_user_id,
          operatorName: ownStatusRow.operator_name,
          isBroken: ownStatusRow.is_broken,
          changedAt: ownStatusRow.changed_at,
          version: ownStatusRow.version,
        }
      : {
          operatorUserId: actorId,
          operatorName: personName,
          isBroken: false,
          changedAt: null,
          version: 0,
        }
    : null;
  const serverTime = new Date().toISOString();
  const rollingStartedAt = new Date(Date.parse(serverTime) - 12 * 60 * 60 * 1000).toISOString();
  const liveWindowFloor = new Date(Date.parse(serverTime) - LIVE_ANALYTICS_MAX_WINDOW_MS).toISOString();
  const analyticsWindowCapped = combineShift?.status === "open" &&
    Date.parse(combineShift.openedAt) < Date.parse(liveWindowFloor);
  const analyticsStartedAt = analyticsWindowCapped
    ? liveWindowFloor
    : combineShift?.openedAt ?? rollingStartedAt;
  const analyticsShift = analyticsWindowCapped && combineShift
    ? { ...combineShift, openedAt: analyticsStartedAt }
    : combineShift;
  const analyticsEventsPromise = role === "manager" && includeAnalytics
    ? readTrafficAnalyticsEvents(
        db,
        companyId,
        analyticsStartedAt,
        combineShift?.closedAt ?? serverTime,
      )
    : Promise.resolve([] as TrafficAnalyticsEvent[]);
  // At most 100 working vehicles plus vehicles in the last 50 manager events.
  // Never load the whole company fleet or lose historical identities on unassignment.
  const vehicleIds = Array.from(
    new Set([
      ...states.map((s) => s.vehicle_id),
      ...history.map((e) => e.vehicle_id),
      ...(marker ? [marker.vehicle_id] : []),
    ]),
  );
  const fleetResultPromise = vehicleIds.length
    ? db
        .from("reference_vehicles")
        .select(
          "id,name,model,brand,license_plate,plate_number,type,fleet_type,import_source,inventory_number,source_raw_name,source_clean_name,source_machine_id,ptc_enabled,primary_responsible_personnel_id,transport_model:transport_model_id(category)",
        )
        .eq("company_id", companyId)
        .in("id", vehicleIds)
    : Promise.resolve({ data: [], error: null });
  const [fleetResult, analyticsEvents] = await Promise.all([
    fleetResultPromise,
    analyticsEventsPromise,
  ]);
  if (fleetResult.error) throw fleetResult.error;
  type FleetRow = {
    id: string;
    name: string | null;
    model: string | null;
    brand: string | null;
    license_plate: string | null;
    plate_number: string | null;
    primary_responsible_personnel_id: string | null;
    type: string | null;
    fleet_type: string | null;
    import_source: string | null;
    inventory_number: string | null;
    source_raw_name: string | null;
    source_clean_name: string | null;
    source_machine_id: string | null;
    ptc_enabled: boolean;
    transport_model: { category?: string | null } | Array<{ category?: string | null }> | null;
  };
  const fleetRows = (fleetResult.data ?? []) as FleetRow[];
  const eligibleFleetRows = fleetRows.filter(isPtcEligibleReferenceVehicle);
  const fleet = new Map(fleetRows.map((v) => [v.id, v]));
  const eligibleVehicleIds = new Set(
    eligibleFleetRows.map((vehicle) => vehicle.id),
  );
  const historicalVehicleIds = new Set(
    fleetRows.filter(isStructurallyPtcReferenceVehicle).map((vehicle) => vehicle.id),
  );
  const repairsPromise = readVehicleRepairs(db, companyId, Array.from(eligibleVehicleIds));
  const driverIds = fleetRows.filter(isStructurallyPtcReferenceVehicle).flatMap((v) =>
    v.primary_responsible_personnel_id
      ? [v.primary_responsible_personnel_id]
      : [],
  );
  const [repairs, driverResult] = await Promise.all([repairsPromise, driverIds.length
    ? db
        .from("reference_specialists")
        .select("id,personnel_type,status,archived,person:person_id(full_name,company_id,role_type,status,deleted_at)")
        .eq("company_id", companyId)
        .in("personnel_type", ["driver", "machine_operator"])
        .eq("status", "active")
        .eq("archived", false)
        .in("id", driverIds)
    : { data: [], error: null }]);
  if (driverResult.error) throw driverResult.error;
  const driverAssignments = new Map(
    (driverResult.data ?? []).map((row: any) => [String(row.id), row] as const),
  );
  const vehicles: TrafficVehicle[] = states.filter((state) =>
    eligibleVehicleIds.has(state.vehicle_id)).map((s) => {
    const vehicle = fleet.get(s.vehicle_id);
    return {
      ...s,
      inRepair: repairs.get(s.vehicle_id)?.inRepair ?? false,
      repairVersion: repairs.get(s.vehicle_id)?.repairVersion ?? 0,
      repairChangedAt: repairs.get(s.vehicle_id)?.changedAt ?? null,
      name:
        vehicle?.name ||
        [vehicle?.brand, vehicle?.model].filter(Boolean).join(" ") ||
        "Машина",
      brand: vehicle?.brand || null,
      plate: vehicle ? ptcVehicleDisplayPlate(vehicle) : null,
      driver: activeAssignedDriverName(
        driverAssignments.get(vehicle?.primary_responsible_personnel_id ?? ""),
        companyId,
        vehicleAllowsMachineOperator(vehicle),
      ),
    };
  });
  return {
    companyId,
    role,
    personName,
    enabled: flow?.enabled ?? false,
    fieldId: flow?.field_id ?? null,
    flowRevision: flow?.updated_at ?? null,
    // Legacy IDs stay intact; PTC no longer reads or displays field information.
    fieldName: null,
    serverTime,
    vehicles: visibleVehicles(vehicles, role),
    lastVehicle: marker ? (() => {
      const current = vehicles.find((vehicle) => vehicle.vehicle_id === marker.vehicle_id);
      if (!current) return null;
      const source = fleet.get(marker.vehicle_id);
      return {
        vehicleId: marker.vehicle_id,
        driver: current.driver,
        brand: source
          ? getFleetVehicleBrand({ name: source.name || "", brand: source.brand })
          : current.brand || current.name,
        plate: current.plate,
        markedAt: marker.marked_at,
        version: marker.version,
      };
    })() : null,
    combineShift,
    combineBreakdowns,
    ownCombineStatus,
    analytics: role === "manager" && includeAnalytics
      ? (() => {
          const result = calculateTrafficAnalytics(
            analyticsEvents,
            serverTime,
            analyticsShift,
            vehicles.filter((vehicle) => !vehicle.inRepair).length,
          );
          return analyticsWindowCapped
            ? { ...result, windowLabel: "Текущая смена · последние 24 часа" }
            : result;
        })()
      : null,
    events: history.filter((event) => historicalVehicleIds.has(event.vehicle_id)).map((event) => {
      const vehicle = fleet.get(event.vehicle_id);
      return {
        ...event,
        field_name: null,
        vehicle_name: vehicle?.name || "Машина",
        vehicle_plate: vehicle ? ptcVehicleDisplayPlate(vehicle) : null,
        vehicle_brand: vehicle?.brand || null,
        vehicle_driver: activeAssignedDriverName(
          driverAssignments.get(vehicle?.primary_responsible_personnel_id ?? ""),
          companyId,
          vehicleAllowsMachineOperator(vehicle),
        ),
      };
    }),
  };
}
