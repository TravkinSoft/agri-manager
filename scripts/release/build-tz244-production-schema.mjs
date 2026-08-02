import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const workspace = resolve(root, "..", "..");
const migrationsDir = resolve(root, "supabase", "migrations");
const auditDir = resolve(workspace, "audit-output", "TZ-244");
const outputFile = process.env.TZ244_SCHEMA_MIGRATION;

if (!outputFile) throw new Error("TZ244_SCHEMA_MIGRATION is required");

function splitSql(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  let state = "normal";
  let dollarTag = "";
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (state === "line") {
      if (ch === "\n") state = "normal";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "normal";
        i += 2;
      } else i += 1;
      continue;
    }
    if (state === "single") {
      if (ch === "'" && next === "'") i += 2;
      else if (ch === "'") {
        state = "normal";
        i += 1;
      } else i += 1;
      continue;
    }
    if (state === "double") {
      if (ch === '"' && next === '"') i += 2;
      else if (ch === '"') {
        state = "normal";
        i += 1;
      } else i += 1;
      continue;
    }
    if (state === "dollar") {
      if (sql.startsWith(dollarTag, i)) {
        state = "normal";
        i += dollarTag.length;
      } else i += 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      state = "line";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "block";
      i += 2;
      continue;
    }
    if (ch === "'") {
      state = "single";
      i += 1;
      continue;
    }
    if (ch === '"') {
      state = "double";
      i += 1;
      continue;
    }
    if (ch === "$") {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        state = "dollar";
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ";") {
      statements.push(sql.slice(start, i + 1));
      start = i + 1;
    }
    i += 1;
  }
  if (sql.slice(start).trim()) statements.push(sql.slice(start));
  return statements;
}

