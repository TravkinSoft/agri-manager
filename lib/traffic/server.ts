import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  getServerActorFromSession,
  resolveCompanyForActor,
  SessionAuthError,
} from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  visibleVehicles,
  operatorRole,
  type TrafficRole,
  type TrafficSnapshot,
  type TrafficVehicle,
} from "./model";

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
    PTC_FORBIDDEN_TRANSITION: [403, "Этот переход недоступен в Вашем кабинете"],
    PTC_ACTIVE_VEHICLE: [409, "Сначала завершите оборот занятых машин"],
    PTC_ACTIVE_FIELD: [
      409,
      "Поле можно изменить после возвращения всех машин в состояние «Пустая»",
    ],
    PTC_INACTIVE_VEHICLE: [409, "Выберите действующие машины компании"],
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
  if (!["agronomist", "company_admin", "global_admin"].includes(actor.role))
    throw new TrafficError("Доступ только агроному и администратору", 403);
  const companyId = resolveCompanyForActor(actor);
  await assertActorAccess({
    supabase: getServiceClient(),
    actorUserId: actor.id,
    companyId,
    allowedRoles: ["agronomist", "company_admin", "global_admin"],
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
  const { data: profile, error } = await db
    .from("profiles")
    .select("id,role,status,company_id")
    .eq("id", actor.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  const role =
    profile?.status === "active" ? operatorRole(String(profile.role)) : null;
  if (!role)
    throw new TrafficError(
      "Кабинет доступен только механизатору и бригадиру овощной бригады с активным аккаунтом",
      403,
    );
  const { data: people, error: personError } = await db
    .from("company_people")
    .select("id,full_name")
    .eq("user_id", actor.id)
    .eq("company_id", companyId)
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(2);
  if (personError) throw personError;
  if (people?.length !== 1)
    throw new TrafficError(
      "Администратор должен связать аккаунт с одним действующим сотрудником Вашей компании",
      403,
    );
  return {
    companyId,
    role,
    personName: String(people[0].full_name),
    actorId: actor.id,
  };
}
export async function readSnapshot(
  companyId: string,
  role: TrafficRole,
  personName: string,
): Promise<TrafficSnapshot> {
  const db = getServiceClient();
  const results = await Promise.all([
    db
      .from("ptc_flows")
      .select("enabled,field_id")
      .eq("company_id", companyId)
      .maybeSingle(),
    db
      .from("ptc_vehicle_states")
      .select("vehicle_id,state,version,since,cycle,assigned")
      .eq("company_id", companyId)
      .eq("assigned", true),
    role === "manager"
      ? db
          .from("ptc_events")
          .select(
            "id,vehicle_id,from_state,to_state,created_at,actor_name,field_id",
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const flow = results[0].data as {
    enabled: boolean;
    field_id: string | null;
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
      "field_name" | "vehicle_name" | "vehicle_plate"
    >
  >;
  // At most 100 working vehicles plus vehicles in the last 50 manager events.
  // Never load the whole company fleet or lose historical identities on unassignment.
  const vehicleIds = Array.from(
    new Set([
      ...states.map((s) => s.vehicle_id),
      ...history.map((e) => e.vehicle_id),
    ]),
  );
  const fleetResult = vehicleIds.length
    ? await db
        .from("reference_vehicles")
        .select(
          "id,name,model,brand,license_plate,plate_number,primary_responsible_personnel_id",
        )
        .eq("company_id", companyId)
        .in("id", vehicleIds)
    : { data: [], error: null };
  if (fleetResult.error) throw fleetResult.error;
  type FleetRow = {
    id: string;
    name: string | null;
    model: string | null;
    brand: string | null;
    license_plate: string | null;
    plate_number: string | null;
    primary_responsible_personnel_id: string | null;
  };
  const fleetRows = (fleetResult.data ?? []) as FleetRow[];
  const fleet = new Map(fleetRows.map((v) => [v.id, v]));
  const driverIds = fleetRows.flatMap((v) =>
    v.primary_responsible_personnel_id
      ? [v.primary_responsible_personnel_id]
      : [],
  );
  const driverResult = driverIds.length
    ? await db
        .from("reference_specialists")
        .select("id,full_name")
        .eq("company_id", companyId)
        .eq("personnel_type", "driver")
        .eq("status", "active")
        .eq("archived", false)
        .in("id", driverIds)
    : { data: [], error: null };
  if (driverResult.error) throw driverResult.error;
  const drivers = new Map(
    ((driverResult.data ?? []) as Array<{ id: string; full_name: string }>).map(
      (p) => [p.id, p.full_name],
    ),
  );
  const vehicles: TrafficVehicle[] = states.map((s) => {
    const vehicle = fleet.get(s.vehicle_id);
    return {
      ...s,
      name:
        vehicle?.name ||
        [vehicle?.brand, vehicle?.model].filter(Boolean).join(" ") ||
        "Машина",
      plate: vehicle?.license_plate || vehicle?.plate_number || null,
      driver:
        drivers.get(vehicle?.primary_responsible_personnel_id ?? "") || null,
    };
  });
  return {
    role,
    personName,
    enabled: flow?.enabled ?? false,
    fieldId: flow?.field_id ?? null,
    // Legacy IDs stay intact; PTC no longer reads or displays field information.
    fieldName: null,
    serverTime: new Date().toISOString(),
    vehicles: visibleVehicles(vehicles, role),
    events: history.map((event) => ({
      ...event,
      field_name: null,
      vehicle_name: fleet.get(event.vehicle_id)?.name || "Машина",
      vehicle_plate:
        fleet.get(event.vehicle_id)?.license_plate ||
        fleet.get(event.vehicle_id)?.plate_number ||
        null,
    })),
  };
}
