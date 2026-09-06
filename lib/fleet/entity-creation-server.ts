import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  getServerActorFromSession,
  resolveCompanyForActor,
  SessionAuthError,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import {
  findDriverDuplicates,
  findVehicleDuplicates,
  fleetEntityCreateCommand,
  uniqueTopCandidates,
  type DriverDuplicateSource,
  type FleetDuplicateCandidate,
  type FleetEntityCreateCommand,
  type VehicleDuplicateSource,
} from "./entity-creation";

type Db = ReturnType<typeof getServiceClient>;
type CreateContext = { db: Db; actorId: string; companyId: string };

class FleetEntityDuplicateError extends Error {
  constructor(
    public readonly code: "exact_duplicate" | "potential_duplicate",
    public readonly candidates: FleetDuplicateCandidate[],
  ) {
    super(code === "exact_duplicate"
      ? "Такая запись уже есть — новый дубль не создан"
      : "Нашлись похожие записи. Проверьте их перед созданием");
  }
}

export function fleetEntityResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private", Vary: "Cookie, Authorization" },
  });
}

export function fleetEntityFailure(error: unknown) {
  if (error instanceof FleetEntityDuplicateError) {
    return fleetEntityResponse({ error: error.message, code: error.code, candidates: error.candidates }, 409);
  }
  if (error instanceof SessionAuthError) return fleetEntityResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError) {
    return fleetEntityResponse({ error: error.issues[0]?.message || "Проверьте введённые данные" }, 400);
  }
  if (error instanceof SyntaxError) return fleetEntityResponse({ error: "Проверьте введённые данные" }, 400);
  return fleetEntityResponse({ error: "Не удалось создать запись. Обновите данные и повторите." }, 500);
}

export function fleetEntitySameOrigin(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    throw new SessionAuthError("Запрос с другого сайта запрещён", 403);
  }
}

async function createContext(request: NextRequest, requestedCompany?: string): Promise<CreateContext> {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });
  if (!["fleet_manager", "company_admin", "global_admin"].includes(actor.role)) {
    throw new SessionAuthError("Создавать машины и водителей может заведующий автопарком или администратор", 403);
  }
  const companyId = resolveCompanyForActor(actor, requestedCompany);
  const db = getServiceClient();
  const profile = await assertActorAccess({
    supabase: db,
    actorUserId: actor.id,
    companyId,
    allowedRoles: ["fleet_manager", "company_admin", "global_admin"],
  });
  if (profile.status !== "active" || profile.role !== actor.role ||
      (actor.role !== "global_admin" && profile.company_id !== companyId)) {
    throw new SessionAuthError("Права доступа изменились. Войдите заново", 403);
  }
  return { db, actorId: actor.id, companyId };
}

async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await build(from, from + 499);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

async function vehicleDuplicates(context: CreateContext, input: Extract<FleetEntityCreateCommand, { kind: "vehicle" }>) {
  const rows = await allRows<VehicleDuplicateSource>((from, to) => context.db
    .from("reference_vehicles")
    .select("id,name,full_name,plate_number,license_plate")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .order("id")
    .range(from, to));
  return uniqueTopCandidates(findVehicleDuplicates(input, rows));
}

async function driverDuplicates(context: CreateContext, input: Extract<FleetEntityCreateCommand, { kind: "driver" }>) {
  const [people, specialists] = await Promise.all([
    allRows<DriverDuplicateSource>((from, to) => context.db
      .from("company_people")
      .select("id,full_name")
      .eq("company_id", context.companyId)
      .is("deleted_at", null)
      .order("id")
      .range(from, to)),
    allRows<DriverDuplicateSource & { person_id: string | null }>((from, to) => context.db
      .from("reference_specialists")
      .select("id,full_name,person_id")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("id")
      .range(from, to)),
  ]);
  const canonicalIds = new Set(people.map(person => person.id));
  const legacyOnly = specialists.filter(specialist => !specialist.person_id || !canonicalIds.has(specialist.person_id));
  return uniqueTopCandidates(findDriverDuplicates(input.fullName, [...people, ...legacyOnly]));
}

async function currentDuplicates(context: CreateContext, input: FleetEntityCreateCommand) {
  return input.kind === "vehicle"
    ? vehicleDuplicates(context, input)
    : driverDuplicates(context, input);
}

const rpcResultSchema = z.object({
  status: z.enum(["created", "duplicate"]),
  kind: z.enum(["vehicle", "driver"]),
  entity: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    plate: z.string().nullable().optional(),
  }).optional(),
}).strict();

export async function createFleetEntity(request: NextRequest) {
  const input = fleetEntityCreateCommand.parse(await request.json());
  const context = await createContext(request, input.companyId);
  const candidates = await currentDuplicates(context, input);
  const exact = candidates.filter(candidate => candidate.level === "exact");
  if (exact.length) throw new FleetEntityDuplicateError("exact_duplicate", exact);
  if (candidates.length && !input.confirmPotentialDuplicate) {
    throw new FleetEntityDuplicateError("potential_duplicate", candidates);
  }

  const { data, error } = await context.db.rpc("fleet_create_entity_v1", {
    p_actor: context.actorId,
    p_company: context.companyId,
    p_kind: input.kind,
    p_name: input.kind === "vehicle" ? input.name : input.fullName,
    p_plate: input.kind === "vehicle" ? input.plate : null,
  });
  if (error) {
    const message = String(error.message || "");
    if (message.includes("FORBIDDEN")) throw new SessionAuthError("Нет права создавать записи автопарка", 403);
    if (message.includes("INPUT_INVALID") || message.includes("KIND_INVALID")) {
      throw new SessionAuthError("Проверьте введённые данные", 400);
    }
    if (message.includes("COMPATIBILITY_CONFLICT") || String(error.code || "") === "23505") {
      const refreshed = await currentDuplicates(context, input);
      throw new FleetEntityDuplicateError("exact_duplicate", refreshed.filter(candidate => candidate.level === "exact"));
    }
    throw error;
  }
  const result = rpcResultSchema.parse(data);
  if (result.kind !== input.kind) throw new Error("Unexpected fleet entity kind");
  if (result.status === "duplicate") {
    const refreshed = await currentDuplicates(context, input);
    const exactNow = refreshed.filter(candidate => candidate.level === "exact");
    throw new FleetEntityDuplicateError("exact_duplicate", exactNow.length ? exactNow : refreshed);
  }
  if (!result.entity) throw new Error("Missing created fleet entity");
  return { companyId: context.companyId, kind: result.kind, created: result.entity };
}
