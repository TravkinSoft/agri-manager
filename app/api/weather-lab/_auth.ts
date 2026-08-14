import type { NextRequest } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export async function requireWeatherLabAccess(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (actor.role !== "global_admin" && actor.role !== "agronomist") {
    throw new SessionAuthError("Weather Lab доступен Global Admin и агроному", 403);
  }
  return actor;
}
