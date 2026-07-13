export type ReadOnlyModelPreflightResult = {
  requestedModel: string;
  effectiveModel: string;
  overrideApplied: boolean;
  silentFallback: false;
};

export class ReadOnlyModelPreflightError extends Error {
  code: "MODEL_NOT_CONFIGURED" | "MODEL_NOT_AVAILABLE" | "MODEL_OVERRIDE_NOT_AVAILABLE";

  constructor(code: ReadOnlyModelPreflightError["code"], message: string) {
    super(message);
    this.name = "ReadOnlyModelPreflightError";
    this.code = code;
  }
}

function clean(value: unknown): string {
  return String(value || "").trim();
}

export function resolveReadOnlyQaModel(params: {
  configuredModel: string | null | undefined;
  processOverrideModel?: string | null;
  availableModels: Iterable<string>;
}): ReadOnlyModelPreflightResult {
  const requestedModel = clean(params.configuredModel);
  const overrideModel = clean(params.processOverrideModel);
  const available = new Set(Array.from(params.availableModels, clean).filter(Boolean));

  if (!requestedModel) {
    throw new ReadOnlyModelPreflightError("MODEL_NOT_CONFIGURED", "Read-only QA model is not configured.");
  }
  if (available.has(requestedModel)) {
    return { requestedModel, effectiveModel: requestedModel, overrideApplied: false, silentFallback: false };
  }
  if (!overrideModel) {
    throw new ReadOnlyModelPreflightError(
      "MODEL_NOT_AVAILABLE",
      `Configured read-only QA model is unavailable: ${requestedModel}`
    );
  }
  if (!available.has(overrideModel)) {
    throw new ReadOnlyModelPreflightError(
      "MODEL_OVERRIDE_NOT_AVAILABLE",
      `Explicit read-only QA model override is unavailable: ${overrideModel}`
    );
  }
  return { requestedModel, effectiveModel: overrideModel, overrideApplied: true, silentFallback: false };
}
