import { createHash, randomUUID } from "node:crypto";
import { buildAnswer } from "./analysis";
import type { Answer, Intent, Scope, Snapshot } from "./contracts";
import { QuestionSchema, isWriteRequest } from "./question";
import { AssistError, sameScope } from "./policy";
import type { PlanResult } from "./planner";

export type Dependencies = {
  authorize: (companyId: string) => Promise<Scope>;
  load: (companyId: string, intent: Intent) => Promise<Snapshot>;
  audit: (record: Record<string, unknown>) => void;
  plan?: (message: string) => Promise<PlanResult>;
};

export async function answerQuestion(
  input: unknown,
  dependencies: Dependencies,
): Promise<Answer> {
  const question = QuestionSchema.parse(input),
    requestId = randomUUID();
  const scope = await dependencies.authorize(question.companyId);
  const started = Date.now();
  if (isWriteRequest(question.message))
    throw new AssistError(
      "TF Assist не выполняет команды изменения данных.",
      422,
    );
  const plan = dependencies.plan
    ? await dependencies.plan(question.message)
    : undefined;
  if (!plan || plan.state === "unavailable")
    throw new AssistError(
      "AI временно недоступен. Ответ не сформирован; повторите запрос позже.",
      503,
      "AI_UNAVAILABLE",
    );
  const intent = plan.state === "model" ? plan.intent : null;
  if (!intent)
    throw new AssistError(
      "TF Assist читает уборку, партии, склады и ПТЦ. Уточните вопрос; команды изменения данных не выполняются.",
      422,
    );
  let decision = "error";
  try {
    const snapshot = await dependencies.load(scope.companyId, intent);
    const answer = buildAnswer(snapshot, question, intent);
    sameScope(scope, await dependencies.authorize(question.companyId));
    decision = "answered";
    dependencies.audit({
      event: "tf_assist_sources",
      requestId,
      userId: scope.userId,
      companyId: scope.companyId,
      intent,
      planner: plan?.state || "rules",
      plannerCode: plan?.code,
      sources: answer.sourceAudit.map((s) => ({
        table: s.table,
        state: s.state,
        digest: s.digest,
        from: s.startedAt,
        to: s.endedAt,
      })),
      digest: createHash("sha256")
        .update(JSON.stringify(answer.metrics))
        .digest("hex"),
    });
    return { ...answer, requestId };
  } finally {
    dependencies.audit({
      event: "tf_assist_request",
      requestId,
      userId: scope.userId,
      companyId: scope.companyId,
      intent,
      decision,
      durationMs: Date.now() - started,
    });
  }
}
