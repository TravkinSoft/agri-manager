import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareContracts,
  type ContractSnapshot,
  type MigrationFact,
  type RequiredObject,
} from "./db-contract-core";

const QA_PROJECT_REF = process.env.DB_CONTRACT_QA_PROJECT_REF || "gsglkmudcwkdetqtocae";
const PROD_PROJECT_REF = process.env.DB_CONTRACT_PROD_PROJECT_REF || "bhsemlvmkikpntabctml";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const outputDir = join(process.cwd(), "data", "audit", "db-contract");

const targetTables = [
  "public.tickets", "public.ticket_lines", "public.ticket_weighings",
  "public.inventory_batches", "public.harvest_lots", "public.harvest_lot_batches",
  "public.stock_ledger_entries", "public.inventory_transactions",
  "public.products", "public.fields", "public.crop_structure", "public.seasons",
  "public.warehouses", "public.weighbridge_shifts", "public.reference_vehicles",
  "public.reference_machines", "public.field_material_consumptions", "public.processing_nodes",
  "public.batch_transformations", "public.batch_transformation_inputs",
  "public.batch_transformation_outputs", "public.company_people",
  "private.weighbridge_operator_credentials", "private.weighbridge_operator_sessions",
];

const requiredTables = targetTables.filter((key) => !key.match(
  /field_material_consumptions|processing_nodes|batch_transformations|batch_transformation_inputs|batch_transformation_outputs/,
));

const tz271Columns: RequiredObject[] = [
  ...["density_kg_per_l:numeric(14,6)", "density_unit:text", "density_source:text", "density_verification_status:text", "density_verified_at:timestamp with time zone"]
    .map((entry) => { const [name, dataType] = entry.split(":"); return { kind: "column" as const, key: `public.products.${name}`, dataType }; }),
  ...["base_quantity:numeric(18,6)", "base_uom:text", "mass_kg:numeric(18,6)", "density_kg_per_l:numeric(14,6)", "density_unit:text", "density_source:text", "density_verification_status:text", "density_verified_at:timestamp with time zone", "batch_class:text", "unit_source:text", "unit_contract_version:smallint"]
    .map((entry) => { const [name, dataType] = entry.split(":"); return { kind: "column" as const, key: `public.inventory_transactions.${name}`, dataType }; }),
  ...["mass_kg:numeric(18,6)", "density_kg_per_l:numeric(14,6)", "density_unit:text", "density_source:text", "density_verification_status:text", "density_verified_at:timestamp with time zone", "unit_source:text", "unit_contract_version:smallint"]
    .flatMap((entry) => ["stock_ledger_entries", "ticket_lines"].map((table) => { const [name, dataType] = entry.split(":"); return { kind: "column" as const, key: `public.${table}.${name}`, dataType }; })),
  ...["initial_quantity:numeric(18,6)", "current_quantity:numeric(18,6)", "uom:text", "mass_kg:numeric(18,6)", "density_kg_per_l:numeric(14,6)", "density_unit:text", "density_source:text", "density_verification_status:text", "density_verified_at:timestamp with time zone", "unit_source:text", "unit_contract_version:smallint"]
    .map((entry) => { const [name, dataType] = entry.split(":"); return { kind: "column" as const, key: `public.inventory_batches.${name}`, dataType }; }),
  ...["quantity:numeric(18,6)", "uom:text", "mass_kg:numeric(18,6)", "density_kg_per_l:numeric(14,6)", "density_unit:text", "density_source:text", "density_verification_status:text", "density_verified_at:timestamp with time zone", "unit_contract_version:smallint"]
    .map((entry) => { const [name, dataType] = entry.split(":"); return { kind: "column" as const, key: `public.field_material_consumptions.${name}`, dataType }; }),
];

const requiredObjects: RequiredObject[] = [
  ...requiredTables.map((key) => ({ kind: "table" as const, key })),
  ...tz271Columns,
];

