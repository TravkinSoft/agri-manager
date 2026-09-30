import type { ServerActorContext } from "@/lib/auth/server-session";
import { SessionAuthError } from "@/lib/auth/server-session";
import { canReadFieldMap, canWriteFieldMap, canMutateFieldMap } from "@/lib/fields-map/access-policy";
export { canReadFieldMap, canWriteFieldMap, canMutateFieldMap } from "@/lib/fields-map/access-policy";

export function assertFieldMapRead(actor: ServerActorContext): void {
  if (!canReadFieldMap(actor.role)) {
    throw new SessionAuthError("Access denied for current role", 403);
  }
}

export function assertFieldMapWrite(actor: ServerActorContext): void {
  if (!canWriteFieldMap(actor.role)) {
    throw new SessionAuthError("Write access denied for current role", 403);
  }
}

export function assertFieldMapMutation(actor: ServerActorContext): void {
  if (!canMutateFieldMap(actor.role) || actor.roleIsLegacyAlias || actor.roleRawKey !== "global_admin") {
    throw new SessionAuthError("Field map mutation requires global_admin", 403);
  }
}
