/** One explicitly submitted warehouse request. Never an offline queue. */
export interface MtmPendingRequest {
  version: 1;
  key: string;
  body: string;
  createdAt: string;
}

export interface MtmPendingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mtmPendingStorageKey(actorId: string, companyId: string) {
  if (!UUID.test(actorId) || !UUID.test(companyId)) throw new Error("Не удалось определить владельца незавершённой операции.");
  return `mtm-pending-v1:${actorId}:${companyId}`;
}

export function createMtmPendingRequest(payload: { companyId: string }, key: string, now = new Date().toISOString()): MtmPendingRequest {
  if (!UUID.test(key) || !UUID.test(payload.companyId)) throw new Error("Некорректный идентификатор операции.");
  // Store bytes, not a mutable form object, so retries cannot silently change meaning.
  return Object.freeze({ version: 1 as const, key, body: JSON.stringify(payload), createdAt: now });
}

export function readMtmPendingRequest(storage: MtmPendingStorage, storageKey: string, companyId: string): MtmPendingRequest | null {
  const text = storage.getItem(storageKey);
  if (text === null) return null;
  try {
    if (text.length > 32768) throw new Error("oversized");
    const pending = JSON.parse(text) as MtmPendingRequest;
    if (pending.version !== 1 || typeof pending.key !== "string" || !UUID.test(pending.key)
      || typeof pending.body !== "string" || typeof pending.createdAt !== "string"
      || !Number.isFinite(Date.parse(pending.createdAt))) throw new Error("invalid");
    const payload = JSON.parse(pending.body);
    if (!payload || typeof payload !== "object" || payload.companyId !== companyId
      || !["receipt", "issue", "return"].includes(payload.kind)) throw new Error("mismatched");
    return Object.freeze({ version: 1, key: pending.key, body: pending.body, createdAt: pending.createdAt });
  } catch {
    // Never silently discard an unknown outcome and allow a new stock movement.
    throw new Error("Сохранённая незавершённая операция повреждена. Новые движения заблокированы; требуется проверка журнала администратором.");
  }
}

export function persistMtmPendingRequest(storage: MtmPendingStorage, storageKey: string, pending: MtmPendingRequest) {
  const existing = storage.getItem(storageKey);
  if (existing !== null && existing !== JSON.stringify(pending)) throw new Error("Уже сохранён другой неподтверждённый запрос. Новая операция не отправлена.");
  storage.setItem(storageKey, JSON.stringify(pending));
  if (storage.getItem(storageKey) !== JSON.stringify(pending)) throw new Error("Не удалось сохранить защиту от повторной операции. Запрос не отправлен.");
}

export function acknowledgeMtmPendingRequest(storage: MtmPendingStorage, storageKey: string, pending: MtmPendingRequest, operationId: string) {
  if (!UUID.test(operationId)) throw new Error("Сервер не вернул корректную квитанцию операции.");
  if (storage.getItem(storageKey) !== JSON.stringify(pending)) throw new Error("Сохранённый запрос изменился. Автоматическое снятие блокировки отменено.");
  storage.setItem(`${storageKey}:receipt`, JSON.stringify({ key: pending.key, operationId, acknowledgedAt: new Date().toISOString() }));
  storage.removeItem(storageKey);
  if (storage.getItem(storageKey) !== null) throw new Error("Операция подтверждена, но локальное подтверждение не сохранено. Повторная проверка использует тот же запрос.");
}

export function forgetRejectedMtmRequest(storage: MtmPendingStorage, storageKey: string, pending: MtmPendingRequest) {
  if (storage.getItem(storageKey) !== JSON.stringify(pending)) throw new Error("Сохранённый запрос изменился. Автоматическое снятие блокировки отменено.");
  storage.removeItem(storageKey);
  if (storage.getItem(storageKey) !== null) throw new Error("Не удалось снять блокировку отклонённого запроса.");
}
