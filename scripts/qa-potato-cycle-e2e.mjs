#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://agri-manager-eight.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bhsemlvmkikpntabctml.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.");
  process.exit(1);
}

const USERS = {
  admin: { email: "Aimbeks@gmail.com", password: "Qqqq1111" },
  agronomist: { email: "zss010@mail.ru", password: "Qqqq1111!" },
  weighman: { email: "victorkaretnikov@mail.ru", password: "Qqqq1111!" },
  warehouse: { email: "roni._@mail.ru", password: "Qqqq1111!" },
  specialist: { email: "travkin-94@list.ru", password: "Qqqq1111!" },
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token || !payload?.user?.id) {
    throw new Error(`Auth failed for ${email}: ${payload?.msg || payload?.error_description || response.status}`);
  }
  return payload;
}

async function getProfile(token, authUserId) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set("select", "id,email,role,company_id,status");
  url.searchParams.set("id", `eq.${authUserId}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(body) || body.length === 0) {
    throw new Error("Failed to fetch profile");
  }
  return body[0];
}

async function appApi(token, pathName, init = {}) {
  const response = await fetch(`${APP_BASE_URL}${pathName}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

function buildRestUrl(table, select = "*", filters = []) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  for (const [key, value] of filters) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function restSelect(token, table, select = "*", filters = []) {
  const response = await fetch(buildRestUrl(table, select, filters), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(`rest select ${table} failed: ${JSON.stringify(body)}`);
  }
  return Array.isArray(body) ? body : [];
}

async function restInsert(token, table, rows, prefer = "return=representation") {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: JSON.stringify(rows),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`rest insert ${table} failed: ${JSON.stringify(body)}`);
  }
  return body;
}

async function restUpdate(token, table, payload, filters = []) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of filters) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`rest update ${table} failed: ${JSON.stringify(body)}`);
  }
  return body;
}

function pickFirstByNameContains(rows, key, needles) {
  const loweredNeedles = needles.map((x) => x.toLowerCase());
  return (
    rows.find((row) => {
      const text = normalizeText(row?.[key]).toLowerCase();
      return loweredNeedles.some((needle) => text.includes(needle));
    }) || null
  );
}

