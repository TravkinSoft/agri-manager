import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  getServerActorFromSession,
  SessionAuthError,
} from "@/lib/auth/server-session";
import { AssistError, assertRuntime, authorize } from "@/lib/tf-assist/policy";
import {
  createReadOnlySourceReader,
  loadSnapshot,
} from "@/lib/tf-assist/read-only";
import { answerQuestion } from "@/lib/tf-assist/service";
import { planQuestion } from "@/lib/tf-assist/planner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const inFlight = new Map<string, number>();
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Authorization, Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });

export async function POST(request: NextRequest) {
  let lockKey = "";
  try {
    assertRuntime(process.env);
    if (
      request.headers.get("origin") !== request.nextUrl.origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new AssistError("Запрос с другого сайта запрещён.", 403);
    if (Number(request.headers.get("content-length") || 0) > 12000)
      throw new AssistError("Вопрос слишком длинный.", 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 12000)
      throw new AssistError("Вопрос слишком длинный.", 413);
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new AssistError("Некорректный запрос.", 400);
    }
    const answer = await answerQuestion(input, {
      plan: (message) =>
        planQuestion(message, {
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_ASSISTANT_MODEL,
        }),
      authorize: async (companyId) => {
        const scope = authorize(
          await getServerActorFromSession(request, { skipCache: true }),
          companyId,
        );
        if (!lockKey) {
          const now = Date.now();
          Array.from(inFlight.entries()).forEach(([key, expiry]) => {
            if (expiry <= now) inFlight.delete(key);
          });
          const key = `${scope.userId}:${scope.companyId}`;
          if (inFlight.has(key) || inFlight.size >= 100)
            throw new AssistError(
              "Предыдущий вопрос ещё обрабатывается. Подождите.",
              429,
            );
          inFlight.set(key, now + 60000);
          lockKey = key;
        }
        return scope;
      },
      load: (companyId, intent) =>
        loadSnapshot(
          companyId,
          createReadOnlySourceReader(
            companyId,
            process.env.SUPABASE_SERVICE_ROLE_KEY || "",
          ),
          intent === "traffic" || intent === "fleet"
            ? [
                "fields",
                "reference_vehicles",
                "reference_machines",
                "reference_specialists",
                "company_people",
                "ptc_flows",
                "ptc_vehicle_states",
                "fleet_vehicle_repairs",
                "ptc_combine_shifts",
                "ptc_combine_operator_statuses",
              ]
            : undefined,
        ),
      audit: (record) => console.info(JSON.stringify(record)),
    });
    return json(answer);
  } catch (error) {
    if (error instanceof AssistError || error instanceof SessionAuthError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        { error: "Проверьте вопрос, компанию и параметры площади." },
        400,
      );
    // No raw upstream errors, prompts, credentials or business rows in logs/responses.
    console.error(
      JSON.stringify({ event: "tf_assist_error", code: "UNEXPECTED" }),
    );
    return json(
      { error: "Не удалось подтвердить ответ. Повторите запрос." },
      503,
    );
  } finally {
    if (lockKey) inFlight.delete(lockKey);
  }
}
