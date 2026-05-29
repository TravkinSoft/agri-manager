export type AssistantRouteKey =
  | "dashboard"
  | "fields"
  | "field-card"
  | "crop-structure"
  | "field-history"
  | "operations"
  | "warehouses"
  | "warehouse-card"
  | "weighbridge"
  | "reports"
  | "cadastre";

export type AssistantRouteEntry = {
  routeKey: AssistantRouteKey;
  path: string;
  supportedFilters: string[];
  entityTypes: Array<"field" | "warehouse" | "fuel" | "crop_structure_line" | "operation" | "none">;
  openStrategy: "route" | "query-filter" | "entity-route";
  requiredPermission: string;
};

const ROUTE_REGISTRY: AssistantRouteEntry[] = [
  {
    routeKey: "dashboard",
    path: "/dashboard",
    supportedFilters: ["season"],
    entityTypes: ["none"],
    openStrategy: "route",
    requiredPermission: "dashboard.read",
  },
  {
    routeKey: "fields",
    path: "/fields",
    supportedFilters: ["search", "crop", "variety", "season", "fieldId", "entityId", "entityType"],
    entityTypes: ["field", "crop_structure_line", "none"],
    openStrategy: "query-filter",
    requiredPermission: "fields.read",
  },
  {
    routeKey: "field-card",
    path: "/fields/",
    supportedFilters: ["season", "tab"],
    entityTypes: ["field"],
    openStrategy: "entity-route",
    requiredPermission: "fields.read",
  },
  {
    routeKey: "crop-structure",
    path: "/crop-structure",
    supportedFilters: ["season", "crop", "crop_group", "variety", "field"],
    entityTypes: ["field", "crop_structure_line", "none"],
    openStrategy: "query-filter",
    requiredPermission: "crop_structure.read",
  },
  {
    routeKey: "field-history",
    path: "/field-history",
    supportedFilters: ["field", "season", "operation", "crop"],
    entityTypes: ["field", "none"],
    openStrategy: "query-filter",
    requiredPermission: "fields.history.read",
  },
  {
    routeKey: "operations",
    path: "/operations",
    supportedFilters: ["search", "status", "crop", "field", "season", "operationId"],
    entityTypes: ["operation", "field", "none"],
    openStrategy: "query-filter",
    requiredPermission: "operations.read",
  },
  {
    routeKey: "warehouses",
    path: "/warehouses",
    supportedFilters: ["search", "type", "product", "crop", "variety", "negativeOnly", "warehouseId", "entityId", "entityType"],
    entityTypes: ["warehouse", "none"],
    openStrategy: "query-filter",
    requiredPermission: "warehouses.read",
  },
  {
    routeKey: "warehouse-card",
    path: "/warehouses/",
    supportedFilters: ["tab", "season"],
    entityTypes: ["warehouse"],
    openStrategy: "entity-route",
    requiredPermission: "warehouses.read",
  },
  {
    routeKey: "weighbridge",
    path: "/weighbridge",
    supportedFilters: ["status", "type", "field", "warehouse", "season"],
    entityTypes: ["none", "field", "warehouse"],
    openStrategy: "route",
    requiredPermission: "weighbridge.read",
  },
  {
    routeKey: "reports",
    path: "/analytics",
    supportedFilters: ["report", "season", "crop", "field", "warehouse"],
    entityTypes: ["none", "field", "warehouse"],
    openStrategy: "query-filter",
    requiredPermission: "reports.read",
  },
  {
    routeKey: "cadastre",
    path: "/land-legal",
    supportedFilters: ["district", "owner", "cadastre", "coverage"],
    entityTypes: ["none", "field"],
    openStrategy: "query-filter",
    requiredPermission: "land_legal.read",
  },
];

export function getAssistantRouteRegistry(): AssistantRouteEntry[] {
  return [...ROUTE_REGISTRY];
}

export function resolveRouteEntryByPath(path: string): AssistantRouteEntry | null {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) return null;
  const exact = ROUTE_REGISTRY.find((entry) => entry.path === normalizedPath);
  if (exact) return exact;
  return (
    ROUTE_REGISTRY.find((entry) => entry.path.endsWith("/") && normalizedPath.startsWith(entry.path)) || null
  );
}

export function normalizeRouteKeyFromPath(path: string): AssistantRouteKey {
  const entry = resolveRouteEntryByPath(path);
  return entry?.routeKey || "dashboard";
}

