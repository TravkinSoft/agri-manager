import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { parseCanonicalRole } from "@/lib/auth/role-contract";
import {
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
  SessionAuthError,
} from "@/lib/auth/server-session";
import { requireWeighbridgeOperatorSession } from "@/app/api/weighbridge/_auth";
import { ptcVehicleDisplayPlate } from "@/lib/traffic/vehicle-eligibility";
import { vehicleAllowsMachineOperator } from "@/lib/vehicles/driver-name";

const writeRoles = ["global_admin", "company_admin", "agronomist", "weighman", "fleet_manager"] as const;
const readRoles = [...writeRoles, "director", "warehouse", "warehouse_operator", "specialist"] as const;
export const assignmentQuery = z.object({
  companyId: z.string().uuid().optional(),
  vehicleId: z.string().uuid(),
}).strict();
export const assignmentCommand = assignmentQuery.extend({
  driverPersonId: z.string().uuid().nullable(),
  expectedAssignmentId: z.string().uuid().nullable(),
}).strict();
const vehicleColumns = "id,name,brand,model,license_plate,plate_number,type,fleet_type,source_machine_id,primary_responsible_personnel_id";
type Db = ReturnType<typeof getServiceClient>;
type VehicleRow = {
  id: string;
  name: string | null;
  brand: string | null;
  model: string | null;
  license_plate: string | null;
  plate_number: string | null;
  type: string | null;
  fleet_type: string | null;
  source_machine_id: string | null;
  primary_responsible_personnel_id: string | null;
};
type Person = { id: string; full_name: string; role_type: "driver" | "mechanic_operator" };
type Specialist = { id: string; person_id: string | null; personnel_type: string; status: string };
type Context = { db: Db; companyId: string; creatorAuthUserId: string; canEdit: boolean };

