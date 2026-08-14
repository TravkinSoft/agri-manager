import type { NextRequest } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export async function requireWeatherLabAdmin(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (actor.role !== "global_admin") {
    throw new SessionAuthError("Weather Lab доступен только Global Admin", 403);
  }
  return actor;
}
