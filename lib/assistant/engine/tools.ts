import type { AssistantToolContext, AssistantToolDefinition, AssistantToolName } from "@/lib/assistant/engine/types";
import { getFieldDisplayName } from "@/lib/fields/display";

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isMissingRelationError(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return text.includes("does not exist") || text.includes("schema cache") || text.includes("not found");
}

function parseSearchQuery(context: AssistantToolContext): string | null {
  return (
    cleanString(context.intent.parameters.query) ||
    cleanString(context.intent.parameters.entityQuery) ||
    cleanString(context.runtimeContext.filters.search) ||
    context.sessionState.lastCrop ||
    null
  );
}

function applyTextFilter(rows: Array<Record<string, unknown>>, query: string | null): Array<Record<string, unknown>> {
  const text = cleanString(query)?.toLowerCase();
  if (!text) return rows;
  return rows.filter((row) => Object.values(row).some((value) => String(value || "").toLowerCase().includes(text)));
}

async function getCurrentSeason(companyId: string, context: AssistantToolContext): Promise<string | null> {
  const seasonRes = await context.supabase
    .from("seasons")
    .select("year,is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("year", { ascending: false })
    .limit(1);

  if (!seasonRes.error && (seasonRes.data || []).length > 0) {
    const season = cleanString(seasonRes.data?.[0]?.year);
    if (season) return season;
  }

  const cropRes = await context.supabase
    .from("crop_structure")
    .select("season_year")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("season_year", { ascending: false })
    .limit(1);

  if (!cropRes.error && (cropRes.data || []).length > 0) {
    return cleanString(cropRes.data?.[0]?.season_year);
  }

  return null;
}

async function buildLookupMaps(
  context: AssistantToolContext,
  ids: {
    warehouses?: string[];
    products?: string[];
    varieties?: string[];
    reproductions?: string[];
    fields?: string[];
    fuelSources?: string[];
  }
) {
  const [warehousesRes, productsRes, varietiesRes, reproductionsRes, fieldsRes, fuelSourcesRes] = await Promise.all([
    (ids.warehouses || []).length
      ? context.supabase.from("warehouses").select("id,name").in("id", ids.warehouses as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.products || []).length
      ? context.supabase.from("products").select("id,name,trade_name").in("id", ids.products as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.varieties || []).length
      ? context.supabase.from("varieties").select("id,name").in("id", ids.varieties as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.reproductions || []).length
      ? context.supabase.from("seed_reproductions").select("id,name").in("id", ids.reproductions as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.fields || []).length
      ? context.supabase.from("fields").select("id,name,notes").in("id", ids.fields as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.fuelSources || []).length
      ? context.supabase.from("fuel_sources").select("id,name").in("id", ids.fuelSources as string[])
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const byWarehouse = new Map<string, string>();
  (warehousesRes.data || []).forEach((row: any) => byWarehouse.set(String(row.id), String(row.name || row.id)));

  const byProduct = new Map<string, string>();
  (productsRes.data || []).forEach((row: any) =>
    byProduct.set(String(row.id), String(row.trade_name || row.name || row.id))
  );

  const byVariety = new Map<string, string>();
  (varietiesRes.data || []).forEach((row: any) => byVariety.set(String(row.id), String(row.name || row.id)));

  const byReproduction = new Map<string, string>();
  (reproductionsRes.data || []).forEach((row: any) => byReproduction.set(String(row.id), String(row.name || row.id)));

  const byField = new Map<string, string>();
  (fieldsRes.data || []).forEach((row: any) => byField.set(String(row.id), getFieldDisplayName(row) || String(row.id)));

  const byFuelSource = new Map<string, string>();
  (fuelSourcesRes.data || []).forEach((row: any) => byFuelSource.set(String(row.id), String(row.name || row.id)));

  return { byWarehouse, byProduct, byVariety, byReproduction, byField, byFuelSource };
}

const getCompanyContextTool: AssistantToolDefinition = {
  name: "get_company_context",
  description: "Текущий контекст компании и сезона",
  domains: ["company", "season"],
  run: async (context) => {
    const companyRes = await context.supabase.from("companies").select("id,name").eq("id", context.companyId).maybeSingle();
    const season = await getCurrentSeason(context.companyId, context);
    return {
      title: "Контекст компании",
      rows: [
        {
          company_id: context.companyId,
          company_name: companyRes.data?.name || context.companyId,
          season: season || "-",
        },
      ],
      source: {
        module: "assistant",
        tableOrView: "companies + seasons/crop_structure",
        season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getCurrentSeasonTool: AssistantToolDefinition = {
  name: "get_current_season",
  description: "Активный сезон компании",
  domains: ["season"],
  run: async (context) => {
    const season = await getCurrentSeason(context.companyId, context);
    return {
      title: "Активный сезон",
      rows: [{ season }],
      source: {
        module: "assistant",
        tableOrView: "seasons/crop_structure",
        season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getWarehouseBalancesTool: AssistantToolDefinition = {
  name: "get_warehouse_balances",
  description: "Identity-aware остатки по складам",
  domains: ["inventory", "warehouses", "batches", "identity"],
  run: async (context) => {
    const searchQuery = parseSearchQuery(context);
    const identityRes = await context.supabase
      .from("v_stock_balance_identity")
      .select("warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity")
      .eq("company_id", context.companyId)
      .gt("quantity", 0)
      .limit(500);

    let rows: Array<Record<string, unknown>> = [];
    let viewName = "v_stock_balance_identity";

    if (!identityRes.error) {
      const raw = identityRes.data || [];
      const lookup = await buildLookupMaps(context, {
        warehouses: Array.from(new Set(raw.map((x: any) => String(x.warehouse_id || "")).filter(Boolean))),
        products: Array.from(new Set(raw.map((x: any) => String(x.product_id || "")).filter(Boolean))),
        varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
        reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
      });

      rows = raw.map((row: any) => {
        const warehouseId = String(row.warehouse_id || "");
        const productId = String(row.product_id || "");
        const varietyId = cleanString(row.variety_id);
        const reproductionId = cleanString(row.reproduction_id);
        return {
          warehouse_name: lookup.byWarehouse.get(warehouseId) || warehouseId,
          product_name: lookup.byProduct.get(productId) || productId,
          variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
          reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
          batch_id: cleanString(row.batch_id),
          batch_class: cleanString(row.batch_class) || "commodity",
          quantity: Number(row.quantity || 0),
        };
      });
    } else if (isMissingRelationError(identityRes.error.message)) {
      viewName = "v_stock_balance_canonical";
      const fallbackRes = await context.supabase
        .from("v_stock_balance_canonical")
        .select("warehouse_id,product_id,quantity")
        .eq("company_id", context.companyId)
        .gt("quantity", 0)
        .limit(500);

      if (fallbackRes.error) throw new Error(fallbackRes.error.message);
      const raw = fallbackRes.data || [];
      const lookup = await buildLookupMaps(context, {
        warehouses: Array.from(new Set(raw.map((x: any) => String(x.warehouse_id || "")).filter(Boolean))),
        products: Array.from(new Set(raw.map((x: any) => String(x.product_id || "")).filter(Boolean))),
      });
      rows = raw.map((row: any) => {
        const warehouseId = String(row.warehouse_id || "");
        const productId = String(row.product_id || "");
        return {
          warehouse_name: lookup.byWarehouse.get(warehouseId) || warehouseId,
          product_name: lookup.byProduct.get(productId) || productId,
          variety_name: "-",
          reproduction_name: "-",
          batch_id: null,
          batch_class: "commodity",
          quantity: Number(row.quantity || 0),
        };
      });
    } else {
      throw new Error(identityRes.error.message);
    }

    const filtered = applyTextFilter(rows, searchQuery).slice(0, 120);

    return {
      title: "Складские остатки",
      rows: filtered,
      source: {
        module: "warehouses",
        tableOrView: viewName,
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
      summary: `Найдено строк: ${filtered.length}`,
    };
  },
};

const getInventoryTool: AssistantToolDefinition = {
  ...getWarehouseBalancesTool,
  name: "get_inventory",
  description: "Alias для get_warehouse_balances",
};

const getWarehouseMovementsTool: AssistantToolDefinition = {
  name: "get_warehouse_movements",
  description: "Последние движения ledger по складам",
  domains: ["ledger", "warehouses", "inventory"],
  run: async (context) => {
    const limit = Math.max(1, Math.min(Number(context.intent.parameters.limit || 30), 100));
    const res = await context.supabase
      .from("stock_ledger_entries")
      .select("*")
      .eq("company_id", context.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (res.error) throw new Error(res.error.message);
    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      warehouses: Array.from(new Set(raw.map((x: any) => String(x.warehouse_id || "")).filter(Boolean))),
      products: Array.from(new Set(raw.map((x: any) => String(x.product_id || "")).filter(Boolean))),
      varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
      reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
    });

    const rows = raw.map((row: any) => {
      const warehouseId = String(row.warehouse_id || "");
      const productId = String(row.product_id || "");
      const varietyId = cleanString(row.variety_id);
      const reproductionId = cleanString(row.reproduction_id);
      const qtyAbs = Number(
        row.qty_abs ?? row.quantity ?? (row.delta_qty_signed != null ? Math.abs(Number(row.delta_qty_signed || 0)) : 0)
      );
      return {
        date: String(row.created_at || row.occurred_at || ""),
        direction: String(row.direction || "-"),
        quantity: Number.isFinite(qtyAbs) ? qtyAbs : 0,
        warehouse_name: lookup.byWarehouse.get(warehouseId) || warehouseId,
        product_name: lookup.byProduct.get(productId) || productId,
        variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
        reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
        batch_class: cleanString(row.batch_class) || "commodity",
        reason: cleanString(row.reason_type || row.reason) || "-",
        ticket_id: cleanString(row.ticket_id),
      };
    });

    return {
      title: "Последние движения склада",
      rows,
      source: {
        module: "ledger",
        tableOrView: "stock_ledger_entries",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFieldsTool: AssistantToolDefinition = {
  name: "get_fields",
  description: "Список полей",
  domains: ["fields"],
  run: async (context) => {
    const searchQuery = parseSearchQuery(context);
    const res = await context.supabase
      .from("fields")
      .select("id,name,notes,area,archived")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("name", { ascending: true })
      .limit(300);

    if (res.error) throw new Error(res.error.message);

    const rows = applyTextFilter(
      (res.data || []).map((row: any) => ({
        field_id: String(row.id),
        field_name: getFieldDisplayName(row) || String(row.id),
        area_ha: Number(row.area || 0),
      })),
      searchQuery
    ).slice(0, 120);

    return {
      title: "Поля компании",
      rows,
      source: {
        module: "fields",
        tableOrView: "fields",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getCropStructureTool: AssistantToolDefinition = {
  name: "get_crop_structure",
  description: "Структура посевов",
  domains: ["crop_structure", "fields"],
  run: async (context) => {
    const season =
      cleanString(context.runtimeContext.season) ||
      context.sessionState.lastSeason ||
      (await getCurrentSeason(context.companyId, context));

    let query = context.supabase
      .from("crop_structure")
      .select("id,field_id,crop_id,variety_id,reproduction_id,season_year,area")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("season_year", { ascending: false })
      .limit(400);

    if (season) query = query.eq("season_year", season);
    const res = await query;
    if (res.error) throw new Error(res.error.message);

    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      fields: Array.from(new Set(raw.map((x: any) => String(x.field_id || "")).filter(Boolean))),
      products: Array.from(new Set(raw.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
      reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
    });

    const rows = raw.map((row: any) => {
      const fieldId = String(row.field_id || "");
      const cropId = String(row.crop_id || "");
      const varietyId = cleanString(row.variety_id);
      const reproductionId = cleanString(row.reproduction_id);
      return {
        allocation_id: String(row.id),
        season_year: String(row.season_year || "-"),
        field_name: lookup.byField.get(fieldId) || fieldId,
        crop_name: lookup.byProduct.get(cropId) || cropId,
        variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
        reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
        area_ha: Number(row.area || 0),
      };
    });

    return {
      title: "Структура посевов",
      rows: rows.slice(0, 160),
      source: {
        module: "crop_structure",
        tableOrView: "crop_structure",
        season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getWeighbridgeTicketsTool: AssistantToolDefinition = {
  name: "get_weighbridge_tickets",
  description: "Последние талоны весовой",
  domains: ["weighbridge", "tickets"],
  run: async (context) => {
    const status = cleanString(context.intent.parameters.status);
    let query = context.supabase
      .from("tickets")
      .select("id,ticket_no,status,op_type,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg")
      .eq("company_id", context.companyId)
      .eq("is_voided", false)
      .order("created_at", { ascending: false })
      .limit(80);
    if (status) query = query.eq("status", status);
    const res = await query;
    if (res.error) throw new Error(res.error.message);

    return {
      title: "Талоны весовой",
      rows: (res.data || []).map((row: any) => ({
        ticket_no: String(row.ticket_no || row.id),
        status: String(row.status || "-"),
        operation: String(row.op_type || "-"),
        gross_kg: Number(row.gross_weight_kg || 0),
        tare_kg: Number(row.tare_weight_kg || 0),
        net_kg: Number(row.net_weight_kg || 0),
        date: String(row.created_at || ""),
      })),
      source: {
        module: "weighbridge",
        tableOrView: "tickets",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getOperationsTool: AssistantToolDefinition = {
  name: "get_operations",
  description: "Последние операции",
  domains: ["operations", "fields"],
  run: async (context) => {
    const res = await context.supabase
      .from("operations")
      .select("id,date,operation_type,field_id,notes")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("date", { ascending: false })
      .limit(80);
    if (res.error) throw new Error(res.error.message);
    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      fields: Array.from(new Set(raw.map((x: any) => String(x.field_id || "")).filter(Boolean))),
    });

    return {
      title: "Операции",
      rows: raw.map((row: any) => {
        const fieldId = String(row.field_id || "");
        return {
          date: String(row.date || ""),
          operation_type: String(row.operation_type || "-"),
          field_name: lookup.byField.get(fieldId) || fieldId,
          notes: cleanString(row.notes),
        };
      }),
      source: {
        module: "operations",
        tableOrView: "operations",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFuelSourcesTool: AssistantToolDefinition = {
  name: "get_fuel_sources",
  description: "Источники топлива",
  domains: ["fuel"],
  run: async (context) => {
    const searchQuery = parseSearchQuery(context);
    const res = await context.supabase
      .from("fuel_sources")
      .select("id,name,fuel_type,source_type,current_balance_liters,is_active,archived")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("name", { ascending: true })
      .limit(200);
    if (res.error) throw new Error(res.error.message);
    const rows = applyTextFilter(
      (res.data || []).map((row: any) => ({
        fuel_source_id: String(row.id),
        fuel_source_name: String(row.name || row.id),
        fuel_type: String(row.fuel_type || ""),
        source_type: String(row.source_type || ""),
        balance_liters: Number(row.current_balance_liters || 0),
        is_active: Boolean(row.is_active),
      })),
      searchQuery
    ).slice(0, 80);
    return {
      title: "Источники ГСМ",
      rows,
      source: {
        module: "fuel",
        tableOrView: "fuel_sources",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFuelBalancesTool: AssistantToolDefinition = {
  name: "get_fuel_balances",
  description: "Остатки топлива по ёмкостям",
  domains: ["fuel"],
  run: async (context) => {
    const rowsOutput = await getFuelSourcesTool.run(context);
    return {
      ...rowsOutput,
      name: undefined as any,
      title: "Остатки топлива",
      rows: rowsOutput.rows.map((row) => ({
        fuel_source_name: row.fuel_source_name,
        fuel_type: row.fuel_type,
        balance_liters: row.balance_liters,
      })),
      source: {
        ...rowsOutput.source,
        tableOrView: "fuel_sources",
      },
    };
  },
};

const getFuelMovementsTool: AssistantToolDefinition = {
  name: "get_fuel_movements",
  description: "Последние движения ГСМ",
  domains: ["fuel"],
  run: async (context) => {
    const [issuesRes, transfersRes, refillsRes] = await Promise.all([
      context.supabase
        .from("fuel_issues")
        .select("id,issued_at,fuel_source_id,vehicle_id,mechanizator_id,liters")
        .eq("company_id", context.companyId)
        .order("issued_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("fuel_transfers")
        .select("id,transferred_at,from_fuel_source_id,to_fuel_source_id,liters")
        .eq("company_id", context.companyId)
        .order("transferred_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("fuel_refills")
        .select("id,refill_at,fuel_source_id,counterparty_id,liters,document_no")
        .eq("company_id", context.companyId)
        .order("refill_at", { ascending: false })
        .limit(20),
    ]);

    const allSourceIds = new Set<string>();
    (issuesRes.data || []).forEach((row: any) => cleanString(row.fuel_source_id) && allSourceIds.add(String(row.fuel_source_id)));
    (transfersRes.data || []).forEach((row: any) => {
      cleanString(row.from_fuel_source_id) && allSourceIds.add(String(row.from_fuel_source_id));
      cleanString(row.to_fuel_source_id) && allSourceIds.add(String(row.to_fuel_source_id));
    });
    (refillsRes.data || []).forEach((row: any) => cleanString(row.fuel_source_id) && allSourceIds.add(String(row.fuel_source_id)));
    const lookup = await buildLookupMaps(context, { fuelSources: Array.from(allSourceIds) });

    const rows: Array<Record<string, unknown>> = [];
    if (!issuesRes.error) {
      (issuesRes.data || []).forEach((row: any) => {
        rows.push({
          type: "issue",
          date: String(row.issued_at || ""),
          liters: Number(row.liters || 0),
          fuel_source_name: lookup.byFuelSource.get(String(row.fuel_source_id || "")) || String(row.fuel_source_id || ""),
        });
      });
    }
    if (!transfersRes.error) {
      (transfersRes.data || []).forEach((row: any) => {
        rows.push({
          type: "transfer",
          date: String(row.transferred_at || ""),
          liters: Number(row.liters || 0),
          from_fuel_source_name:
            lookup.byFuelSource.get(String(row.from_fuel_source_id || "")) || String(row.from_fuel_source_id || ""),
          to_fuel_source_name: lookup.byFuelSource.get(String(row.to_fuel_source_id || "")) || String(row.to_fuel_source_id || ""),
        });
      });
    }
    if (!refillsRes.error) {
      (refillsRes.data || []).forEach((row: any) => {
        rows.push({
          type: "refill",
          date: String(row.refill_at || ""),
          liters: Number(row.liters || 0),
          fuel_source_name: lookup.byFuelSource.get(String(row.fuel_source_id || "")) || String(row.fuel_source_id || ""),
          document_no: cleanString(row.document_no),
        });
      });
    }
    rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    return {
      title: "Движения ГСМ",
      rows: rows.slice(0, 40),
      source: {
        module: "fuel",
        tableOrView: "fuel_issues + fuel_transfers + fuel_refills",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getBatchesTool: AssistantToolDefinition = {
  name: "get_batches",
  description: "Партии склада",
  domains: ["batches", "inventory", "identity"],
  run: async (context) => {
    const queryText = parseSearchQuery(context);
    const res = await context.supabase
      .from("inventory_batches")
      .select("id,batch_code,crop_id,variety_id,reproduction_id,batch_class,origin_type,supplier_lot,created_at")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(160);
    if (res.error) throw new Error(res.error.message);

    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      products: Array.from(new Set(raw.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
      reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
    });
    const rows = raw.map((row: any) => {
      const cropId = cleanString(row.crop_id);
      const varietyId = cleanString(row.variety_id);
      const reproductionId = cleanString(row.reproduction_id);
      return {
        batch_code: cleanString(row.batch_code),
        crop_name: cropId ? lookup.byProduct.get(cropId) || cropId : "-",
        variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
        reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
        batch_class: cleanString(row.batch_class) || "commodity",
        origin_type: cleanString(row.origin_type) || "-",
        supplier_lot: cleanString(row.supplier_lot),
        date: String(row.created_at || ""),
      };
    });

    return {
      title: "Партии",
      rows: applyTextFilter(rows, queryText).slice(0, 100),
      source: {
        module: "batches",
        tableOrView: "inventory_batches",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

async function resolveWarehouseByName(context: AssistantToolContext) {
  const query = parseSearchQuery(context);
  if (!query) {
    return {
      title: "Поиск склада",
      rows: [],
      source: { module: "assistant", tableOrView: "resolve_warehouse_by_name", fetchedAt: nowIso() },
      summary: "Уточните название склада.",
    };
  }

  const res = await context.supabase
    .from("warehouses")
    .select("id,name")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .ilike("name", `%${query}%`)
    .limit(5);
  if (res.error) throw new Error(res.error.message);

  return {
    title: "Найденные склады",
    rows: (res.data || []).map((row: any) => ({
      entity_type: "warehouse",
      entity_id: String(row.id),
      entity_name: String(row.name || row.id),
      page: "warehouses",
      route: "/warehouses",
      filters: { search: String(row.name || query) },
    })),
    source: { module: "assistant", tableOrView: "resolve_warehouse_by_name", fetchedAt: nowIso() },
  };
}

async function resolveFieldByNumber(context: AssistantToolContext) {
  const query = parseSearchQuery(context);
  if (!query) {
    return {
      title: "Поиск поля",
      rows: [],
      source: { module: "assistant", tableOrView: "resolve_field_by_number", fetchedAt: nowIso() },
      summary: "Уточните код/название поля.",
    };
  }

  const res = await context.supabase
    .from("fields")
    .select("id,name")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .ilike("name", `%${query}%`)
    .limit(5);
  if (res.error) throw new Error(res.error.message);

  return {
    title: "Найденные поля",
    rows: (res.data || []).map((row: any) => ({
      entity_type: "field",
      entity_id: String(row.id),
      entity_name: String(row.name || row.id),
      page: "fields",
      route: "/fields",
      filters: { search: String(row.name || query) },
    })),
    source: { module: "assistant", tableOrView: "resolve_field_by_number", fetchedAt: nowIso() },
  };
}

async function resolveFuelSourceByName(context: AssistantToolContext) {
  const query = parseSearchQuery(context);
  if (!query) {
    return {
      title: "Поиск источника топлива",
      rows: [],
      source: { module: "assistant", tableOrView: "resolve_fuel_source_by_name", fetchedAt: nowIso() },
      summary: "Уточните название ёмкости/АЗС.",
    };
  }

  const res = await context.supabase
    .from("fuel_sources")
    .select("id,name")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .ilike("name", `%${query}%`)
    .limit(5);
  if (res.error) throw new Error(res.error.message);

  return {
    title: "Найденные источники ГСМ",
    rows: (res.data || []).map((row: any) => ({
      entity_type: "fuel",
      entity_id: String(row.id),
      entity_name: String(row.name || row.id),
      page: "fuel",
      route: "/fuel",
      filters: { search: String(row.name || query) },
    })),
    source: { module: "assistant", tableOrView: "resolve_fuel_source_by_name", fetchedAt: nowIso() },
  };
}

const resolvePageOrModuleTool: AssistantToolDefinition = {
  name: "resolve_page_or_module",
  description: "Резолв модуля/страницы по тексту",
  domains: ["navigation"],
  run: async (context) => {
    const query = parseSearchQuery(context) || "";
    return {
      title: "Резолв страницы",
      rows: [
        {
          query,
          page: cleanString(context.intent.parameters.page) || context.runtimeContext.currentPage || "dashboard",
          route: cleanString(context.intent.parameters.route) || "/dashboard",
        },
      ],
      source: { module: "assistant", tableOrView: "resolve_page_or_module", fetchedAt: nowIso() },
    };
  },
};

const resolveCropVarietyTool: AssistantToolDefinition = {
  name: "resolve_crop_variety",
  description: "Резолв культуры/сорта",
  domains: ["reference"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    if (!query) {
      return {
        title: "Резолв культуры/сорта",
        rows: [],
        source: { module: "assistant", tableOrView: "resolve_crop_variety", fetchedAt: nowIso() },
      };
    }

    const [cropsRes, varietiesRes] = await Promise.all([
      context.supabase.from("products").select("id,name,trade_name").eq("company_id", context.companyId).ilike("name", `%${query}%`).limit(8),
      context.supabase.from("varieties").select("id,name").eq("company_id", context.companyId).ilike("name", `%${query}%`).limit(8),
    ]);

    const rows: Array<Record<string, unknown>> = [];
    if (!cropsRes.error) {
      (cropsRes.data || []).forEach((row: any) => rows.push({ entity_type: "crop", entity_id: row.id, entity_name: row.trade_name || row.name }));
    }
    if (!varietiesRes.error) {
      (varietiesRes.data || []).forEach((row: any) => rows.push({ entity_type: "variety", entity_id: row.id, entity_name: row.name }));
    }

    return {
      title: "Резолв культуры/сорта",
      rows,
      source: { module: "assistant", tableOrView: "resolve_crop_variety", fetchedAt: nowIso() },
    };
  },
};

const resolveVehicleOrEquipmentTool: AssistantToolDefinition = {
  name: "resolve_vehicle_or_equipment",
  description: "Резолв техники/машины",
  domains: ["reference", "transport"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    if (!query) {
      return {
        title: "Резолв техники",
        rows: [],
        source: { module: "assistant", tableOrView: "resolve_vehicle_or_equipment", fetchedAt: nowIso() },
      };
    }

    const res = await context.supabase
      .from("reference_vehicles")
      .select("id,name,plate_number,type")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .or(`name.ilike.%${query}%,plate_number.ilike.%${query}%`)
      .limit(10);

    if (res.error) throw new Error(res.error.message);

    return {
      title: "Резолв техники",
      rows: (res.data || []).map((row: any) => ({
        entity_type: "vehicle",
        entity_id: String(row.id),
        entity_name: String(row.name || row.id),
        plate_number: cleanString(row.plate_number),
        vehicle_type: cleanString(row.type),
      })),
      source: { module: "assistant", tableOrView: "resolve_vehicle_or_equipment", fetchedAt: nowIso() },
    };
  },
};

const resolveOperationTypeTool: AssistantToolDefinition = {
  name: "resolve_operation_type",
  description: "Резолв типа операции",
  domains: ["operations"],
  run: async (context) => ({
    title: "Резолв типа операции",
    rows: [
      {
        query: parseSearchQuery(context),
        operation_type: cleanString(context.intent.parameters.operation_type) || null,
      },
    ],
    source: { module: "assistant", tableOrView: "resolve_operation_type", fetchedAt: nowIso() },
  }),
};

function createDraftRows(kind: string, context: AssistantToolContext): Array<Record<string, unknown>> {
  const basePayload = {
    kind,
    company_id: context.companyId,
    requested_by_profile_id: context.actor.id,
    message: cleanString(context.intent.parameters.query) || cleanString(context.intent.parameters.entityQuery) || null,
    requires_confirmation: true,
    status: "draft",
  };

  return [
    {
      ...basePayload,
      draft_preview:
        "Черновик подготовлен. Проверьте обязательные поля и подтвердите выполнение вручную.",
    },
  ];
}

function makeDraftTool(name: AssistantToolName, description: string): AssistantToolDefinition {
  return {
    name,
    description,
    domains: ["actions", "drafts"],
    run: async (context) => ({
      title: "Черновик действия",
      rows: createDraftRows(name, context),
      source: {
        module: "assistant",
        tableOrView: `draft:${name}`,
        fetchedAt: nowIso(),
      },
    }),
  };
}

const navigateToPageTool: AssistantToolDefinition = {
  name: "navigate_to_page",
  description: "Навигация по странице",
  domains: ["navigation"],
  run: async (context) => {
    const route = cleanString(context.intent.parameters.route) || "/dashboard";
    const page = cleanString(context.intent.parameters.page) || "dashboard";
    const filters = cleanString(context.intent.parameters.filters);
    return {
      title: "Навигация",
      rows: [
        {
          page,
          route,
          filters: filters ? JSON.parse(filters) : {},
          hint: filters ? `Открываю страницу ${page} и применяю фильтр.` : `Открываю страницу ${page}.`,
        },
      ],
      source: {
        module: "assistant",
        tableOrView: "navigate_to_page",
        fetchedAt: nowIso(),
      },
    };
  },
};

const openEntityTool: AssistantToolDefinition = {
  name: "open_entity",
  description: "Навигация к сущности",
  domains: ["navigation"],
  run: async (context) => ({
    title: "Открытие сущности",
    rows: [
      {
        entity_type: cleanString(context.intent.parameters.entityType),
        entity_query: cleanString(context.intent.parameters.entityQuery),
      },
    ],
    source: { module: "assistant", tableOrView: "open_entity", fetchedAt: nowIso() },
  }),
};

const applyFilterTool: AssistantToolDefinition = {
  name: "apply_filter",
  description: "Применение фильтра",
  domains: ["navigation"],
  run: async (context) => ({
    title: "Применение фильтра",
    rows: [
      {
        page: cleanString(context.intent.parameters.page),
        route: cleanString(context.intent.parameters.route),
        filters: cleanString(context.intent.parameters.filters),
      },
    ],
    source: { module: "assistant", tableOrView: "apply_filter", fetchedAt: nowIso() },
  }),
};

const resolveWarehouseByNameTool: AssistantToolDefinition = {
  name: "resolve_warehouse_by_name",
  description: "Найти склад по названию",
  domains: ["navigation", "warehouses"],
  run: resolveWarehouseByName,
};

const resolveFieldByNumberTool: AssistantToolDefinition = {
  name: "resolve_field_by_number",
  description: "Найти поле по коду/названию",
  domains: ["navigation", "fields"],
  run: resolveFieldByNumber,
};

const resolveFuelSourceByNameTool: AssistantToolDefinition = {
  name: "resolve_fuel_source_by_name",
  description: "Найти источник ГСМ по названию",
  domains: ["navigation", "fuel"],
  run: resolveFuelSourceByName,
};

const getCurrentContextToolAlias: AssistantToolDefinition = {
  name: "get_current_context",
  description: "Текущий контекст страницы/компании/сезона",
  domains: ["assistant", "context"],
  run: async (context) => ({
    title: "Текущий контекст",
    rows: [
      {
        company_id: context.companyId,
        page: context.runtimeContext.currentPage,
        route: context.runtimeContext.currentRoute,
        season: context.runtimeContext.season,
        locale: context.runtimeContext.locale || "ru",
      },
    ],
    source: {
      module: "assistant",
      tableOrView: "runtime_context",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const getRoutesToolAlias: AssistantToolDefinition = {
  name: "get_routes",
  description: "Маршруты основных модулей Travkin Flow",
  domains: ["navigation", "assistant"],
  run: async (context) => ({
    title: "Маршруты",
    rows: [
      { name: "Панель", route: "/dashboard" },
      { name: "Весовая", route: "/weighbridge" },
      { name: "Склады", route: "/warehouses" },
      { name: "Операции", route: "/operations" },
      { name: "Поля", route: "/fields" },
      { name: "Кадастр и право", route: "/land-legal" },
      { name: "Пользователи", route: "/users" },
      { name: "Отчеты", route: "/analytics" },
    ],
    source: {
      module: "assistant",
      tableOrView: "route_map",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const findFieldToolAlias: AssistantToolDefinition = {
  name: "find_field",
  description: "Найти поле",
  domains: ["fields", "navigation"],
  run: resolveFieldByNumber,
};

const findWarehouseToolAlias: AssistantToolDefinition = {
  name: "find_warehouse",
  description: "Найти склад",
  domains: ["warehouses", "navigation"],
  run: resolveWarehouseByName,
};

const findOperationToolAlias: AssistantToolDefinition = {
  name: "find_operation",
  description: "Найти операции по фильтру",
  domains: ["operations"],
  run: async (context) => {
    const output = await getOperationsTool.run(context);
    const query = parseSearchQuery(context);
    return {
      ...output,
      rows: applyTextFilter(output.rows || [], query).slice(0, 40),
      source: {
        ...output.source,
        tableOrView: "operations (find_operation)",
      },
    };
  },
};

const getActiveOperationsToolAlias: AssistantToolDefinition = {
  name: "get_active_operations",
  description: "Активные операции компании",
  domains: ["operations"],
  run: async (context) => {
    const res = await context.supabase
      .from("operations")
      .select("id,date,operation_type,status,field_id")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("date", { ascending: false })
      .limit(120);

    if (res.error) throw new Error(res.error.message);
    const rowsRaw = res.data || [];
    const fieldsLookup = await buildLookupMaps(context, {
      fields: Array.from(new Set(rowsRaw.map((row: any) => String(row.field_id || "")).filter(Boolean))),
    });

    const rows = rowsRaw
      .filter((row: any) => {
        const status = cleanString(row.status)?.toLowerCase() || "";
        return status !== "completed" && status !== "cancelled" && status !== "verified";
      })
      .map((row: any) => ({
        operation_id: String(row.id),
        date: cleanString(row.date),
        operation_type: cleanString(row.operation_type),
        status: cleanString(row.status),
        field_name: fieldsLookup.byField.get(String(row.field_id || "")) || String(row.field_id || ""),
      }));

    return {
      title: "Активные операции",
      rows: rows.slice(0, 60),
      source: {
        module: "operations",
        tableOrView: "operations",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getWarehouseSummaryToolAlias: AssistantToolDefinition = {
  name: "get_warehouse_summary",
  description: "Сводка по складам",
  domains: ["warehouses", "inventory"],
  run: async (context) => {
    const output = await getWarehouseBalancesTool.run(context);
    const grouped = new Map<string, number>();
    (output.rows || []).forEach((row) => {
      const warehouse = cleanString(row.warehouse_name) || "—";
      const qty = Number(row.quantity || 0);
      grouped.set(warehouse, (grouped.get(warehouse) || 0) + (Number.isFinite(qty) ? qty : 0));
    });
    const rows = Array.from(grouped.entries())
      .map(([warehouse_name, quantity]) => ({ warehouse_name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 60);
    return {
      title: "Сводка складов",
      rows,
      source: {
        module: "warehouses",
        tableOrView: "v_stock_balance_identity (summary)",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getPotatoMaterialReportToolAlias: AssistantToolDefinition = {
  name: "get_potato_material_report",
  description: "Отчет по материалам картофеля",
  domains: ["reports", "operations", "warehouses"],
  run: async (context) => {
    const viewRes = await context.supabase
      .from("v_potato_material_consumption")
      .select("*")
      .eq("company_id", context.companyId)
      .order("field_display_name", { ascending: true })
      .limit(300);

    if (!viewRes.error) {
      return {
        title: "Отчет по картофелю",
        rows: (viewRes.data || []).map((row: any) => ({ ...row })),
        source: {
          module: "reports",
          tableOrView: "v_potato_material_consumption",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    }

    if (isMissingRelationError(viewRes.error.message)) {
      return {
        title: "Отчет по картофелю",
        rows: [
          {
            info: "Пока не могу открыть отчет по картофелю напрямую. Откройте Операции или Склады и уточните фильтр.",
          },
        ],
        source: {
          module: "assistant",
          tableOrView: "fallback:get_potato_material_report",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    }

    throw new Error(viewRes.error.message);
  },
};

const toolRegistry: Record<AssistantToolName, AssistantToolDefinition> = {
  get_current_context: getCurrentContextToolAlias,
  get_routes: getRoutesToolAlias,
  get_company_context: getCompanyContextTool,
  get_current_season: getCurrentSeasonTool,
  find_field: findFieldToolAlias,
  find_warehouse: findWarehouseToolAlias,
  find_operation: findOperationToolAlias,
  get_active_operations: getActiveOperationsToolAlias,
  get_potato_material_report: getPotatoMaterialReportToolAlias,
  get_warehouse_summary: getWarehouseSummaryToolAlias,
  get_fields: getFieldsTool,
  get_crop_structure: getCropStructureTool,
  get_inventory: getInventoryTool,
  get_batches: getBatchesTool,
  get_warehouse_balances: getWarehouseBalancesTool,
  get_warehouse_movements: getWarehouseMovementsTool,
  get_weighbridge_tickets: getWeighbridgeTicketsTool,
  get_operations: getOperationsTool,
  get_fuel_sources: getFuelSourcesTool,
  get_fuel_balances: getFuelBalancesTool,
  get_fuel_movements: getFuelMovementsTool,
  resolve_warehouse_by_name: resolveWarehouseByNameTool,
  resolve_field_by_number: resolveFieldByNumberTool,
  resolve_fuel_source_by_name: resolveFuelSourceByNameTool,
  resolve_page_or_module: resolvePageOrModuleTool,
  resolve_crop_variety: resolveCropVarietyTool,
  resolve_vehicle_or_equipment: resolveVehicleOrEquipmentTool,
  resolve_operation_type: resolveOperationTypeTool,
  create_operation_draft: makeDraftTool("create_operation_draft", "Создать черновик операции"),
  create_transfer_draft: makeDraftTool("create_transfer_draft", "Создать черновик перемещения"),
  create_fuel_issue_draft: makeDraftTool("create_fuel_issue_draft", "Создать черновик выдачи ГСМ"),
  create_field_task_draft: makeDraftTool("create_field_task_draft", "Создать черновик полевого задания"),
  create_material_issue_draft: makeDraftTool("create_material_issue_draft", "Создать черновик выдачи материала"),
  create_weighbridge_ticket_draft: makeDraftTool("create_weighbridge_ticket_draft", "Создать черновик талона весовой"),
  navigate_to_page: navigateToPageTool,
  open_entity: openEntityTool,
  apply_filter: applyFilterTool,
};

export function getAssistantTool(name: AssistantToolName): AssistantToolDefinition | null {
  return toolRegistry[name] || null;
}

export function getAllAssistantTools(): AssistantToolDefinition[] {
  return Object.values(toolRegistry);
}
