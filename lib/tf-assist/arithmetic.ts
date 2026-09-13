/** All persisted kg are read at milligram-of-tonne precision: 1 integer gram.
 * Reject unexpected precision and unsafe integers; never round a source silently. */
export function fixed(value: unknown, places: number): number {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(",", ".")
        : "";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[3] || "").replace(/0+$/, "").length > places)
    throw new Error("Недопустимая точность или отсутствующее число источника.");
  const result =
    Number(match[2]) * 10 ** places +
    Number((match[3] || "").slice(0, places).padEnd(places, "0"));
  if (!Number.isSafeInteger(result))
    throw new Error("Число превышает безопасный диапазон.");
  return match[1] ? -result : result;
}
export const grams = (value: unknown): number => fixed(value, 3);
export function add(...values: number[]): number {
  return values.reduce((sum, n) => {
    const next = sum + n;
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(next))
      throw new Error("Переполнение расчёта.");
    return next;
  }, 0);
}
export function kg(g: number): string {
  return (
    (g / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 }) + " кг"
  );
}
export function positiveArea(value: unknown): number {
  const area = fixed(value, 4);
  if (area <= 0 || area > 1000000000)
    throw new Error("Укажите положительную площадь до 100 000 га.");
  return area;
}
export function yieldTonnes(g: number, area: number): string {
  return (
    (g / (area * 100)).toLocaleString("ru-RU", { maximumFractionDigits: 3 }) +
    " т/га"
  );
}
export function project(
  g: number,
  harvested: number,
  remaining: number,
): number {
  // Rational integer arithmetic prevents intermediate floating-point overflow.
  const result =
    (BigInt(g) * BigInt(remaining) + BigInt(Math.floor(harvested / 2))) /
    BigInt(harvested);
  const n = Number(result);
  if (!Number.isSafeInteger(n)) throw new Error("Переполнение прогноза.");
  return n;
}