const migrationFacts: MigrationFact[] = [
  { migrationName: "tz271_restore_weighbridge_unit_contract_columns", requiredObjects: tz271Columns },
  {
    migrationName: "weighbridge_pin_gate_shift_lifecycle_v1",
    requiredObjects: [
      { kind: "column", key: "public.weighbridge_shifts.last_activity_at", dataType: "timestamp with time zone" },
      { kind: "function", key: "public.weighbridge_operator_session_state_v1(p_company_id uuid, p_session_token text)" },
      { kind: "function", key: "public.touch_weighbridge_operator_activity_v1(p_company_id uuid, p_session_token text, p_activity text)" },
      { kind: "trigger", key: "private.weighbridge_operator_credentials.close_weighbridge_shift_on_operator_access_disabled_v1" },
    ],
  },
  {
    migrationName: "tz294_atomic_harvest_intake_finalize_v1",
    requiredObjects: [
      { kind: "column", key: "public.tickets.physical_net_kg", dataType: "numeric(14,3)" },
      { kind: "column", key: "public.tickets.explicit_deductions_kg", dataType: "numeric(14,3)" },
      { kind: "column", key: "public.tickets.accepted_weight_kg", dataType: "numeric(14,3)" },
      { kind: "function", key: "public.finalize_harvest_intake_for_session_v1(p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_moisture_percent numeric, p_deduction_kg numeric, p_deduction_percent numeric, p_deduction_reason text, p_tare_variance_confirmed boolean, p_idempotency_key text)" },
    ],
  },
];

const expectedQaAhead = [
  /^table:public\.(batch_transformations|batch_transformation_inputs|batch_transformation_outputs)/,
  /^table:public\.tickets\.(physical_net_kg|explicit_deductions_kg|accepted_weight_kg)$/,
  /^table:public\.weighbridge_shifts\.last_activity_at$/,
  /^function:(private\.(close_weighbridge|assert_weighbridge|emit_ticket|revoke_weighbridge|validate_weighbridge|verify_weighbridge|weighbridge_ticket)|public\.(attach_harvest|ensure_harvest|finalize_batch|finalize_weighbridge|handover_weighbridge|lock_weighbridge|open_or_unlock_weighbridge|populate_|prepare_grain|reassign_harvest|recompute_grain|set_harvest|start_weighbridge|touch_weighbridge|update_open_weighbridge|validate_harvest|void_|weighbridge_operator))/,
  /^trigger:(private\.weighbridge_operator_credentials|public\.(field_material_consumptions|inventory_batches|stock_ledger_entries|tickets))/,
];

const sql = `
with targets(schema_name, table_name) as (
  values ${targetTables.map((key) => {
    const [schema, table] = key.split(".");
    return `('${schema}','${table}')`;
  }).join(",")}
), table_contracts as (
  select t.schema_name||'.'||t.table_name as key,
    jsonb_build_object(
      'rlsEnabled', c.relrowsecurity,
      'columns', coalesce((select jsonb_object_agg(a.attname, jsonb_build_object(
        'dataType', format_type(a.atttypid,a.atttypmod), 'nullable', not a.attnotnull,
        'defaultExpr', coalesce(pg_get_expr(ad.adbin,ad.adrelid),''),
        'identity', a.attidentity::text, 'generated', a.attgenerated::text,
        'enumType', case when ty.typtype='e' then tn.nspname||'.'||ty.typname else null end
      ) order by a.attname) from pg_attribute a
        join pg_type ty on ty.oid=a.atttypid join pg_namespace tn on tn.oid=ty.typnamespace
        left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'{}'::jsonb),
      'indexes', coalesce((select jsonb_object_agg(i.relname,md5(pg_get_indexdef(i.oid)) order by i.relname)
        from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),'{}'::jsonb),
      'foreignKeys', coalesce((select jsonb_object_agg(con.conname,md5(pg_get_constraintdef(con.oid,true)) order by con.conname)
        from pg_constraint con where con.conrelid=c.oid and con.contype='f'),'{}'::jsonb),
      'checks', coalesce((select jsonb_object_agg(con.conname,md5(pg_get_constraintdef(con.oid,true)) order by con.conname)
        from pg_constraint con where con.conrelid=c.oid and con.contype='c'),'{}'::jsonb),
      'policies', coalesce((select jsonb_object_agg(p.policyname,md5(concat_ws('|',p.cmd,p.roles::text,p.qual,p.with_check)) order by p.policyname)
        from pg_policies p where p.schemaname=t.schema_name and p.tablename=t.table_name),'{}'::jsonb)
    ) as value
  from targets t join pg_namespace n on n.nspname=t.schema_name join pg_class c on c.relnamespace=n.oid and c.relname=t.table_name
), functions as (
  select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as key,
    jsonb_build_object('returnType',pg_get_function_result(p.oid),'securityDefiner',p.prosecdef,
      'searchPath',coalesce((select setting from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%' limit 1),''),
      'definitionHash',md5(regexp_replace(pg_get_functiondef(p.oid),'\\s+',' ','g')),
      'grants',coalesce(array_to_string(p.proacl,','),'')) as value
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and (p.proname ilike '%ticket%' or p.proname ilike '%weigh%' or p.proname ilike '%harvest%' or p.proname ilike '%batch%' or p.proname ilike '%processing%' or p.proname ilike '%operator%' or p.proname ilike '%weather%' or p.proname ilike '%company_people%')
), triggers as (
  select n.nspname||'.'||c.relname||'.'||tg.tgname as key, to_jsonb(md5(regexp_replace(pg_get_triggerdef(tg.oid,true),'\\s+',' ','g'))) as value
  from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join targets t on t.schema_name=n.nspname and t.table_name=c.relname where not tg.tgisinternal
), views as (
  select schemaname||'.'||viewname as key, to_jsonb(md5(regexp_replace(definition,'\\s+',' ','g'))) as value
  from pg_views where schemaname in ('public','private') and definition ~* '(tickets|inventory_batches|harvest_lots|processing|company_people)'
), enums as (
  select n.nspname||'.'||ty.typname as key,
    to_jsonb(string_agg(e.enumlabel,',' order by e.enumsortorder)) as value
  from targets t
  join pg_namespace tn on tn.nspname=t.schema_name
  join pg_class c on c.relnamespace=tn.oid and c.relname=t.table_name
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  join pg_type ty on ty.oid=a.atttypid and ty.typtype='e'
  join pg_namespace n on n.oid=ty.typnamespace
  join pg_enum e on e.enumtypid=ty.oid
  group by n.nspname,ty.typname
), migrations as (
  select version::text, name from supabase_migrations.schema_migrations order by version
)
select jsonb_build_object(
  'tables',coalesce((select jsonb_object_agg(key,value order by key) from table_contracts),'{}'::jsonb),
  'functions',coalesce((select jsonb_object_agg(key,value order by key) from functions),'{}'::jsonb),
  'triggers',coalesce((select jsonb_object_agg(key,value order by key) from triggers),'{}'::jsonb),
  'views',coalesce((select jsonb_object_agg(key,value order by key) from views),'{}'::jsonb),
  'enums',coalesce((select jsonb_object_agg(key,value order by key) from enums),'{}'::jsonb),
  'migrations',coalesce((select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from migrations),'[]'::jsonb)
) as snapshot`;

