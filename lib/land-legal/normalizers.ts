export function normalizeText(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeComparable(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/ё/g, "е");
}

export function normalizeCadastreNumber(value: unknown): string {
  return normalizeComparable(value)
    .replace(/[–—−]/g, "-")
    .replace(/[^0-9a-zа-я-]/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

export function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = normalizeText(value).replace(",", ".");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isUuidLike(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}
