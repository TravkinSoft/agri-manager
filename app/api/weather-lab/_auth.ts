import type { NextRequest } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export async function requireWeatherLabAccess(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (!["global_admin", "agronomist", "director"].includes(actor.role)) {
    throw new SessionAuthError("Weather Lab недоступен для текущей роли", 403);
  }
  if (actor.role === "director" && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    throw new SessionAuthError("Директору доступен только просмотр погоды", 403);
  }
  return actor;
}
