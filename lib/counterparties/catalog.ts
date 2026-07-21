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
  return normalizedName.includes(normalizedQuery) || (numericQuery.length > 0 && taxId.includes(numericQuery));
}
