import type { ReadOnlyHistoryMessage, ReadOnlyThreadState } from "@/lib/assistant/v1/types";

function normalizeScopeText(value: unknown): string {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»"'`?!.;,():]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasExplicitFieldReferenceText(message: string): boolean {
  const text = normalizeScopeText(message);
  return (
    /(?:^|\s)(?:пол(?:е|я|ю|ем)|field)\s*№?\s*\d{1,3}(?:-\d{1,3}){0,2}(?=$|\s)/u.test(text) ||
    /(?:^|\s)\d{1,3}(?:-\d{1,3}){0,2}\s+пол(?:е|я|ю|ем)(?=$|\s)/u.test(text)
  );
}

function hasExplicitFieldSearchQualifier(message: string): boolean {
  const text = normalizeScopeText(message);
  return /(?:^|\s)(?:со\s+слов|с\s+назван|площад|где\s+выращ|по\s+культур|номер)\p{L}*(?=$|\s)/u.test(text);
}

export function isGenericFieldDirectoryRequest(message: string): boolean {
  const text = normalizeScopeText(message);
  if (!/(?:^|\s)(?:поля|полей|fields)(?=$|\s)/u.test(text)) return false;
  if (hasExplicitFieldReferenceText(text) || hasExplicitFieldSearchQualifier(text)) return false;
  return /(?:^|\s)(?:какие|покажи|список|перечисл\p{L}*|назови|все|all|list)(?=$|\s)/u.test(text);
}

export function isCompanyWideFieldRequest(message: string): boolean {
  const text = normalizeScopeText(message);
  if (isGenericFieldDirectoryRequest(text)) return true;
  if (!/(?:^|\s)(?:поля|полей|fields)(?=$|\s)/u.test(text)) return false;
  if (hasExplicitFieldReferenceText(text) || hasExplicitFieldSearchQualifier(text)) return false;
  return /(?:^|\s)(?:сколько|count)(?=$|\s)/u.test(text);
}

export function isExplicitFieldFollowUp(message: string): boolean {
  const text = normalizeScopeText(message);
  if (!text || isCompanyWideFieldRequest(text)) return false;
  if (/(?:^|\s)(?:там|на\s+нем|по\s+нему|на\s+этом\s+поле|по\s+этому\s+полю|для\s+него)(?=$|\s)/u.test(text)) {
    return true;
  }
  return /^(?:а|и)\s+(?:какая|какой|какие|что|сколько|культур\p{L}*|сорт\p{L}*|площад\p{L}*|операц\p{L}*|материал\p{L}*)(?=$|\s)/u.test(text);
}

export function isCompanyWideOperationsRequest(message: string): boolean {
  const text = normalizeScopeText(message);
  if (!/(?:^|\s)(?:операци(?:и|й|ям|ями|ях)|operations|поливы)(?=$|\s)/u.test(text)) return false;
  if (hasExplicitFieldReferenceText(text) || isExplicitFieldFollowUp(text)) return false;
  return true;
}

export function isCompanyWideWarehouseRequest(message: string): boolean {
  const text = normalizeScopeText(message);
  if (!/(?:^|\s)(?:склады|складов|warehouses)(?=$|\s)/u.test(text)) return false;
  if (/(?:^|\s)(?:на\s+нем|по\s+нему|там)(?=$|\s)/u.test(text)) return false;
  return /(?:^|\s)(?:какие|сколько|покажи|список|перечисл\p{L}*|все|all|list|count)(?=$|\s)/u.test(text);
}

export function scopeThreadStateForMessage(
  state: ReadOnlyThreadState,
  message: string
): ReadOnlyThreadState {
  if (
    !isCompanyWideFieldRequest(message) &&
    !isCompanyWideOperationsRequest(message) &&
    !isCompanyWideWarehouseRequest(message)
  ) {
    return state;
  }
  return {
    ...state,
    selectedFieldId: null,
    selectedFieldLabel: null,
    selectedOperationId: isCompanyWideOperationsRequest(message) ? null : state.selectedOperationId,
    selectedWarehouseId: isCompanyWideWarehouseRequest(message) ? null : state.selectedWarehouseId,
    unresolvedQuestion: null,
  };
}

export function expectedFieldCountFromHistory(
  history: ReadOnlyHistoryMessage[] | null | undefined
): number | null {
  if (!Array.isArray(history)) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.role !== "assistant") continue;
    const content = String(item.content || "");
    const match = content.match(/(?:^|\s)(\d{1,4})\s+(?:полей|поля)(?=$|\s|[.,!?;:])/iu);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}
