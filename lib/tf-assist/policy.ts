import type { Scope } from "./contracts";
import { previewEnabled, QA_ORIGIN as QA_SOURCE_ORIGIN, sourceOrigin } from "./preview-gate";

export class AssistError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: "AI_UNAVAILABLE",
  ) {
    super(message);
    this.name = "AssistError";
  }
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const QA_ORIGIN = QA_SOURCE_ORIGIN;

export function assertRuntime(env: Record<string, string | undefined>): string {
  if (!previewEnabled(env))
    throw new AssistError("TF Assist ещё не включён.", 404);
  const origin = sourceOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!origin)
    throw new AssistError(
      "Источник данных TF Assist не настроен.",
      503,
    );
  return origin;
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
