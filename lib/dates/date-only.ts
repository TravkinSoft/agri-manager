const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: unknown): boolean {
  const text = String(value || "");
  const match = DATE_ONLY_RE.exec(text);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  );
}

export function requireDateOnly(value: unknown, fieldName = "date"): string {
  const text = String(value || "").trim();
  if (!isDateOnly(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`);
  }
  return text;
}

export function todayDateOnlyLocal(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateOnly(
  value: unknown,
  locale = "ru-RU",
  options: Intl.DateTimeFormatOptions = {}
): string {
  const text = requireDateOnly(value);
  const [year, month, day] = text.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options,
  }).format(new Date(year, month - 1, day));
}
