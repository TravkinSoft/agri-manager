import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import type {
  FleetDuplicateCandidate,
  FleetEntityCreateCommand,
  FleetEntityKind,
} from "./entity-creation";

export interface FleetEntityCreationResult {
  companyId: string;
  kind: FleetEntityKind;
  created: { id: string; name: string; plate?: string | null };
}

export class FleetEntityCreationError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly code?: "exact_duplicate" | "potential_duplicate",
    public readonly candidates: FleetDuplicateCandidate[] = [],
  ) {
    super(message);
  }
}

function isCandidate(value: unknown): value is FleetDuplicateCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as FleetDuplicateCandidate;
  return typeof candidate.id === "string" &&
    (candidate.kind === "vehicle" || candidate.kind === "driver") &&
    (candidate.level === "exact" || candidate.level === "potential") &&
    typeof candidate.title === "string" &&
    (candidate.subtitle === null || typeof candidate.subtitle === "string") &&
    typeof candidate.reason === "string" && typeof candidate.score === "number";
}

function isResult(value: unknown): value is FleetEntityCreationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as FleetEntityCreationResult;
  return typeof result.companyId === "string" &&
    (result.kind === "vehicle" || result.kind === "driver") &&
    !!result.created && typeof result.created.id === "string" && typeof result.created.name === "string" &&
    (result.created.plate === undefined || result.created.plate === null || typeof result.created.plate === "string");
}

export async function saveFleetEntity(
  command: FleetEntityCreateCommand,
  signal?: AbortSignal,
): Promise<FleetEntityCreationResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 15000);
  try {
    const headers = await buildClientAuthHeaders("json");
    const response = await fetch("/api/fleet/entities", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const code = body.code === "exact_duplicate" || body.code === "potential_duplicate" ? body.code : undefined;
      const candidates = Array.isArray(body.candidates) ? body.candidates.filter(isCandidate) : [];
      throw new FleetEntityCreationError(
        typeof body.error === "string" ? body.error : "Не удалось создать запись",
        response.status,
        code,
        candidates,
      );
    }
    if (!isResult(payload) || payload.kind !== command.kind ||
        (command.companyId && payload.companyId !== command.companyId)) {
      throw new FleetEntityCreationError("Ответ сервера не соответствует созданной записи");
    }
    return payload;
  } catch (error) {
    if (error instanceof FleetEntityCreationError) throw error;
    if (error instanceof Error && error.message.startsWith("Missing authorization token")) {
      throw new FleetEntityCreationError("Войдите в TravkinFlow заново", 401);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new FleetEntityCreationError("Нет подтверждения сервера. Обновите список перед повтором.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
