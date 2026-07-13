export type TypedFieldSearchParameters = {
  name?: string;
  number?: string;
  area_ha?: number;
  area_tolerance_ha?: number;
  season_id?: string;
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function numeric(value: unknown): number | null {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanName(value: string): string | null {
  const result = value
    .replace(/[?!.;,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!result || /^\d+(?:-\d+)*$/u.test(result)) return null;
  return result.slice(0, 120);
}

export function parseTypedFieldSearchParameters(
  message: string,
  args: Record<string, unknown> = {}
): TypedFieldSearchParameters {
  const text = String(message || "").trim();
  const result: TypedFieldSearchParameters = {};
  const explicitName = clean(args.name);
  const explicitNumber = clean(args.number);
  const explicitArea = numeric(args.area_ha);
  const explicitTolerance = numeric(args.area_tolerance_ha);
  const explicitSeason = clean(args.season_id);

  if (explicitName) result.name = explicitName;
  if (explicitNumber) result.number = explicitNumber;
  if (explicitArea != null) result.area_ha = explicitArea;
  if (explicitTolerance != null && explicitTolerance >= 0) result.area_tolerance_ha = explicitTolerance;
  if (explicitSeason) result.season_id = explicitSeason;

  const areaMatch = text.match(/(?:площад(?:ь|ью|и)\s*)?(\d+(?:[.,]\d+)?)\s*(?:га|ha)(?![\p{L}\p{N}_])/iu);
  if (areaMatch) {
    const area = numeric(areaMatch[1]);
    if (area != null) {
      result.area_ha = area;
      delete result.number;
      delete result.name;
    }
  } else {
    const namedMatch = text.match(/(?:^|\s)назван[\p{L}]*\s+[«"']?([^»"'?!.;,]+)[»"']?/iu);
    const fieldNameMatch = text.match(/(?:^|\s)пол(?:е|я)\s+[«"']?([\p{L}][\p{L}\p{N}\s_-]{0,80})[»"']?/iu);
    const messageName = cleanName(namedMatch?.[1] || fieldNameMatch?.[1] || "");
    const numberMatch = text.match(/(?:^|\s)(?:пол(?:е|я)|field|№)\s*№?\s*(\d{1,3}(?:-\d{1,3}){0,2})(?!\d)/iu);
    if (messageName) {
      result.name = messageName;
      delete result.number;
    } else if (numberMatch?.[1]) {
      result.number = numberMatch[1];
      delete result.name;
    }
  }

  if (!result.area_ha && !result.number) {
    const namedMatch = text.match(/(?:^|\s)назван[\p{L}]*\s+[«"']?([^»"'?!.;,]+)[»"']?/iu);
    const fieldNameMatch = text.match(/(?:^|\s)пол(?:е|я)\s+[«"']?([\p{L}][\p{L}\p{N}\s_-]{0,80})[»"']?/iu);
    const parsedName = cleanName(namedMatch?.[1] || fieldNameMatch?.[1] || explicitName || "");
    if (parsedName) result.name = parsedName;
  }

  if (result.area_ha != null && result.area_tolerance_ha == null) {
    result.area_tolerance_ha = 0.25;
  }
  return result;
}
