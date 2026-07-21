export type CounterpartyCountryCode = "KZ" | "RU";

export const COUNTERPARTY_COUNTRY_LABELS: Record<CounterpartyCountryCode, string> = {
  KZ: "Казахстан",
  RU: "Россия",
};

export type GlobalCounterpartyImportRow = {
  legal_name: string;
  tax_id: string;
  country_code: CounterpartyCountryCode;
};

export type GlobalCounterpartyImportValidation = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateTaxIds: number;
  duplicateNormalizedNames: number;
  emptyLegalNames: number;
  emptyTaxIds: number;
  emptyCountries: number;
  kazakhstanRows: number;
  russiaRows: number;
  errors: string[];
};

export function normalizeCounterpartyName(value: unknown): string {
  return String(value || "")
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(тоо|ооо|ао|ип)\s+/u, "");
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function latinSearchForm(value: unknown): string {
  return normalizeCounterpartyName(value)
    .split("")
    .map((letter) => CYRILLIC_TO_LATIN[letter] ?? letter)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function phoneticSearchForm(value: string): string {
  return value.replace(/y/g, "i").replace(/w/g, "v").replace(/ow/g, "ou").replace(/ph/g, "f");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function fuzzyTokenMatch(query: string, candidate: string): boolean {
  if (!query || !candidate) return false;
  if (candidate.includes(query) || query.includes(candidate)) return true;
  if (Math.min(query.length, candidate.length) < 5) return false;
  const distance = editDistance(query, candidate);
  return 1 - distance / Math.max(query.length, candidate.length) >= 0.72;
}

export function normalizeTaxId(value: unknown): string {
  return String(value || "").trim();
}

export function isCountryCode(value: unknown): value is CounterpartyCountryCode {
  return value === "KZ" || value === "RU";
}

export function validateGlobalCounterpartyImport(
  rows: GlobalCounterpartyImportRow[],
): GlobalCounterpartyImportValidation {
  const taxKeys = new Map<string, number>();
  const names = new Map<string, number>();
  let emptyLegalNames = 0;
  let emptyTaxIds = 0;
  let emptyCountries = 0;
  let invalidRows = 0;
  let kazakhstanRows = 0;
  let russiaRows = 0;

  for (const row of rows) {
    const legalName = String(row?.legal_name || "").trim();
    const taxId = normalizeTaxId(row?.tax_id);
    const countryCode = row?.country_code;
    if (!legalName) emptyLegalNames += 1;
    if (!taxId) emptyTaxIds += 1;
    if (!isCountryCode(countryCode)) emptyCountries += 1;
    if (countryCode === "KZ") kazakhstanRows += 1;
    if (countryCode === "RU") russiaRows += 1;

    const validTaxLength = countryCode === "KZ"
      ? /^\d{12}$/.test(taxId)
      : countryCode === "RU" && /^\d{10}$/.test(taxId);
    if (!legalName || !isCountryCode(countryCode) || !validTaxLength) {
      invalidRows += 1;
    }

    if (isCountryCode(countryCode) && taxId) {
      const taxKey = `${countryCode}:${taxId}`;
      taxKeys.set(taxKey, (taxKeys.get(taxKey) || 0) + 1);
    }
    const normalizedName = normalizeCounterpartyName(legalName);
    if (normalizedName) names.set(normalizedName, (names.get(normalizedName) || 0) + 1);
  }

  const duplicateTaxIds = Array.from(taxKeys.values()).filter((count) => count > 1).length;
  const duplicateNormalizedNames = Array.from(names.values()).filter((count) => count > 1).length;
  const errors: string[] = [];
  if (rows.length !== 108) errors.push(`Ожидалось 108 строк, получено ${rows.length}.`);
  if (invalidRows > 0) errors.push(`Невалидных строк: ${invalidRows}.`);
  if (duplicateTaxIds > 0) errors.push(`Дублей country_code + tax_id: ${duplicateTaxIds}.`);
  if (kazakhstanRows !== 89) errors.push(`Ожидалось 89 организаций KZ, получено ${kazakhstanRows}.`);
  if (russiaRows !== 19) errors.push(`Ожидалось 19 организаций RU, получено ${russiaRows}.`);

  return {
    totalRows: rows.length,
    validRows: rows.length - invalidRows,
    invalidRows,
    duplicateTaxIds,
    duplicateNormalizedNames,
    emptyLegalNames,
    emptyTaxIds,
    emptyCountries,
    kazakhstanRows,
    russiaRows,
    errors,
  };
}

export function counterpartyMatchesSearch(params: {
  legalName: unknown;
  taxId: unknown;
  query: unknown;
}): boolean {
  const rawQuery = String(params.query || "").trim();
  if (!rawQuery) return true;
  const normalizedQuery = normalizeCounterpartyName(rawQuery);
  const normalizedName = normalizeCounterpartyName(params.legalName);
  const taxId = normalizeTaxId(params.taxId);
  const numericQuery = rawQuery.replace(/\D/g, "");
  if (numericQuery.length > 0 && taxId.includes(numericQuery)) return true;
  if (normalizedName.includes(normalizedQuery)) return true;
  const queryForms = [latinSearchForm(normalizedQuery), phoneticSearchForm(latinSearchForm(normalizedQuery))];
  const nameTokens = latinSearchForm(normalizedName).split(" ").filter(Boolean);
  const nameForms = nameTokens.flatMap((token) => [token, phoneticSearchForm(token)]);
  return queryForms.some((queryForm) => nameForms.some((nameForm) => fuzzyTokenMatch(queryForm, nameForm)));
}
