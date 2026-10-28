import type { NextRequest } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { TrafficError } from "@/lib/traffic/server";
import { SUMMARY_SECTION_ROLES } from "./summary-sections";
import { readCompleteStockRows } from "@/lib/warehouse/complete-read";

export async function summaryAccess(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { skipCache: true });
  if (!SUMMARY_SECTION_ROLES.some(role => role === actor.role)) throw new TrafficError("Нет доступа к сводке", 403);
  const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("companyId"));
  const db = getServiceClient();
  await assertActorAccess({ supabase: db, actorUserId: actor.id, companyId, allowedRoles: [...SUMMARY_SECTION_ROLES] });
  return { actor, companyId, db };
}
export async function summaryRows<T = any>(query: () => any): Promise<T[]> {
  const result = await readCompleteStockRows<T>((from, to) => query().range(from, to));
  if (result.error) throw result.error;
  return result.data || [];
}
export async function summaryChunks<T = any>(ids: string[], query: (ids: string[]) => any): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const result: T[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    result.push(...await summaryRows<T>(() => query(unique.slice(offset, offset + 100))));
  }
  return result;
}
