// The compatibility reference stores an ID, not the authoritative employee name/status.
export function activeAssignedDriverName(value: unknown, companyId: string): string | null {
  const specialist = Array.isArray(value) ? value[0] : value;
  if (!specialist || typeof specialist !== "object") return null;
  const row = specialist as Record<string, unknown>;
  if (row.archived !== false || row.status !== "active" || row.personnel_type !== "driver") return null;
  const person = Array.isArray(row.person) ? row.person[0] : row.person;
  if (!person || typeof person !== "object") return null;
  const current = person as Record<string, unknown>;
  if (current.company_id !== companyId || current.status !== "active" ||
    current.role_type !== "driver" || current.deleted_at !== null) return null;
  return typeof current.full_name === "string" && current.full_name.trim() ? current.full_name : null;
}
