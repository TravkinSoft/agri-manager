type FieldMetadata = {
  source?: string | null;
  original_field_key?: string | null;
  resolved_field_name?: string | null;
  import_row_index?: number | null;
  source_row_hash?: string | null;
};

export type FieldDisplaySource = {
  name?: string | null;
  notes?: string | null;
  display_name?: string | null;
  original_field_key?: string | null;
  technical_key?: string | null;
  created_at?: string | null;
};

function asNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

const GARBAGE_FIELD_PATTERNS: RegExp[] = [
  /system\.xml\.xmlelement/iu,
  /system\.xml/iu,
  /^xml(element|node)?$/iu,
  /xmlelement/iu,
];

export function isGarbageFieldToken(value: unknown): boolean {
  const token = asNonEmpty(value);
  if (!token) return false;
  return GARBAGE_FIELD_PATTERNS.some((pattern) => pattern.test(token));
}

function parseFieldMetadata(notes: unknown): FieldMetadata | null {
  if (typeof notes !== "string") return null;
  const raw = notes.trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as FieldMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeDisplayCandidate(value: unknown): string | null {
  const text = asNonEmpty(value);
  if (!text) return null;
  if (isGarbageFieldToken(text)) return null;
  return text;
}

function stripLastNumericSuffix(value: string): string {
  if (!value.includes("-")) return value;
  const stripped = value.replace(/-\d+$/u, "");
  return stripped.trim() || value;
}

function looksTechnicalLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^\d+(?:-\d+)+$/u.test(normalized) ||
    /^[\p{L}]{1,8}-\d+(?:-\d+)+$/u.test(normalized)
  );
}

function buildFallbackForGarbage(metadata: FieldMetadata | null): string {
  if (typeof metadata?.import_row_index === "number") {
    return `Поле ${metadata.import_row_index}`;
  }
  return "Поле (не определено)";
}

export function getFieldDisplayName(field: FieldDisplaySource): string {
  const metadata = parseFieldMetadata(field.notes);

  const direct = normalizeDisplayCandidate(field.display_name);
  if (direct) return direct;

  const original = normalizeDisplayCandidate(field.original_field_key);
  if (original) return original;

  const metadataOriginal = normalizeDisplayCandidate(metadata?.original_field_key);
  if (metadataOriginal) return metadataOriginal;

  const metadataResolved = normalizeDisplayCandidate(metadata?.resolved_field_name);
  if (metadataResolved) return metadataResolved;

  const technical = asNonEmpty(field.technical_key) || asNonEmpty(field.name);
  if (!technical) return "—";

  if (isGarbageFieldToken(technical)) {
    return buildFallbackForGarbage(metadata);
  }

  if (looksTechnicalLike(technical)) {
    return stripLastNumericSuffix(technical);
  }

  if (metadata?.source === "import_2026_structure") {
    return stripLastNumericSuffix(technical);
  }

  return technical;
}

export function getFieldTechnicalKey(field: FieldDisplaySource): string {
  const technical = asNonEmpty(field.technical_key) || asNonEmpty(field.name) || null;
  if (!technical) return "—";
  if (isGarbageFieldToken(technical)) return "—";
  return technical;
}

export function getFieldMetadata(field: FieldDisplaySource): FieldMetadata | null {
  return parseFieldMetadata(field.notes);
}

export function getFieldSourceLabel(field: FieldDisplaySource): string | null {
  const source = asNonEmpty(getFieldMetadata(field)?.source);
  if (!source) return null;
  if (source === "import_2026_structure") return "Импорт структуры 2026";
  return source;
}

export function getFieldSearchTokens(field: FieldDisplaySource): string[] {
  const display = getFieldDisplayName(field);
  const technical = getFieldTechnicalKey(field);
  const original = normalizeDisplayCandidate(getFieldMetadata(field)?.original_field_key);
  return [display, isGarbageFieldToken(technical) ? "" : technical, original || ""].filter(Boolean);
}
