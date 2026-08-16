import type { NextRequest } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export async function requireWeatherLabAccess(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (!(["global_admin", "agronomist", "director"] as const).includes(actor.role as never)) {
    throw new SessionAuthError("Раздел погоды недоступен для этой роли", 403);
  }
  return actor;
}

export function requireWeatherProfileWriteAccess(actor: Awaited<ReturnType<typeof requireWeatherLabAccess>>) {
  if (actor.role !== "global_admin" && actor.role !== "agronomist") {
    throw new SessionAuthError("Изменение погодных профилей недоступно для этой роли", 403);
  }
}