const queryProject = async (projectRef: string): Promise<ContractSnapshot> => {
  if (!ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is required; it is read from the environment and never logged");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Supabase Management API returned HTTP ${response.status} for ${projectRef}`);
  const payload = await response.json() as Array<{ snapshot: Omit<ContractSnapshot, "projectRef" | "capturedAt"> }>;
  const value = Array.isArray(payload) ? payload[0]?.snapshot : null;
  if (!value) throw new Error(`No contract snapshot returned for ${projectRef}`);
  return { projectRef, capturedAt: new Date().toISOString(), ...value };
};

const localMigrationChecksums = () => readdirSync(join(process.cwd(), "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({
    file: name,
    checksum: createHash("sha256").update(readFileSync(join(process.cwd(), "supabase", "migrations", name))).digest("hex"),
  }));

const markdown = (result: ReturnType<typeof compareContracts>, checksums: ReturnType<typeof localMigrationChecksums>) => [
  "# QA / Production DB Contract Drift Gate",
  "",
  `Status: **${result.ok ? "PASS" : "FAIL"}**`,
  `Critical failures: ${result.failures}`,
  `Warnings: ${result.warnings}`,
  "",
  "## Findings",
  "",
  ...(result.findings.length ? result.findings.map((finding) => `- ${finding.severity} ${finding.code} \`${finding.object}\`: ${finding.detail}`) : ["- None"]),
  "",
  "## Local migration SHA-256",
  "",
  ...checksums.map((item) => `- \`${item.file}\`: \`${item.checksum}\``),
  "",
  "This report is generated by a read-only SELECT-only verifier. No database mutation is issued.",
].join("\n");

const main = async () => {
  const [qa, production] = await Promise.all([queryProject(QA_PROJECT_REF), queryProject(PROD_PROJECT_REF)]);
  const result = compareContracts({ qa, production, requiredObjects, migrationFacts, expectedQaAhead });
  const checksums = localMigrationChecksums();
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "current.json"), JSON.stringify({ qa, production, result, checksums }, null, 2));
  writeFileSync(join(outputDir, "current.md"), markdown(result, checksums));
  console.log(`DB contract gate ${result.ok ? "PASS" : "FAIL"}: ${result.failures} failures, ${result.warnings} warnings`);
  process.exitCode = result.ok ? 0 : 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
