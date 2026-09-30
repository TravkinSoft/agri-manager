export function formatWeatherTime(
  value: string,
  options: { timezone?: string | null; utcOffsetMinutes?: number | null; includeDate?: boolean } = {}
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const formatOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(options.includeDate ? { day: "2-digit", month: "2-digit" } : {}),
  };
  if (options.timezone) {
    try {
      return new Intl.DateTimeFormat("ru-RU", { ...formatOptions, timeZone: options.timezone }).format(date);
    } catch {
      // Provider may return a non-IANA abbreviation; use its numeric offset below.
    }
  }
  if (options.utcOffsetMinutes != null) {
    const shifted = new Date(date.getTime() + options.utcOffsetMinutes * 60_000);
    return new Intl.DateTimeFormat("ru-RU", { ...formatOptions, timeZone: "UTC" }).format(shifted);
  }
  return new Intl.DateTimeFormat("ru-RU", formatOptions).format(date);
}

export function relativeWeatherAge(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "время обновления неизвестно";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "обновлено только что";
  if (minutes === 1) return "обновлено 1 минуту назад";
  if (minutes < 5) return `обновлено ${minutes} минуты назад`;
  if (minutes < 60) return `обновлено ${minutes} минут назад`;
  const hours = Math.floor(minutes / 60);
  return `обновлено ${hours} ч назад`;
}
