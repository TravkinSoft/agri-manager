export const UNIVERSAL_WORKSPACE_SCHEMA_VERSION = 3;
export const UNIVERSAL_WORKSPACE_MAX_TABS = 6;

export const UNIVERSAL_WORKSPACE_OPERATION_TYPES = [
  "harvest_incoming",
  "supplier_receipt",
  "issue_to_field",
  "transfer_between_warehouses",
  "shipment_outbound",
  "disposal_writeoff",
  "impurity_removal",
] as const;

export type UniversalWorkspaceOperationType =
  (typeof UNIVERSAL_WORKSPACE_OPERATION_TYPES)[number];

export type UniversalWeighbridgeWorkspace<TForm, TLine = unknown> = {
  id: string;
  form: TForm;
  supplierReceiptLines: TLine[];
  showSupplierExtraFields: boolean;
};

export type UniversalWeighbridgeWorkspaceState<TForm, TLine = unknown> = {
  version: typeof UNIVERSAL_WORKSPACE_SCHEMA_VERSION;
  selectedId: string;
  workspaces: Array<UniversalWeighbridgeWorkspace<TForm, TLine>>;
  migratedLegacyHarvest: boolean;
};

type StorageReader = Pick<Storage, "getItem" | "setItem">;

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const isOperationType = (value: unknown): value is UniversalWorkspaceOperationType =>
  UNIVERSAL_WORKSPACE_OPERATION_TYPES.includes(value as UniversalWorkspaceOperationType);

export function getWeighbridgeWorkstationId(storage: StorageReader): string {
  const key = "travkin.weighbridge.workstation.v1";
  const existing = clean(storage.getItem(key));
  if (existing) return existing;
  const created = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storage.setItem(key, created);
  return created;
}

export function universalWorkspaceStorageKey(
  companyId: string | null | undefined,
  seasonId: string | number | null | undefined,
  workstationId: string | null | undefined
) {
  const company = clean(companyId);
  const season = clean(String(seasonId || ""));
  const workstation = clean(workstationId);
  return company && season && workstation
    ? `travkin.weighbridge.universalWorkspaces.v${UNIVERSAL_WORKSPACE_SCHEMA_VERSION}.${company}.${season}.${workstation}`
    : "";
}

export function createUniversalWorkspace<TForm, TLine = unknown>(
  form: TForm,
  operationType: UniversalWorkspaceOperationType = "harvest_incoming",
  id?: string
): UniversalWeighbridgeWorkspace<TForm, TLine> {
  return {
    id: clean(id) || `workspace-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`,
    form: { ...(form as Record<string, unknown>), operationType } as TForm,
    supplierReceiptLines: [],
    showSupplierExtraFields: false,
  };
}

export function serializeUniversalWorkspaceState<TForm, TLine = unknown>(
  state: UniversalWeighbridgeWorkspaceState<TForm, TLine>
) {
  return JSON.stringify({ ...state, version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION });
}

export function parseUniversalWorkspaceState<TForm extends Record<string, unknown>, TLine = unknown>(
  raw: string | null | undefined,
  initialForm: TForm
): UniversalWeighbridgeWorkspaceState<TForm, TLine> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UniversalWeighbridgeWorkspaceState<Record<string, unknown>, TLine>>;
    if (parsed.version !== UNIVERSAL_WORKSPACE_SCHEMA_VERSION || !Array.isArray(parsed.workspaces)) return null;
    const workspaces = parsed.workspaces
      .slice(0, UNIVERSAL_WORKSPACE_MAX_TABS)
      .map((workspace, index) => {
        const operationType = isOperationType(workspace?.form?.operationType)
          ? workspace.form.operationType
          : "harvest_incoming";
        return {
          id: clean(workspace?.id) || `workspace-${index + 1}`,
          form: {
            ...initialForm,
            ...(workspace?.form || {}),
            operationType,
          } as TForm,
          supplierReceiptLines: Array.isArray(workspace?.supplierReceiptLines)
            ? workspace.supplierReceiptLines
            : [],
          showSupplierExtraFields: workspace?.showSupplierExtraFields === true,
        };
      });
    if (workspaces.length === 0) return null;
    const selectedId = workspaces.some((workspace) => workspace.id === clean(parsed.selectedId))
      ? clean(parsed.selectedId)
      : workspaces[0].id;
    return {
      version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
      selectedId,
      workspaces,
      migratedLegacyHarvest: parsed.migratedLegacyHarvest === true,
    };
  } catch {
    return null;
  }
}

type LegacyHarvestDraft = {
  id?: unknown;
  fieldId?: unknown;
  cropStructureAllocationId?: unknown;
  warehouseToId?: unknown;
  vehicleId?: unknown;
  driverId?: unknown;
  grossKg?: unknown;
};

export function migrateLegacyHarvestWorkspaces<TForm extends Record<string, unknown>, TLine = unknown>(
  raw: string | null | undefined,
  initialForm: TForm
): UniversalWeighbridgeWorkspaceState<TForm, TLine> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { selectedId?: unknown; drafts?: LegacyHarvestDraft[] };
    if (!Array.isArray(parsed.drafts) || parsed.drafts.length === 0) return null;
    const workspaces = parsed.drafts
      .slice(0, UNIVERSAL_WORKSPACE_MAX_TABS)
      .map((draft, index) => createUniversalWorkspace<TForm, TLine>({
        ...initialForm,
        operationType: "harvest_incoming",
        fieldId: clean(draft.fieldId),
        cropStructureAllocationId: clean(draft.cropStructureAllocationId),
        warehouseToId: clean(draft.warehouseToId),
        vehicleId: clean(draft.vehicleId),
        driverId: clean(draft.driverId),
        grossKg: clean(draft.grossKg),
      } as TForm, "harvest_incoming", clean(draft.id) || `workspace-${index + 1}`));
    const selectedId = workspaces.some((workspace) => workspace.id === clean(parsed.selectedId))
      ? clean(parsed.selectedId)
      : workspaces[0].id;
    return {
      version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
      selectedId,
      workspaces,
      migratedLegacyHarvest: true,
    };
  } catch {
    return null;
  }
}

export function isUniversalWorkspaceDirty<TForm extends Record<string, unknown>>(
  form: TForm,
  initialForm: TForm,
  supplierLineCount = 0
) {
  if (supplierLineCount > 0) return true;
  return Object.keys(initialForm).some((key) =>
    key !== "operationType" && String(form[key] ?? "") !== String(initialForm[key] ?? "")
  );
}