function startOf(statement) {
  return statement
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const localSources = [
  "20260719182748_operations_p0_atomicity_v1.sql",
  "20260720143000_weighbridge_session_finalize_rpc.sql",
  "20260721105024_warehousekeeper_global_catalog_read_v1.sql",
  "20260721112000_warehousekeeper_atomic_receipts_v1.sql",
  "20260721132434_global_counterparties_v1.sql",
  "20260721132844_global_counterparty_security_indexes.sql",
  "20260721151313_warehouse_v11_inventory_transfers.sql",
  "20260721180525_processing_session_finalize_rpc.sql",
  "20260721180750_weighbridge_session_void_rpc.sql",
  "20260721193142_weighbridge_impurity_removal_v1.sql",
  "20260721201500_weighbridge_admin_storno_session_rpc.sql",
  "20260722100549_weighbridge_v13_inventory_approval.sql",
  "20260722103000_company_admin_v1_warehouse_receipt_links.sql",
  "20260722111820_weighbridge_v13_finalize_mass_alignment_schema_fix.sql",
  "20260722114500_company_admin_reference_write_policies.sql",
  "20260723132603_operations_v12_progress_variance.sql",
  "20260723180119_operations_v13_final_role_cards.sql",
  "20260727224833_work_audit_integrity_v1.sql",
  "__TZ199_SCHEMA__",
  "__TZ224_SCHEMA__",
  "__TZ224_INDEXES__",
  "20260729112433_crop_identity_reference_visibility_v1.sql",
  "20260729112440_harvest_traceability_v1.sql",
  "20260729143000_glbd_global_admin_human_card_read.sql",
  "20260730105407_package_aware_warehouse_issue_v1.sql",
  "20260730111532_package_aware_receipt_action_contract_v1.sql",
  "20260730121441_field_history_company_rls_v1.sql",
  "20260730140942_simplify_warehouse_issue_quantities_v1.sql",
  "20260730153500_warehouse_issue_product_identity_v1.sql",
  "20260731013506_warehouse_issue_actual_product_identity_v2.sql",
  "20260731015717_warehouse_issue_equivalent_product_identity_v3.sql",
  "20260731144242_crop_structure_fallow_operations_v1.sql",
  "20260731151000_operation_snow_retention_v1.sql",
  "20260731164000_operation_whole_field_history_v1.sql",
  "20260801143322_grain_mix_v1.sql",
  "20260801143550_grain_mix_privilege_hardening_v1.sql",
  "20260801194459_crop_mix_seed_product_reconciliation_v1.sql",
  "20260801200610_crop_structure_area_trigger_search_path_fix_v1.sql",
  "20260801201000_crop_mix_seed_product_reconciliation_schema_fix_v1.sql",
  "20260801202000_crop_mix_completion_reconciliation_v1.sql",
  "20260801202500_crop_mix_progress_reconciliation_guard_v1.sql",
  "20260801203000_crop_mix_harvest_transition_v1.sql",
  "20260801203500_crop_mix_harvest_line_validation_v1.sql",
  "20260801204000_weighbridge_finalize_authenticated_guard_v1.sql",
  "20260801204500_grain_mix_index_rls_optimization_v1.sql",
];

const specialPaths = {
  __TZ199_SCHEMA__: resolve(root, "scripts", "qa", "full-pesticide-card-v1-schema.sql"),
  __TZ224_SCHEMA__: resolve(workspace, "audit-output", "TZ-224", "migration.sql"),
  __TZ224_INDEXES__: resolve(workspace, "audit-output", "TZ-224", "migration-fk-indexes.sql"),
};

const removedStatements = [];
const includedSources = [];
const canonicalUnitsSource = "20260713183038_warehouse_canonical_units_v2.sql";
const canonicalUnitsSql = readFileSync(join(migrationsDir, canonicalUnitsSource), "utf8");
const canonicalStockUom = splitSql(canonicalUnitsSql).find((statement) =>
  /^create or replace function public\.canonical_stock_uom\(p_uom text\)/i.test(startOf(statement)),
);

if (!canonicalStockUom) {
  throw new Error(`canonical_stock_uom prerequisite not found in ${canonicalUnitsSource}`);
}

const sections = [
  "-- TZ-244 Father Pilot V1 consolidated production-safe schema package.",
  "-- Source commit: d3a6a8c5d4f5fbf6139f327dd6bf1c3fb5cab283",
  "-- Existing ERP rows are not backfilled or relabelled by this migration.",
  "",
  `-- BEGIN PREREQUISITE: ${canonicalUnitsSource} / canonical_stock_uom`,
  canonicalStockUom.trim(),
  `-- END PREREQUISITE: ${canonicalUnitsSource} / canonical_stock_uom`,
  "",
];

function shouldRemove(source, start) {
  if (/^(begin|commit|rollback)\s*;?$/i.test(start)) return "transaction wrapper removed";
  if (source === "__TZ199_SCHEMA__" && /^do \$guard\$/i.test(start)) return "QA branch guard excluded";
  if (source.includes("weighbridge_v13_inventory_approval")) {
    if (/^update public\.(counterparties|warehouse_inventory_documents)\b/i.test(start)) return "existing production row backfill excluded";
  }
  if (source.includes("work_audit_integrity")) {
    if (/^do \$qa_guard\$/i.test(start)) return "QA branch guard excluded";
    if (/^update public\.(crop_structure|warehouse_issue_requests|field_history_entries)\b/i.test(start)) return "existing ERP row repair excluded";
  }
  if (source === "__TZ224_SCHEMA__" && /^insert into public\.glbd_product_identity_review_groups\b/i.test(start)) {
    return "research review rows excluded";
  }
  if (source.includes("crop_identity_reference_visibility") && /^do \$\$/i.test(start)) {
    return "catalog seed moved to exact production catalog package";
  }
  if (source.includes("package_aware_warehouse_issue")) {
    if (/^with ranked\b/i.test(start) || /^update public\.(fields|operations)\b/i.test(start)) return "existing ERP identifier/test-data backfill excluded";
  }
  if (source.includes("crop_structure_fallow_operations") && /^update public\.crop_structure\b/i.test(start)) {
    return "existing crop structure backfill excluded; column default preserves crop semantics";
  }
  if (source.includes("operation_whole_field_history") && /^insert into public\.field_history_entries\b/i.test(start)) {
    return "historical ERP repair excluded; trigger covers future completions";
  }
  return null;
}

for (const source of localSources) {
  const path = specialPaths[source] || join(migrationsDir, source);
  const sql = readFileSync(path, "utf8");
  const sourceHash = createHash("sha256").update(sql).digest("hex");
  const kept = [];
  const removed = [];
  for (const statement of splitSql(sql)) {
    const start = startOf(statement);
    if (!start) continue;
    const reason = shouldRemove(source, start);
    if (reason) {
      removed.push({ start: start.slice(0, 180), reason });
      removedStatements.push({ source, start: start.slice(0, 180), reason });
    } else {
      kept.push(statement.trim());
    }
  }
  if (!kept.length) throw new Error(`No statements kept for ${source}`);
  includedSources.push({ source, path, sha256: sourceHash, statements: kept.length, removed: removed.length });
  sections.push(`-- BEGIN SOURCE: ${source}`, ...kept, `-- END SOURCE: ${source}`, "");
}

const finalSql = `${sections.join("\n\n").trim()}\n`;
writeFileSync(outputFile, finalSql, "utf8");

const classifications = [
  ["20260716125205","assistant_memory_policy_v2","QA_TEST_ONLY","assistant memory branch contract","assistant memory lifecycle only","NO","restore prior assistant functions/policies","Father pilot required schema does not include branch-only Assistant memory policy"],
  ["20260719102826","tz199_full_pesticide_card_v1_branch_only","REQUIRED_SCHEMA","products and GLBD foundation","four Full Card base tables and authenticated read policies","YES","use TZ-224 rollback","TZ-224 is an additive contract and requires the canonical TZ-199 base tables; QA guard removed"],
  ["20260719104511","tz199_full_pesticide_card_fk_indexes","OBSOLETE_SUPERSEDED","TZ-199 prototype","prototype FK indexes","NO","drop prototype indexes","Superseded by TZ-224 index package"],
  ["20260719104556","tz199_full_pesticide_card_composite_fk_indexes","OBSOLETE_SUPERSEDED","TZ-199 prototype","prototype composite indexes","NO","drop prototype indexes","Superseded by TZ-224 index package"],
  ["20260720192603","weighbridge_session_finalize_rpc","REQUIRED_FUNCTION","weighbridge base tables","finalize RPC","YES","restore function definition","Required weighbridge lifecycle"],
  ["20260721102057","warehousekeeper_atomic_receipts_v1","REQUIRED_FUNCTION","warehouse and ticket tables","atomic receipt RPC","YES","restore function definition","Required warehouse receipt lifecycle"],
  ["20260721105204","warehousekeeper_global_catalog_read_v1","REQUIRED_SECURITY","global catalog tables","warehouse authenticated read policy","YES","restore prior policy/grants","Warehouse must resolve global stock identities"],
  ["20260721132434","global_counterparties_v1","REQUIRED_SCHEMA","companies profiles tickets","global and company counterparty model","YES","drop additive objects and restore functions","Required supplier identity model"],
  ["20260721132844","global_counterparty_security_indexes","REQUIRED_INDEX","global_counterparties_v1","FK and security indexes","YES","drop added indexes","Required FK coverage"],
  ["20260721151313","warehouse_v11_inventory_transfers","REQUIRED_SCHEMA","warehouse ledger and counterparties","receipts transfers inventory documents and RPCs","YES","restore functions and drop additive objects","Required warehouse V1.1 lifecycle"],
  ["20260721180525","processing_session_finalize_rpc","REQUIRED_FUNCTION","processing module","processing finalizer","YES","restore function definition","Required processing lifecycle compatibility"],
  ["20260721180750","weighbridge_session_void_rpc","REQUIRED_FUNCTION","weighbridge module","void RPC","YES","restore function definition","Required controlled void lifecycle"],
  ["20260721194042","weighbridge_impurity_removal_v1","REQUIRED_FUNCTION","warehouse ledger and weighbridge","impurity removal RPC","YES","restore function definition","Required weighbridge impurity accounting"],
  ["20260721201409","weighbridge_admin_storno_session_rpc","REQUIRED_FUNCTION","weighbridge module","admin storno RPC","YES","restore function definition","Required guarded correction lifecycle"],
  ["20260721212849","company_admin_v1_warehouse_receipt_links","REQUIRED_FUNCTION","counterparties and receipts","company admin receipt linkage","YES","restore function definition","Required company admin workflow"],
  ["20260721213110","company_admin_reference_write_policies","REQUIRED_SECURITY","company reference tables","company admin write policies","YES","restore policies","Required role authorization"],
  ["20260722100549","weighbridge_v13_inventory_approval","REQUIRED_SCHEMA","counterparties inventory tickets ledger","inventory approval schema and RPCs","YES","restore objects; no ERP backfill included","Required weighbridge V1.3 lifecycle"],
  ["20260722102157","temp_enable_http_for_pesticide_research","TEMP_RESEARCH_ONLY","pg_net/http","temporary research transport","NO","not applicable","Explicitly forbidden temporary research migration"],
  ["20260722102832","temp_pesticide_research_staging","TEMP_RESEARCH_ONLY","pesticide catalog","temporary staging tables","NO","not applicable","Explicitly forbidden temporary research migration"],
  ["20260722103208","temp_pesticide_payload_chunks","TEMP_RESEARCH_ONLY","research staging","temporary payload chunks","NO","not applicable","Explicitly forbidden temporary research migration"],
  ["20260722104123","temp_public_pesticide_research_staging","TEMP_RESEARCH_ONLY","research staging","temporary public staging","NO","not applicable","Explicitly forbidden temporary research migration"],
  ["20260722111414","weighbridge_v13_finalize_mass_alignment","OBSOLETE_SUPERSEDED","weighbridge finalizer","intermediate function version","NO","not applicable","Superseded by schema-fix final version"],
  ["20260722111656","weighbridge_v13_finalize_mass_alignment_enum_fix","OBSOLETE_SUPERSEDED","previous mass alignment","intermediate enum fix","NO","not applicable","Superseded by schema-fix final version"],
  ["20260722111820","weighbridge_v13_finalize_mass_alignment_schema_fix","REQUIRED_FUNCTION","weighbridge V1.3 schema","final mass alignment function","YES","restore function definition","Final canonical function version"],
  ["20260722112909","temp_public_pesticide_inputs_staging","TEMP_RESEARCH_ONLY","research staging","temporary input staging","NO","not applicable","Explicitly forbidden temporary research migration"],
  ["20260723183515","operations_v13_final_role_cards","REQUIRED_FUNCTION","operations atomicity and progress","final role-card RPCs","YES","restore function definitions","Required current role workflow"],
  ["20260726100044","tz224_glbd_schema_contract_identity_safety_v1","REQUIRED_SCHEMA","GLBD products components aliases","identity-safe Full Card contract","YES","use TZ-224 rollback","Current pesticide-card APIs require these tables"],
  ["20260726100748","tz224_glbd_schema_contract_fk_indexes_v1","REQUIRED_INDEX","TZ-224 schema","GLBD FK indexes","YES","drop added indexes","Required FK coverage"],
  ["20260727225415","work_audit_integrity_v1","REQUIRED_SCHEMA","operations warehouse field history","production-safe DDL RPC RLS subset","YES","restore prior definitions; no repair backfill","QA guard and existing-row repairs removed in consolidated package"],
  ["20260729114848","crop_identity_reference_visibility_v1","REQUIRED_SECURITY","crops varieties reproductions","authenticated identity visibility","YES","restore policies/functions","Required crop identity visibility; seed DML moved to catalog package"],
  ["20260729114909","harvest_traceability_v1","REQUIRED_SCHEMA","operations tickets batches ledger","harvest traceability objects","YES","restore additive objects/functions","Required harvest path"],
  ["20260729140213","glbd_global_admin_human_card_read","REQUIRED_SECURITY","TZ-224 GLBD schema","Global Admin Full Card reads","YES","restore grants/policies","Required pesticide card UI"],
  ["20260730105407","package_aware_warehouse_issue_v1","REQUIRED_SCHEMA","warehouse request and ledger","allocation baseline and stable identifiers","YES","restore objects/functions; no ERP/test backfill","Required dependency of final simplified issue RPCs"],
  ["20260730111532","package_aware_receipt_action_contract_v1","REQUIRED_FUNCTION","package-aware warehouse baseline","receipt action compatibility","YES","restore function definition","Required dependency of final simplified issue RPCs"],
  ["20260730121558","field_history_company_rls_v1","REQUIRED_SECURITY","field history tables","company RLS and grants","YES","restore policies/grants","Required cross-company isolation"],
  ["20260730140942","simplify_warehouse_issue_quantities_v1","REQUIRED_FUNCTION","package-aware baseline","quantity-only prepare and issue RPCs","YES","restore function definitions","Required simplified warehouse lifecycle"],
  ["20260731012239","warehouse_issue_product_identity_v1","REQUIRED_FUNCTION","quantity-only issue RPCs","master product identity V1","YES","restore function definitions","Required current warehouse identity"],
  ["20260731013736","warehouse_issue_actual_product_identity_v2","REQUIRED_FUNCTION","identity V1 RPCs","actual product identity V2","YES","restore function definitions","Required current warehouse identity"],
  ["20260731020729","warehouse_issue_equivalent_product_identity_v3","REQUIRED_FUNCTION","identity V2 RPCs","equivalent product guard V3","YES","restore function definitions","Final current warehouse identity"],
  ["20260731150803","crop_structure_fallow_operations_v1","REQUIRED_SCHEMA","crop structure and operations","fallow and crop-independent target scope","YES","drop additive columns/constraints","Required fallow workflow"],
  ["20260731152112","operation_snow_retention_v1","REQUIRED_GLOBAL_DATA","operation types","snow retention reference row","YES","delete exact inserted reference if unused","Required crop-independent operation"],
  ["20260731162628","operation_whole_field_history_v1","REQUIRED_FUNCTION","field history and operations","future whole-field history trigger","YES","restore function/trigger; no history backfill","Required field history lifecycle"],
  ["20260801143322","grain_mix_v1","REQUIRED_SCHEMA","crop structure operations warehouse weighbridge","grain mix schema and RPCs","YES","drop additive objects and restore functions","Required Grain Mix V1"],
  ["20260801143550","grain_mix_privilege_hardening_v1","REQUIRED_SECURITY","grain_mix_v1","grain mix grants","YES","restore grants","Required RLS hardening"],
  ["20260801144718","crop_mix_seed_product_reconciliation_v1","REQUIRED_FUNCTION","grain mix and products","seed identity reconciliation","YES","restore function definition","Required Grain Mix issue path"],
  ["20260801145205","crop_structure_area_trigger_search_path_fix_v1","REQUIRED_SECURITY","crop structure trigger","search_path hardening","YES","restore function definition","Required function security"],
  ["20260801145732","crop_mix_seed_product_reconciliation_schema_fix_v1","REQUIRED_FUNCTION","seed reconciliation V1","schema-compatible reconciliation","YES","restore function definition","Final schema-compatible function"],
  ["20260801151120","crop_mix_completion_reconciliation_v1","REQUIRED_FUNCTION","grain mix progress and materials","completion reconciliation","YES","restore function definition","Required completion lifecycle"],
  ["20260801151406","crop_mix_progress_reconciliation_guard_v1","REQUIRED_FUNCTION","grain mix completion","progress guard","YES","restore function definition","Required progress integrity"],
  ["20260801151824","crop_mix_harvest_transition_v1","REQUIRED_FUNCTION","grain mix and weighbridge","harvest transition","YES","restore function definition","Required harvest path"],
  ["20260801152201","crop_mix_harvest_line_validation_v1","REQUIRED_FUNCTION","grain mix harvest","ticket line validation","YES","restore function definition","Required harvest validation"],
  ["20260801152408","weighbridge_finalize_authenticated_guard_v1","REQUIRED_SECURITY","weighbridge finalizer","authenticated finalization guard","YES","restore function grants","Required JWT/RLS-safe finalization"],
  ["20260801153757","grain_mix_index_rls_optimization_v1","REQUIRED_INDEX","grain mix schema","FK and RLS indexes","YES","drop added indexes/restore policies","Required performance and policy hardening"],
  ["20260802003434","global_fertilizers_catalog_v1","REQUIRED_GLOBAL_DATA","products manufacturers formulations","fertilizer categories and exact catalog rows","YES","exact catalog rollback package","Applied separately after live identity diff"],
];

const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
const csv = [
  ["version","name","classification","dependencies","production_effect","include_in_release","rollback","reason"],
  ...classifications,
].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";

mkdirSync(auditDir, { recursive: true });
writeFileSync(join(auditDir, "migration-classification.csv"), csv, "utf8");
writeFileSync(join(auditDir, "schema-package-build.json"), JSON.stringify({
  source_commit: "d3a6a8c5d4f5fbf6139f327dd6bf1c3fb5cab283",
  output_file: outputFile,
  output_sha256: createHash("sha256").update(finalSql).digest("hex"),
  output_bytes: Buffer.byteLength(finalSql),
  remote_candidates: classifications.length,
  included_remote_candidates: classifications.filter((row) => row[5] === "YES").length,
  excluded_temp_research: classifications.filter((row) => row[2] === "TEMP_RESEARCH_ONLY").length,
  excluded_qa_only: classifications.filter((row) => row[2] === "QA_TEST_ONLY").length,
  excluded_superseded: classifications.filter((row) => row[2] === "OBSOLETE_SUPERSEDED").length,
  included_sources: includedSources,
  removed_statements: removedStatements,
}, null, 2), "utf8");

console.log(JSON.stringify({
  schema_migration: outputFile,
  sha256: createHash("sha256").update(finalSql).digest("hex"),
  bytes: Buffer.byteLength(finalSql),
  candidates: classifications.length,
  included: classifications.filter((row) => row[5] === "YES").length,
  removed_statements: removedStatements.length,
}));
