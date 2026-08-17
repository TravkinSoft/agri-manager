export type CropIdentity = {
  cropName?: string | null;
  varietyName?: string | null;
  reproductionName?: string | null;
};

function text(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function resolveCropIdentity(...sources: CropIdentity[]): Required<CropIdentity> {
  return {
    cropName: sources.map((source) => text(source.cropName)).find(Boolean) || null,
    varietyName: sources.map((source) => text(source.varietyName)).find(Boolean) || null,
    reproductionName: sources.map((source) => text(source.reproductionName)).find(Boolean) || null,
  };
}

export function formatCropIdentity(identity: CropIdentity): string {
  const resolved = resolveCropIdentity(identity);
  return [resolved.cropName || "Культура не указана", resolved.varietyName, resolved.reproductionName]
    .filter(Boolean)
    .join(" / ");
}

export function formatVarietyReproduction(identity: CropIdentity): string {
  const resolved = resolveCropIdentity(identity);
  return [resolved.varietyName, resolved.reproductionName].filter(Boolean).join(" / ");
}