async function run() {
  const runTag = `QA_TEST_2026_${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const auth = {};
  const profiles = {};
  for (const [key, cred] of Object.entries(USERS)) {
    auth[key] = await signIn(cred.email, cred.password);
    profiles[key] = await getProfile(auth[key].access_token, auth[key].user.id);
  }

  const companyId = profiles.admin.company_id;
  for (const key of Object.keys(profiles)) {
    if (profiles[key].company_id !== companyId) {
      throw new Error(`User ${key} belongs to another company`);
    }
  }

  const seasons = await restSelect(auth.admin.access_token, "seasons", "id,year", [
    ["company_id", `eq.${companyId}`],
    ["year", "eq.2026"],
    ["limit", "1"],
  ]);
  if (!seasons[0]?.id) throw new Error("Season 2026 not found");
  const seasonId = seasons[0].id;

  const fields = await restSelect(auth.admin.access_token, "fields", "id,name,company_id", [
    ["company_id", `eq.${companyId}`],
    ["limit", "5000"],
  ]);
  const fieldsById = new Map(fields.map((row) => [String(row.id), row]));

  const crops = await restSelect(auth.admin.access_token, "crops", "id,name,company_id", [
    ["or", `(company_id.is.null,company_id.eq.${companyId})`],
    ["limit", "5000"],
  ]);
  const potatoCropIds = new Set(
    crops
      .filter((row) => {
        const name = normalizeText(row.name).toLowerCase();
        return name.includes("картоф") || name.includes("potato");
      })
      .map((row) => String(row.id))
  );
  if (!potatoCropIds.size) {
    throw new Error("Potato crop not found in catalogs");
  }

  const structures = await restSelect(auth.admin.access_token, "crop_structure", "id,field_id,crop_id,variety_id,reproduction_id,area,season_id,archived", [
    ["company_id", `eq.${companyId}`],
    ["season_id", `eq.${seasonId}`],
    ["archived", "eq.false"],
    ["limit", "5000"],
  ]);
  const potatoStructures = structures.filter((row) => potatoCropIds.has(String(row.crop_id || "")));
  if (!potatoStructures.length) throw new Error("No potato crop structure rows found");

  const structureWithField = potatoStructures
    .map((row) => ({
      ...row,
      field_name: normalizeText(fieldsById.get(String(row.field_id))?.name),
      area_num: toNum(row.area),
    }))
    .filter((row) => row.field_name);

  const identityStructures = structureWithField.filter(
    (row) => row.variety_id && row.reproduction_id
  );
  const preferredStructure =
    identityStructures.find((row) => row.field_name.includes("28")) ||
    identityStructures.sort((a, b) => b.area_num - a.area_num)[0] ||
    structureWithField.find((row) => row.field_name.includes("28")) ||
    structureWithField.sort((a, b) => b.area_num - a.area_num)[0];
  if (!preferredStructure?.id) throw new Error("No suitable potato field found");

  const varieties = await restSelect(auth.admin.access_token, "varieties", "id,name,crop_id", [
    ["or", `(company_id.is.null,company_id.eq.${companyId})`],
    ["limit", "5000"],
  ]);
  const reproductions = await restSelect(auth.admin.access_token, "seed_reproductions", "id,name", [
    ["or", `(company_id.is.null,company_id.eq.${companyId})`],
    ["limit", "5000"],
  ]);
  const galaVariety = pickFirstByNameContains(varieties, "name", ["гала", "gala"]);
  const balticVariety = pickFirstByNameContains(varieties, "name", ["baltic", "rose"]);
  const eliteRepro = pickFirstByNameContains(reproductions, "name", ["элит"]);
  const firstRepro = pickFirstByNameContains(reproductions, "name", ["первая"]);
  if (!galaVariety?.id || !balticVariety?.id || !eliteRepro?.id || !firstRepro?.id) {
    throw new Error("Variety/reproduction catalog is incomplete for potato lines");
  }

  const operationInsert = await restInsert(auth.agronomist.access_token, "operations", [
    {
      field_id: preferredStructure.field_id,
      crop_structure_id: preferredStructure.id,
      operation_type: "planting",
      date: new Date().toISOString().slice(0, 10),
      notes: `${runTag} Посадка картофеля`,
      user_id: auth.agronomist.user.id,
      company_id: companyId,
      status: "planned",
      work_status: "active",
      responsible_user_id: profiles.specialist.id,
    },
  ]);
  const operation = Array.isArray(operationInsert) ? operationInsert[0] : operationInsert;
  if (!operation?.id) throw new Error("Failed to create operation");

  const lineDrafts = [
    {
      planned_area_ha: 3,
      variety_id: galaVariety.id,
      reproduction_id: eliteRepro.id,
      row_spacing_m: 0.75,
      seed_spacing_cm: 30,
      notes: `${runTag} line-1`,
    },
    {
      planned_area_ha: 3,
      variety_id: balticVariety.id,
      reproduction_id: eliteRepro.id,
      row_spacing_m: 0.75,
      seed_spacing_cm: 30,
      notes: `${runTag} line-2`,
    },
    {
      planned_area_ha: 4,
      variety_id: galaVariety.id,
      reproduction_id: firstRepro.id,
      row_spacing_m: 0.75,
      seed_spacing_cm: 28,
      notes: `${runTag} line-3`,
    },
  ];

  const createdLines = [];
  for (const line of lineDrafts) {
    const lineRes = await appApi(auth.agronomist.access_token, `/api/operations/${operation.id}/lines`, {
      method: "POST",
      body: JSON.stringify({
        companyId,
        field_id: preferredStructure.field_id,
        crop_id: preferredStructure.crop_id,
        ...line,
      }),
    });
    if (!lineRes.ok || !lineRes.body?.operation_line?.id) {
      throw new Error(`Failed to create operation line: ${JSON.stringify(lineRes.body)}`);
    }
    createdLines.push(lineRes.body.operation_line);
  }

  const warehouseRows = await restSelect(auth.admin.access_token, "warehouses", "id,name,warehouse_type,company_id,is_archived,archived", [
    ["company_id", `eq.${companyId}`],
    ["or", `(name.ilike.*QA_TEST_2026*,is_archived.eq.false)`],
    ["limit", "5000"],
  ]);
  const qaWarehouses = warehouseRows.filter((row) => normalizeText(row.name).includes("QA_TEST_2026"));
  const warehouseByType = new Map(qaWarehouses.map((row) => [String(row.warehouse_type || "").toLowerCase(), row]));
  const seedWarehouse = warehouseByType.get("seed");
  const fertWarehouse = warehouseByType.get("fertilizer");
  const pzrWarehouse = warehouseByType.get("pesticide");
  const vegetableWarehouse = warehouseByType.get("vegetable");
  const temporaryWarehouse = warehouseByType.get("temporary");
  if (!seedWarehouse?.id || !fertWarehouse?.id || !pzrWarehouse?.id || !vegetableWarehouse?.id || !temporaryWarehouse?.id) {
    throw new Error("Required QA warehouses not found");
  }

  const products = await restSelect(auth.admin.access_token, "products", "id,name,type,unit,company_id", [
    ["company_id", `eq.${companyId}`],
    ["limit", "5000"],
  ]);
  const seedProduct = pickFirstByNameContains(products, "name", ["qa_test_2026", "картофель семенной"]) || products.find((p) => p.type === "seed");
  const fertProduct = pickFirstByNameContains(products, "name", ["npk", "map", "dap"]) || products.find((p) => p.type === "fertilizer");
  const pzrProduct = pickFirstByNameContains(products, "name", ["actara", "amistar", "ridomil"]) || products.find((p) => p.type === "pesticide");
  const harvestProduct =
    products.find((p) => {
      const name = normalizeText(p.name).toLowerCase();
      const type = normalizeText(p.type).toLowerCase();
      return (name.includes("картоф") || name.includes("potato")) && ["produce", "crop", "material"].includes(type);
    }) ||
    products.find((p) => {
      const name = normalizeText(p.name).toLowerCase();
      return name.includes("картоф") || name.includes("potato");
    }) ||
    seedProduct;
  if (!seedProduct?.id || !fertProduct?.id || !pzrProduct?.id || !harvestProduct?.id) {
    throw new Error("Missing products for QA supplier receipts");
  }

  const counterparties = await restSelect(auth.admin.access_token, "counterparties", "id,name,counterparty_type,is_active,archived", [
    ["company_id", `eq.${companyId}`],
    ["counterparty_type", "eq.supplier"],
    ["is_active", "eq.true"],
    ["archived", "eq.false"],
    ["limit", "1"],
  ]);
  if (!counterparties[0]?.id) throw new Error("No active supplier counterparty found");
  const supplierId = counterparties[0].id;

  const harvestDriverId = String(profiles.weighman.id || profiles.specialist.id || "").trim();
  if (!harvestDriverId) {
    throw new Error("No profile id available for harvest_incoming driver_id");
  }

  const vehicles = await restSelect(auth.admin.access_token, "reference_vehicles", "id,name,plate_number,status,is_active,archived,company_id", [
    ["company_id", `eq.${companyId}`],
    ["limit", "500"],
  ]);
  const harvestVehicle =
    vehicles.find((row) => row.is_active !== false && row.archived !== true && ["free", "idle", ""].includes(String(row.status || "").toLowerCase())) ||
    vehicles.find((row) => row.is_active !== false && row.archived !== true) ||
    null;
  if (!harvestVehicle?.id) {
    throw new Error("No active vehicle found for harvest_incoming flow");
  }

  const shiftRes = await appApi(auth.weighman.access_token, "/api/weighbridge/shifts", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      openingNote: `${runTag} auto open`,
    }),
  });
  if (!shiftRes.ok || !shiftRes.body?.shift?.id) {
    throw new Error(`Failed to open/resolve weighbridge shift: ${JSON.stringify(shiftRes.body)}`);
  }

  async function createAndFinalizeSupplierReceipt(args) {
    const createRes = await appApi(auth.weighman.access_token, "/api/weighbridge/tickets", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        ticket: {
          ticket_type: "movement",
          op_type: "supplier_receipt",
          direction: "incoming",
          source_kind: "supplier",
          destination_kind: "warehouse",
          supplier_id: supplierId,
          warehouse_to_id: args.warehouseId,
          receipt_mode: "direct",
          supplier_receipt_kind: "generic",
          gross_weight_kg: args.quantity,
          notes: `${runTag} supplier receipt ${args.key}`,
        },
        lines: [
          {
            product_id: args.productId,
            quantity: args.quantity,
            uom: args.uom || "kg",
            lot_id: `${runTag}-${args.key}`,
            batch_class: "commodity",
          },
        ],
      }),
    });
    if (!createRes.ok || !createRes.body?.ticket?.id) {
      throw new Error(`Supplier receipt create failed (${args.key}): ${JSON.stringify(createRes.body)}`);
    }
    const ticketId = createRes.body.ticket.id;
    const finalizeRes = await appApi(auth.weighman.access_token, `/api/weighbridge/tickets/${ticketId}/finalize`, {
      method: "POST",
      body: JSON.stringify({ companyId }),
    });
    if (!finalizeRes.ok) {
      throw new Error(`Supplier receipt finalize failed (${args.key}): ${JSON.stringify(finalizeRes.body)}`);
    }
    return ticketId;
  }

  const supplierReceiptTickets = [];
  supplierReceiptTickets.push(
    await createAndFinalizeSupplierReceipt({
      key: "seed",
      warehouseId: seedWarehouse.id,
      productId: seedProduct.id,
      quantity: 900,
      uom: seedProduct.unit || "kg",
    })
  );
  supplierReceiptTickets.push(
    await createAndFinalizeSupplierReceipt({
      key: "fertilizer",
      warehouseId: fertWarehouse.id,
      productId: fertProduct.id,
      quantity: 700,
      uom: fertProduct.unit || "kg",
    })
  );
  supplierReceiptTickets.push(
    await createAndFinalizeSupplierReceipt({
      key: "pesticide",
      warehouseId: pzrWarehouse.id,
      productId: pzrProduct.id,
      quantity: 120,
      uom: pzrProduct.unit || "l",
    })
  );

  const stockIdentity = await restSelect(auth.admin.access_token, "v_stock_balance_identity", "warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity", [
    ["company_id", `eq.${companyId}`],
    ["quantity", "gt.0"],
    ["limit", "5000"],
  ]);

  function pickIdentity(warehouseId, productId) {
    const rows = stockIdentity
      .filter((row) => String(row.warehouse_id) === String(warehouseId) && String(row.product_id) === String(productId))
      .sort((a, b) => toNum(b.quantity) - toNum(a.quantity));
    return rows[0] || null;
  }

  const seedIdentity = pickIdentity(seedWarehouse.id, seedProduct.id);
  const fertIdentity = pickIdentity(fertWarehouse.id, fertProduct.id);
  const pzrIdentity = pickIdentity(pzrWarehouse.id, pzrProduct.id);
  if (!seedIdentity || !fertIdentity || !pzrIdentity) {
    throw new Error("Stock identities not found after supplier receipts");
  }

  async function createAndFinalizeFieldIssue(args) {
    const createRes = await appApi(auth.weighman.access_token, "/api/weighbridge/tickets", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        ticket: {
          ticket_type: "movement",
          op_type: "issue_to_field",
          direction: "outgoing",
          source_kind: "warehouse",
          destination_kind: "field",
          field_id: preferredStructure.field_id,
          crop_structure_allocation_id: preferredStructure.id,
          warehouse_from_id: args.warehouseId,
          weigh_method: "manual_override_with_reason",
          gross_weight_kg: args.quantity,
          tare_weight_kg: 0,
          linked_operation_id: operation.id,
          field_material_category: args.materialCategory,
          notes: `${runTag} issue ${args.key}`,
        },
        lines: [
          {
            product_id: args.productId,
            crop_id: preferredStructure.crop_id,
            quantity: args.quantity,
            uom: args.uom || "kg",
            variety_id: args.identity.variety_id || null,
            reproduction_id: args.identity.reproduction_id || null,
            batch_id: args.identity.batch_id || null,
            batch_class: args.identity.batch_class || "commodity",
            operation_line_id: args.operationLineId,
          },
        ],
      }),
    });
    if (!createRes.ok || !createRes.body?.ticket?.id) {
      throw new Error(`Field issue create failed (${args.key}): ${JSON.stringify(createRes.body)}`);
    }
    const ticketId = createRes.body.ticket.id;
    const finalizeRes = await appApi(auth.weighman.access_token, `/api/weighbridge/tickets/${ticketId}/finalize`, {
      method: "POST",
      body: JSON.stringify({ companyId }),
    });
    if (!finalizeRes.ok) {
      throw new Error(`Field issue finalize failed (${args.key}): ${JSON.stringify(finalizeRes.body)}`);
    }
    return ticketId;
  }

  const fieldIssueTickets = [];
  fieldIssueTickets.push(
    await createAndFinalizeFieldIssue({
      key: "seed_other",
      warehouseId: seedWarehouse.id,
      productId: seedProduct.id,
      identity: seedIdentity,
      quantity: 360,
      uom: seedProduct.unit || "kg",
      materialCategory: "other",
      operationLineId: createdLines[0].id,
    })
  );
  fieldIssueTickets.push(
    await createAndFinalizeFieldIssue({
      key: "fertilizer",
      warehouseId: fertWarehouse.id,
      productId: fertProduct.id,
      identity: fertIdentity,
      quantity: 210,
      uom: fertProduct.unit || "kg",
      materialCategory: "fertilizer",
      operationLineId: createdLines[1].id,
    })
  );
  fieldIssueTickets.push(
    await createAndFinalizeFieldIssue({
      key: "crop_protection",
      warehouseId: pzrWarehouse.id,
      productId: pzrProduct.id,
      identity: pzrIdentity,
      quantity: 45,
      uom: pzrProduct.unit || "l",
      materialCategory: "crop_protection",
      operationLineId: createdLines[2].id,
    })
  );

  const harvestIncomingTickets = [];
  const transferTickets = [];
  let harvestAllocation =
    structureWithField.find(
      (row) =>
        String(row.field_id || "") === String(preferredStructure.field_id || "") &&
        String(row.crop_id || "") === String(preferredStructure.crop_id || "") &&
        row.variety_id &&
        row.reproduction_id
    ) || null;

  let harvestAllocationAutoCreated = false;
  let harvestAllocationCreateError = null;
  if (!harvestAllocation && createdLines[0]?.variety_id && createdLines[0]?.reproduction_id) {
    const areaForHarvest = Math.max(1, Math.min(5, toNum(preferredStructure.area_num || preferredStructure.area)));
    let insertedAllocation = [];
    try {
      insertedAllocation = await restInsert(auth.agronomist.access_token, "crop_structure", [
        {
          company_id: companyId,
          season_id: seasonId,
          field_id: preferredStructure.field_id,
          crop_id: preferredStructure.crop_id,
          variety_id: createdLines[0].variety_id,
          reproduction_id: createdLines[0].reproduction_id,
          area: areaForHarvest,
          status: "planned",
          notes: `${runTag} harvest allocation bootstrap`,
          user_id: auth.agronomist.user.id,
          archived: false,
        },
      ]);
    } catch (error) {
      harvestAllocationCreateError = error instanceof Error ? error.message : String(error);
    }

    const createdAllocation = Array.isArray(insertedAllocation) ? insertedAllocation[0] : null;
    if (createdAllocation?.id) {
      harvestAllocationAutoCreated = true;
      harvestAllocation = {
        ...createdAllocation,
        field_name: preferredStructure.field_name,
        area_num: toNum(createdAllocation.area),
      };
    }
  }

  if (harvestAllocation?.id) {
    const harvestQuantityKg = 520;
    const harvestCreateRes = await appApi(auth.weighman.access_token, "/api/weighbridge/tickets", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        ticket: {
          ticket_type: "movement",
          op_type: "harvest_incoming",
          direction: "incoming",
          source_kind: "field",
          destination_kind: "warehouse",
          field_id: harvestAllocation.field_id,
          crop_structure_allocation_id: harvestAllocation.id,
          warehouse_to_id: vegetableWarehouse.id,
          driver_id: harvestDriverId,
          vehicle_id: harvestVehicle.id,
          gross_weight_kg: harvestQuantityKg,
          tare_weight_kg: 0,
          weigh_method: "manual_override_with_reason",
          linked_operation_id: operation.id,
          notes: `${runTag} harvest incoming`,
        },
        lines: [
          {
            product_id: harvestProduct.id,
            crop_id: harvestAllocation.crop_id,
            variety_id: harvestAllocation.variety_id,
            reproduction_id: harvestAllocation.reproduction_id,
            quantity: harvestQuantityKg,
            uom: harvestProduct.unit || "kg",
            batch_class: "commodity",
            lot_id: `${runTag}-harvest`,
          },
        ],
      }),
    });
    if (!harvestCreateRes.ok || !harvestCreateRes.body?.ticket?.id) {
      throw new Error(`Harvest incoming create failed: ${JSON.stringify(harvestCreateRes.body)}`);
    }
    const harvestTicketId = harvestCreateRes.body.ticket.id;
    const harvestFinalizeRes = await appApi(auth.weighman.access_token, `/api/weighbridge/tickets/${harvestTicketId}/finalize`, {
      method: "POST",
      body: JSON.stringify({ companyId }),
    });
    if (!harvestFinalizeRes.ok) {
      throw new Error(`Harvest incoming finalize failed: ${JSON.stringify(harvestFinalizeRes.body)}`);
    }
    harvestIncomingTickets.push(harvestTicketId);

    const refreshedStockIdentity = await restSelect(
      auth.admin.access_token,
      "v_stock_balance_identity",
      "warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity",
      [
        ["company_id", `eq.${companyId}`],
        ["warehouse_id", `eq.${vegetableWarehouse.id}`],
        ["product_id", `eq.${harvestProduct.id}`],
        ["quantity", "gt.0"],
        ["limit", "5000"],
      ]
    );

    const transferIdentity =
      refreshedStockIdentity
        .filter(
          (row) =>
            String(row.variety_id || "") === String(harvestAllocation.variety_id || "") &&
            String(row.reproduction_id || "") === String(harvestAllocation.reproduction_id || "")
        )
        .sort((a, b) => toNum(b.quantity) - toNum(a.quantity))[0] ||
      refreshedStockIdentity.sort((a, b) => toNum(b.quantity) - toNum(a.quantity))[0] ||
      null;

    if (!transferIdentity) {
      throw new Error("No stock identity found in vegetable warehouse after harvest incoming");
    }

    const availableQty = toNum(transferIdentity.quantity);
    const transferQty = Math.max(1, Math.min(120, Math.floor(availableQty / 2)));
    const transferCreateRes = await appApi(auth.weighman.access_token, "/api/weighbridge/tickets", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        ticket: {
          ticket_type: "movement",
          op_type: "warehouse_transfer",
          direction: "transfer",
          source_kind: "warehouse",
          destination_kind: "warehouse",
          warehouse_from_id: vegetableWarehouse.id,
          warehouse_to_id: temporaryWarehouse.id,
          weigh_method: "manual_override_with_reason",
          gross_weight_kg: transferQty,
          notes: `${runTag} transfer vegetable->temporary`,
        },
        lines: [
          {
            product_id: harvestProduct.id,
            quantity: transferQty,
            uom: harvestProduct.unit || "kg",
            variety_id: transferIdentity.variety_id || null,
            reproduction_id: transferIdentity.reproduction_id || null,
            batch_id: transferIdentity.batch_id || null,
            batch_class: transferIdentity.batch_class || "commodity",
            lot_id: `${runTag}-transfer`,
          },
        ],
      }),
    });
    if (!transferCreateRes.ok || !transferCreateRes.body?.ticket?.id) {
      throw new Error(`Warehouse transfer create failed: ${JSON.stringify(transferCreateRes.body)}`);
    }
    const transferTicketId = transferCreateRes.body.ticket.id;
    const transferFinalizeRes = await appApi(auth.weighman.access_token, `/api/weighbridge/tickets/${transferTicketId}/finalize`, {
      method: "POST",
      body: JSON.stringify({ companyId }),
    });
    if (!transferFinalizeRes.ok) {
      throw new Error(`Warehouse transfer finalize failed: ${JSON.stringify(transferFinalizeRes.body)}`);
    }
    transferTickets.push(transferTicketId);
  }

  const factUpdates = [
    { actual_area_ha: 2.6, row_count: 34, row_spacing_m: 0.75, seed_spacing_cm: 30, notes: `${runTag} fact-1` },
    { actual_area_ha: 2.4, row_count: 32, row_spacing_m: 0.75, seed_spacing_cm: 30, notes: `${runTag} fact-2` },
    { actual_area_ha: 3.1, row_count: 41, row_spacing_m: 0.75, seed_spacing_cm: 28, notes: `${runTag} fact-3` },
  ];
  const completedLines = [];
  for (let i = 0; i < createdLines.length; i++) {
    const line = createdLines[i];
    const payload = {
      companyId,
      ...factUpdates[i],
      completed: true,
      completed_at: nowIso(),
    };
    const patchRes = await appApi(auth.agronomist.access_token, `/api/operation-lines/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!patchRes.ok || !patchRes.body?.operation_line?.id) {
      throw new Error(`Failed to complete operation line ${line.id}: ${JSON.stringify(patchRes.body)}`);
    }
    completedLines.push(patchRes.body.operation_line);
  }

  await restUpdate(
    auth.agronomist.access_token,
    "operations",
    {
      status: "completed",
      work_status: "completed",
      completed_at: nowIso(),
      notes: `${runTag} completed`,
    },
    [
      ["id", `eq.${operation.id}`],
      ["company_id", `eq.${companyId}`],
    ]
  );

  const potatoReportRes = await appApi(
    auth.agronomist.access_token,
    `/api/operations/reports/potato-material-consumption?companyId=${encodeURIComponent(companyId)}&seasonYear=2026&limit=5000`
  );
  if (!potatoReportRes.ok || !Array.isArray(potatoReportRes.body?.rows)) {
    throw new Error(`Potato report failed: ${JSON.stringify(potatoReportRes.body)}`);
  }
  const reportRows = potatoReportRes.body.rows.filter((row) => String(row.operation_id || "") === String(operation.id));

  const fmcRows = await restSelect(auth.admin.access_token, "field_material_consumptions", "id,operation_id,operation_line_id,field_id,product_id,material_category,quantity_kg,ticket_id,ticket_line_id,created_at", [
    ["company_id", `eq.${companyId}`],
    ["operation_id", `eq.${operation.id}`],
    ["limit", "2000"],
  ]);

  const allTicketIds = [
    ...supplierReceiptTickets,
    ...fieldIssueTickets,
    ...harvestIncomingTickets,
    ...transferTickets,
  ];
  const allTicketIdsFilter = allTicketIds.length > 0 ? allTicketIds.join(",") : "";

  const ledgerRows = allTicketIdsFilter
    ? await restSelect(
        auth.admin.access_token,
        "stock_ledger_entries",
        "id,ticket_id,warehouse_id,direction,quantity,reason_type,product_id,operation_line_id,created_at",
        [
          ["company_id", `eq.${companyId}`],
          ["ticket_id", `in.(${allTicketIdsFilter})`],
          ["limit", "5000"],
        ]
      ).catch(() => [])
    : [];

  const stockSnapshotRaw = await restSelect(
    auth.admin.access_token,
    "v_stock_balance_identity",
    "warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity",
    [
      ["company_id", `eq.${companyId}`],
      ["quantity", "gt.0"],
      ["limit", "5000"],
    ]
  ).catch(() => []);
  const qaWarehouseIds = new Set(qaWarehouses.map((x) => String(x.id)));
  const warehouseNameById = new Map(warehouseRows.map((x) => [String(x.id), String(x.name || "")]));
  const productNameById = new Map(products.map((x) => [String(x.id), String(x.name || "")]));
  const stockSnapshot = stockSnapshotRaw
    .filter((row) => qaWarehouseIds.has(String(row.warehouse_id)))
    .map((row) => ({
      ...row,
      warehouse_name: warehouseNameById.get(String(row.warehouse_id)) || String(row.warehouse_id),
      product_name: productNameById.get(String(row.product_id)) || String(row.product_id),
    }));

  const runReport = {
    ok: true,
    run_tag: runTag,
    app_base_url: APP_BASE_URL,
    company_id: companyId,
    actor_profiles: profiles,
    selected_context: {
      season_id: seasonId,
      potato_crop_ids: Array.from(potatoCropIds),
      field_id: preferredStructure.field_id,
      field_name: preferredStructure.field_name,
      crop_structure_allocation_id: preferredStructure.id,
      harvest_allocation_id: harvestAllocation?.id || null,
      harvest_allocation_auto_created: harvestAllocationAutoCreated,
      harvest_allocation_create_error: harvestAllocationCreateError,
    },
    operation: {
      id: operation.id,
      type: "planting",
      created_lines: createdLines.map((x) => ({
        id: x.id,
        planned_area_ha: x.planned_area_ha,
        variety_id: x.variety_id,
        reproduction_id: x.reproduction_id,
      })),
      completed_lines: completedLines.map((x) => ({
        id: x.id,
        actual_area_ha: x.actual_area_ha,
        row_count: x.row_count,
        row_spacing_m: x.row_spacing_m,
        seed_spacing_cm: x.seed_spacing_cm,
        calculated_plants_per_ha: x.calculated_plants_per_ha,
        calculated_total_plants: x.calculated_total_plants,
      })),
    },
    tickets: {
      supplier_receipts: supplierReceiptTickets,
      field_issues: fieldIssueTickets,
      harvest_incoming: harvestIncomingTickets,
      warehouse_transfers: transferTickets,
    },
    report: {
      potato_rows_for_operation: reportRows,
      fmc_rows_for_operation: fmcRows,
      ledger_rows_for_operation_ref: ledgerRows,
      stock_snapshot_qa_warehouses: stockSnapshot,
    },
    totals: {
      potato_report_rows: reportRows.length,
      fmc_rows: fmcRows.length,
      ledger_rows: ledgerRows.length,
      harvest_incoming_tickets: harvestIncomingTickets.length,
      warehouse_transfer_tickets: transferTickets.length,
    },
  };

  const outDir = path.resolve("scripts/output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `qa-potato-cycle-e2e-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(runReport, null, 2), "utf-8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: outPath,
        operation_id: operation.id,
        supplier_receipts: supplierReceiptTickets.length,
        field_issues: fieldIssueTickets.length,
        harvest_incoming: harvestIncomingTickets.length,
        warehouse_transfers: transferTickets.length,
        report_rows: reportRows.length,
        fmc_rows: fmcRows.length,
        ledger_rows: ledgerRows.length,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