export function assignmentResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private", Vary: "Cookie, Authorization" },
  });
}
export function assignmentFailure(error: unknown) {
  if (error instanceof SessionAuthError)
    return assignmentResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return assignmentResponse({ error: "Проверьте машину и выбранного водителя" }, 400);
  // Never expose service-role/PostgREST error details to a client.
  return assignmentResponse({ error: "Не удалось подтвердить закрепление. Обновите данные и повторите." }, 500);
}
export function assignmentSameOrigin(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin ||
      request.headers.get("sec-fetch-site") === "cross-site")
    throw new SessionAuthError("Запрос с другого сайта запрещён", 403);
}
export async function assignmentContext(request: NextRequest, companyId: string | undefined, write: boolean): Promise<Context> {
  // Never let an impersonated role or a cached profile authorize a fleet write.
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });
  const selectedCompany = resolveCompanyForActor(actor, companyId);
  const db = getServiceClient();
  const profile = await assertActorAccess({
    supabase: db, actorUserId: actor.id, companyId: selectedCompany,
    allowedRoles: [...(write ? writeRoles : readRoles)],
  });
  const role = parseCanonicalRole(profile.role);
  if (profile.status !== "active" || role !== actor.role ||
      (role !== "global_admin" && profile.company_id !== selectedCompany))
    throw new SessionAuthError("Права доступа изменились. Войдите заново", 403);
  const canEdit = writeRoles.some(allowed => allowed === role);
  if (write && role === "weighman") {
    const supabase = await getUserScopedClientFromRequest(request);
    await requireWeighbridgeOperatorSession(request, { companyId: selectedCompany, supabase });
  }
  return { db, companyId: selectedCompany, creatorAuthUserId: actor.authUserId, canEdit };
}
async function vehicleRow(context: Context, id: string): Promise<VehicleRow> {
  const result = await context.db.from("reference_vehicles").select(vehicleColumns)
    .eq("company_id", context.companyId).eq("id", id).eq("archived", false).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new SessionAuthError("Машина недоступна в выбранной компании", 404);
  return result.data as VehicleRow;
}
async function activePerson(context: Context, id: string, allowMachineOperator: boolean): Promise<Person | null> {
  const result = await context.db.from("company_people").select("id,full_name,role_type")
    .eq("company_id", context.companyId).eq("id", id)
    .eq("status", "active").is("deleted_at", null).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || (result.data.role_type !== "driver" &&
      !(allowMachineOperator && result.data.role_type === "mechanic_operator"))) return null;
  return result.data as Person;
}
function specialistType(person: Person) {
  return person.role_type === "mechanic_operator" ? "machine_operator" : "driver";
}
async function assignedPerson(
  context: Context,
  assignmentId: string | null,
  allowMachineOperator: boolean,
): Promise<Person | null> {
  if (!assignmentId) return null;
  const result = await context.db.from("reference_specialists").select("id,person_id,personnel_type")
    .eq("company_id", context.companyId).eq("id", assignmentId)
    .eq("status", "active").eq("archived", false).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data?.person_id) return null;
  const person = await activePerson(context, result.data.person_id, allowMachineOperator);
  return person && result.data.personnel_type === specialistType(person) ? person : null;
}
function presentVehicle(row: VehicleRow, person: Person | null) {
  return {
    id: row.id,
    name: row.name || [row.brand, row.model].filter(Boolean).join(" ") || "Машина",
    plate: ptcVehicleDisplayPlate(row),
    // Preserve opaque legacy/invalid IDs for CAS without presenting them as a current driver.
    assignmentId: row.primary_responsible_personnel_id,
    driverPersonId: person?.id ?? null,
    driverName: person?.full_name ?? null,
    driverRoleType: person?.role_type ?? null,
  };
}
export async function readDriverAssignment(context: Context, id: string) {
  const row = await vehicleRow(context, id);
  const allowMachineOperator = vehicleAllowsMachineOperator(row);
  let driversQuery = context.db.from("company_people").select("id,full_name,role_type")
    .eq("company_id", context.companyId)
    .eq("status", "active").is("deleted_at", null);
  driversQuery = allowMachineOperator
    ? driversQuery.in("role_type", ["driver", "mechanic_operator"])
    : driversQuery.eq("role_type", "driver");
  const [person, drivers] = await Promise.all([
    assignedPerson(context, row.primary_responsible_personnel_id, allowMachineOperator),
    driversQuery.order("full_name", { ascending: true }),
  ]);
  if (drivers.error) throw drivers.error;
  return {
    companyId: context.companyId, vehicle: presentVehicle(row, person), canEdit: context.canEdit,
    drivers: ((drivers.data ?? []) as Person[]).map(driver => ({ id: driver.id, name: driver.full_name })),
  };
}
async function liveSpecialist(context: Context, person: Person): Promise<Specialist | null> {
  const result = await context.db.from("reference_specialists")
    .select("id,person_id,personnel_type,status").eq("company_id", context.companyId)
    .eq("person_id", person.id).eq("archived", false).maybeSingle();
  if (result.error) throw result.error;
  if (result.data && (result.data.personnel_type !== specialistType(person) || result.data.status !== "active"))
    throw new SessionAuthError("Карточка водителя неактивна. Проверьте её в справочнике", 409);
  return result.data as Specialist | null;
}
async function ensureSpecialist(context: Context, person: Person): Promise<string> {
  const existing = await liveSpecialist(context, person);
  if (existing) return existing.id;
  // Compatibility FK: only this exact canonical person. Never match names or create people.
  // ux_reference_specialists_person_live is a unique partial index on person_id.
  const personnelType = specialistType(person);
  const inserted = await context.db.from("reference_specialists").insert({
    company_id: context.companyId, user_id: context.creatorAuthUserId, person_id: person.id,
    full_name: person.full_name,
    role: person.role_type === "mechanic_operator" ? "mechanic_operator" : "driver",
    personnel_type: personnelType, status: "active", archived: false,
  }).select("id").single();
  if (!inserted.error && inserted.data?.id) return inserted.data.id;
  if (inserted.error?.code !== "23505") throw inserted.error ?? new Error("Missing inserted driver");
  const winner = await liveSpecialist(context, person);
  if (!winner) throw new SessionAuthError("Связь водителя изменилась. Обновите данные", 409);
  return winner.id;
}
export async function saveDriverAssignment(context: Context, input: z.infer<typeof assignmentCommand>) {
  if (!context.canEdit) throw new SessionAuthError("Нет права менять водителя", 403);
  const row = await vehicleRow(context, input.vehicleId);
  const allowMachineOperator = vehicleAllowsMachineOperator(row);
  const person = input.driverPersonId
    ? await activePerson(context, input.driverPersonId, allowMachineOperator)
    : null;
  if (input.driverPersonId && !person)
    throw new SessionAuthError("Выберите действующего водителя этой компании", 400);
  const currentPerson = await assignedPerson(
    context,
    row.primary_responsible_personnel_id,
    allowMachineOperator,
  );
  const isDesired = (candidate: VehicleRow, candidatePerson: Person | null) => input.driverPersonId
    ? candidatePerson?.id === input.driverPersonId
    : candidate.primary_responsible_personnel_id === null;
  const result = (candidate: VehicleRow, candidatePerson: Person | null) => ({
    companyId: context.companyId, vehicle: presentVehicle(candidate, candidatePerson), canEdit: context.canEdit,
  });
  // A lost response can be retried safely; do not write a second time or clear another vehicle.
  if (isDesired(row, currentPerson)) return result(row, currentPerson);
  if (row.primary_responsible_personnel_id !== input.expectedAssignmentId)
    throw new SessionAuthError("Водителя уже изменили. Обновите данные и проверьте машину", 409);
  const nextId = person ? await ensureSpecialist(context, person) : null;
  // Recheck the canonical driver's active state before the CAS, including a lazy-link race.
  const checkedPerson = person ? await activePerson(context, person.id, allowMachineOperator) : null;
  if (person && !checkedPerson) throw new SessionAuthError("Водитель больше не активен", 409);
  if (person && (await liveSpecialist(context, person))?.id !== nextId)
    throw new SessionAuthError("Связь водителя изменилась. Обновите данные", 409);
  let update = context.db.from("reference_vehicles")
    .update({ primary_responsible_personnel_id: nextId })
    .eq("company_id", context.companyId).eq("id", input.vehicleId).eq("archived", false);
  update = input.expectedAssignmentId === null
    ? update.is("primary_responsible_personnel_id", null)
    : update.eq("primary_responsible_personnel_id", input.expectedAssignmentId);
  const saved = await update.select(vehicleColumns).maybeSingle();
  if (saved.error) throw saved.error;
  if (saved.data) return result(saved.data as VehicleRow, checkedPerson);
  // Zero affected rows is a conflict, not success. Only the same desired assignment is an idempotent win.
  const concurrent = await vehicleRow(context, input.vehicleId);
  const concurrentPerson = await assignedPerson(
    context,
    concurrent.primary_responsible_personnel_id,
    vehicleAllowsMachineOperator(concurrent),
  );
  if (isDesired(concurrent, concurrentPerson)) return result(concurrent, concurrentPerson);
  throw new SessionAuthError("Водителя уже изменили. Обновите данные и проверьте машину", 409);
}
