import type { Scope } from "./contracts";

export class AssistError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AssistError";
  }
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const QA_ORIGIN = "https://gsglkmudcwkdetqtocae.supabase.co";

export function assertRuntime(env: Record<string, string | undefined>): void {
  if (env.TF_ASSIST_HARVEST_V1 !== "1" || env.VERCEL_ENV === "production")
    throw new AssistError("TF Assist ещё не включён.", 404);
  if (env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== QA_ORIGIN)
    throw new AssistError(
      "TF Assist разрешён только в проверенном QA окружении.",
      503,
    );
}

export function authorize(
  actor: {
    id: string;
    role: string;
    status: string | null;
    isImpersonating: boolean;
    roleIsLegacyAlias: boolean;
    contextCompanyId: string | null;
  },
  companyId: string,
): Scope {
  if (
    actor.role !== "global_admin" ||
    actor.status !== "active" ||
    actor.isImpersonating ||
    actor.roleIsLegacyAlias
  )
    throw new AssistError(
      "Доступен только Global Admin без impersonation.",
      403,
    );
  if (!UUID.test(companyId) || !actor.contextCompanyId)
    throw new AssistError("Выберите компанию в верхней панели.", 400);
  if (companyId !== actor.contextCompanyId)
    throw new AssistError(
      "Контекст компании изменился. Повторите вопрос.",
      409,
    );
  return { userId: actor.id, companyId };
}

export function sameScope(a: Scope, b: Scope): void {
  if (a.userId !== b.userId || a.companyId !== b.companyId)
    throw new AssistError(
      "Контекст изменился во время чтения. Повторите вопрос.",
      409,
    );
}
