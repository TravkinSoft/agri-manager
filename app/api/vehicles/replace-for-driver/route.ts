import type { NextRequest } from "next/server";
import { z } from "zod";
import { assignmentContext, assignmentResponse, assignmentSameOrigin } from "@/lib/vehicles/driver-assignment-server";
import { SessionAuthError } from "@/lib/auth/server-session";
import { isPtcEligibleReferenceVehicle, ptcVehicleDisplayPlate } from "@/lib/traffic/vehicle-eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const query = z.object({ companyId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional(), driverId: z.string().uuid().optional() })
  .strict().refine(value => Boolean(value.vehicleId || value.driverId));
const command = z.object({ companyId: z.string().uuid(), driverId: z.string().uuid(), sourceVehicleId: z.string().uuid(),
  vehicleId: z.string().uuid(), sourceVersion: z.number().int().nonnegative(), targetVersion: z.number().int().nonnegative(),
  sourceAssignmentId: z.string().uuid().nullable(), targetAssignmentId: z.string().uuid().nullable(), key: z.string().uuid(),
}).strict();
function failure(error: unknown) {
  if (error instanceof SessionAuthError) return assignmentResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return assignmentResponse({ error: "Проверьте выбранную машину" }, 400);
  const message = error instanceof Error ? error.message : "";
  const known: Record<string, string> = {
    PTC_REPLACE_FORBIDDEN: "Нет прав менять машину этого водителя",
    PTC_REPLACE_INVALID: "Выберите действующую машину из ПТС",
    PTC_DISABLED: "Оборот машин приостановлен",
    PTC_REPLACE_TARGET_BUSY: "Машина занята или на ремонте. Выберите машину вне линии",
    PTC_REPLACE_DRIVER_CHANGED: "Водитель или его машина уже изменились. Обновите данные",
    PTC_REPLACE_TICKET_CONFLICT: "Открытый талон не совпадает с текущим рейсом. Замена не выполнена",
    PTC_REPLACE_CONFLICT: "Статус или закрепление изменились. Откройте выбор заново",
    PTC_REPLACE_BUSY: "Сейчас обрабатывается талон этой машины. Повторите после завершения",
    PTC_KEY_CONFLICT: "Подтверждение уже использовано. Откройте выбор заново",
  };
  const match = Object.keys(known).find(key => message.includes(key));
  return assignmentResponse({ error: match ? known[match] : "Замена не подтверждена. Обновите данные и проверьте машину" }, match ? 409 : 500);
}
export async function GET(request: NextRequest) {
  try {
    const input = query.parse(Object.fromEntries(request.nextUrl.searchParams));
    const ctx = await assignmentContext(request, input.companyId, false);
    if (!ctx.canEdit) throw new SessionAuthError("Нет прав менять машину водителя", 403);
    const [vehicles, states, specialists, people, repairs, tickets] = await Promise.all([
      ctx.db.from("reference_vehicles").select("id,name,brand,model,license_plate,plate_number,source_machine_id,type,fleet_type,ptc_enabled,import_source,inventory_number,source_raw_name,source_clean_name,primary_responsible_personnel_id")
        .eq("company_id", ctx.companyId).eq("archived", false).eq("is_active", true),
      ctx.db.from("ptc_vehicle_states").select("vehicle_id,assigned,state,version,cycle").eq("company_id", ctx.companyId),
      ctx.db.from("reference_specialists").select("id,person_id").eq("company_id", ctx.companyId).eq("archived", false).eq("status", "active"),
      ctx.db.from("company_people").select("id,full_name").eq("company_id", ctx.companyId).eq("status", "active").is("deleted_at", null),
      ctx.db.from("fleet_vehicle_repairs").select("vehicle_id").eq("company_id", ctx.companyId).eq("in_repair", true),
      ctx.db.from("tickets").select("vehicle_id").eq("company_id", ctx.companyId).eq("is_finalized", false).eq("is_voided", false).not("status", "in", "(finalized,voided)"),
    ]);
    for (const r of [vehicles, states, specialists, people, repairs, tickets]) if (r.error) throw r.error;
    const stateById = new Map((states.data || []).map(s => [s.vehicle_id, s]));
    const personByAssignment = new Map((specialists.data || []).map(s => [s.id, s.person_id]));
    const personById = new Map((people.data || []).map(p => [p.id, p.full_name]));
    const blocked = new Set([...(repairs.data || []), ...(tickets.data || [])].map(r => r.vehicle_id));
    const rows = (vehicles.data || []).filter(isPtcEligibleReferenceVehicle).map(v => ({
      id: v.id, name: v.name || [v.brand,v.model].filter(Boolean).join(" "), plate: ptcVehicleDisplayPlate(v),
      assignmentId: v.primary_responsible_personnel_id,
      driverId: personByAssignment.get(v.primary_responsible_personnel_id || "") || null,
      driverName: personById.get(personByAssignment.get(v.primary_responsible_personnel_id || "") || "") || null,
      version: stateById.get(v.id)?.version || 0, assigned: stateById.get(v.id)?.assigned || false,
      state: stateById.get(v.id)?.state || "empty",
    }));
    const candidates = rows.filter(v => v.assigned && (!input.vehicleId || v.id === input.vehicleId) && (!input.driverId || v.driverId === input.driverId));
    if (candidates.length !== 1 || !candidates[0].driverId) throw new SessionAuthError("Не найдена одна машина этого водителя на линии. Проверьте ПТС", 409);
    return assignmentResponse({ companyId: ctx.companyId, source: candidates[0],
      targets: rows.filter(v => !v.assigned && v.state === "empty" && !blocked.has(v.id)),
    });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    assignmentSameOrigin(request);
    const input = command.parse(await request.json());
    const ctx = await assignmentContext(request, input.companyId, true);
    const { data, error } = await ctx.db.rpc("ptc_replace_driver_vehicle_v1", {
      p_actor: ctx.actorId, p_company: ctx.companyId, p_driver: input.driverId, p_source: input.sourceVehicleId,
      p_target: input.vehicleId, p_source_version: input.sourceVersion, p_target_version: input.targetVersion,
      p_source_assignment: input.sourceAssignmentId, p_target_assignment: input.targetAssignmentId, p_key: input.key,
    });
    if (error) throw new Error(error.code === "55P03" ? "PTC_REPLACE_BUSY" : error.message);
    return assignmentResponse(data);
  } catch (error) { return failure(error); }
}
