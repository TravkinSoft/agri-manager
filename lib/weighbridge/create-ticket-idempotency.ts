export type PersistedCreateTicketAttempt = Readonly<{
  version: 1;
  key: string;
  fingerprint: string;
}>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeJson(nested)])
    );
  }
  return value;
};

export const createTicketSubmissionFingerprint = (payload: unknown) => {
  const transmittedJson = JSON.stringify(payload);
  if (!transmittedJson) return "null";
  return JSON.stringify(canonicalizeJson(JSON.parse(transmittedJson)));
};

export const parsePersistedCreateTicketAttempt = (
  raw: string | null
): PersistedCreateTicketAttempt | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PersistedCreateTicketAttempt>;
    if (
      value.version !== 1
      || typeof value.key !== "string"
      || !UUID_RE.test(value.key)
      || typeof value.fingerprint !== "string"
      || !value.fingerprint
    ) return null;
    return { version: 1, key: value.key, fingerprint: value.fingerprint };
  } catch {
    // Legacy storage contained only the UUID. It is unsafe to reuse because
    // there is no way to prove that the restored form still has that payload.
    return null;
  }
};

export const serializePersistedCreateTicketAttempt = (
  attempt: PersistedCreateTicketAttempt
) => JSON.stringify(attempt);

export const resolveCreateTicketAttempt = (
  current: PersistedCreateTicketAttempt | null,
  fingerprint: string,
  createKey: () => string
): PersistedCreateTicketAttempt => {
  if (current?.fingerprint === fingerprint) return current;
  return { version: 1, key: createKey(), fingerprint };
};
