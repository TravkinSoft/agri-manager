import { createHash } from "crypto";
import type { NextRequest } from "next/server";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "idempotency_key")
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function requireOperationIdempotency(request: NextRequest, body: Record<string, unknown>) {
  const headerKey = String(request.headers.get("Idempotency-Key") || "").trim();
  const bodyKey = String(body.idempotency_key || "").trim();
  const key = (headerKey || bodyKey).slice(0, 160);
  if (!key) throw new OperationMutationInputError("Idempotency-Key is required", 400);

  const fingerprint = createHash("sha256").update(stableStringify(body)).digest("hex");
  return { key, fingerprint };
}

export function operationMutationError(error: unknown, fallback: string) {
  const code = String((error as { code?: string } | null)?.code || "");
  const message = String((error as { message?: string } | null)?.message || fallback);
  const lower = message.toLowerCase();
  const status =
    code === "42501"
      ? 403
      : code === "P0002"
        ? 404
        : code === "23505" || code === "40001" || lower.includes("already") || lower.includes("changed by another")
          ? 409
          : code === "23514" || code === "22023" || code === "23503" || code === "23502"
            ? 400
            : 500;
  return { message, status };
}

export class OperationMutationInputError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
