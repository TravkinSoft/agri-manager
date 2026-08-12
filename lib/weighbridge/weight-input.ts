const STRICT_KG_PATTERN = /^(?:0|[1-9]\d*)(?:[.,]\d+)?$/;

export type StrictWeightResult =
  | { ok: true; value: number; normalized: string }
  | { ok: false; message: string };

export function parseStrictWeightKg(value: unknown, label: "Брутто" | "Тара" | "Вес" = "Вес"): StrictWeightResult {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, message: `${label} указывается только числом в килограммах.` };
    }
    return { ok: true, value, normalized: String(value) };
  }

  const raw = String(value ?? "").trim();
  if (!raw || !STRICT_KG_PATTERN.test(raw)) {
    return { ok: false, message: `${label} указывается только числом в килограммах.` };
  }

  const normalized = raw.replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: `${label} указывается только числом в килограммах.` };
  }
  return { ok: true, value: parsed, normalized };
}

export function tareDifferencePercent(previousTareKg: number, nextTareKg: number) {
  if (!Number.isFinite(previousTareKg) || previousTareKg <= 0 || !Number.isFinite(nextTareKg)) return null;
  return ((nextTareKg - previousTareKg) / previousTareKg) * 100;
}

export function requiresTareConfirmation(previousTareKg: number, nextTareKg: number) {
  const difference = tareDifferencePercent(previousTareKg, nextTareKg);
  return difference != null && Math.abs(difference) >= 20;
}
