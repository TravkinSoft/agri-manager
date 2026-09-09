import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

type DbRow = Record<string, unknown>;
type HarnessRole = "anon" | "authenticated" | "service_role";
type GeoJson = {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown[];
};
type ResolvedRow = {
  polygon_id: string;
  field_id: string;
  geometry_geojson: GeoJson;
  area_from_kml_ha: number | null;
};

const migrationPaths = [
  "supabase/migrations/20260908232606_field_boundary_revision_v1.sql",
  "supabase/migrations/20260909073000_fields_map_atomic_import_v2.sql",
] as const;

const ids = {
  companyA: "10000000-0000-4000-8000-000000000001",
  companyB: "10000000-0000-4000-8000-000000000002",
  admin: "20000000-0000-4000-8000-000000000001",
  inactiveAdmin: "20000000-0000-4000-8000-000000000002",
  agronomist: "20000000-0000-4000-8000-000000000003",
  fieldA1: "30000000-0000-4000-8000-000000000001",
  fieldA2: "30000000-0000-4000-8000-000000000002",
  fieldA3: "30000000-0000-4000-8000-000000000003",
  archivedFieldA: "30000000-0000-4000-8000-000000000004",
  fieldB1: "30000000-0000-4000-8000-000000000101",
  legacyImportA: "40000000-0000-4000-8000-000000000001",
  happyImportA: "40000000-0000-4000-8000-000000000002",
  duplicateImportA: "40000000-0000-4000-8000-000000000003",
  overflowImportA: "40000000-0000-4000-8000-000000000004",
  scopedImportA: "40000000-0000-4000-8000-000000000005",
  archiveImportA: "40000000-0000-4000-8000-000000000006",
  importB: "40000000-0000-4000-8000-000000000101",
  legacyGeometryA1: "50000000-0000-4000-8000-000000000001",
  legacyGeometryA2: "50000000-0000-4000-8000-000000000002",
  archiveGeometryA3: "50000000-0000-4000-8000-000000000006",
  geometryB1: "50000000-0000-4000-8000-000000000101",
  missingGeometry: "50000000-0000-4000-8000-000000000999",
} as const;

let passed = 0;

async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function rows<T extends DbRow = DbRow>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

async function scalar<T = unknown>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const result = await rows(db, sql, params);
  return Object.values(result[0] ?? {})[0] as T;
}

function decodedJson<T extends DbRow>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function expectDatabaseError(
  name: string,
  run: () => Promise<unknown>,
  expected: RegExp,
) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${name}: expected the database statement to fail`);
  assert.match(errorText(caught), expected, name);
}

async function asRole<T>(db: PGlite, role: HarnessRole, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}

function polygon(offset = 0): GeoJson {
  return {
    type: "Polygon",
    coordinates: [[
      [offset, offset],
      [offset + 1, offset],
      [offset + 1, offset + 1],
      [offset, offset + 1],
      [offset, offset],
    ]],
  };
}

function multiPolygon(offset = 0): GeoJson {
  return {
    type: "MultiPolygon",
    coordinates: [[polygon(offset).coordinates[0]]],
  };
}

async function bootstrapLegacySchema(db: PGlite) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create table public.companies (
      id uuid primary key,
      name text not null
    );

    create table public.profiles (
      id uuid primary key,
      company_id uuid references public.companies(id),
      role text not null,
      status text not null
    );

    create table public.fields (
      id uuid primary key,
      company_id uuid not null references public.companies(id) on delete cascade,
      name text not null,
      area numeric(10, 2) not null check (area > 0),
      notes text,
      archived boolean not null default false
    );

    create table public.field_map_imports (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete cascade,
      source_file_name text not null,
      source_kml_text text,
      status text not null default 'draft'
        check (status in ('draft', 'imported', 'archived', 'failed')),
      total_polygons integer not null default 0,
      matched_polygons integer not null default 0,
      unmatched_polygons integer not null default 0,
      error_count integer not null default 0,
      preview_payload jsonb not null default '{}'::jsonb,
      imported_at timestamptz,
      imported_by uuid references public.profiles(id) on delete set null,
      is_active boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.field_geometries (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete cascade,
      field_id uuid not null references public.fields(id) on delete cascade,
      import_id uuid references public.field_map_imports(id) on delete set null,
      source_file_name text,
      geometry_geojson jsonb not null,
      area_from_kml_ha numeric(14, 4),
      imported_at timestamptz not null default now(),
      imported_by uuid references public.profiles(id) on delete set null,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create unique index idx_field_geometries_active_per_field
      on public.field_geometries(company_id, field_id)
      where is_active = true;

    create table public.audit_log (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete cascade,
      who uuid references public.profiles(id),
      when_at timestamptz not null default now(),
      entity_type text not null,
      entity_id text not null,
      action text not null,
      old_values jsonb,
      new_values jsonb,
      reason text
    );

    alter table public.field_map_imports enable row level security;
    alter table public.field_geometries enable row level security;

    create policy "Users can view company field map imports"
      on public.field_map_imports for select to authenticated using (true);
    create policy "Users can insert company field map imports"
      on public.field_map_imports for insert to authenticated with check (true);
    create policy "Users can update company field map imports"
      on public.field_map_imports for update to authenticated using (true) with check (true);
    create policy "Users can delete company field map imports"
      on public.field_map_imports for delete to authenticated using (true);

    create policy "Users can view company field geometries"
      on public.field_geometries for select to authenticated using (true);
    create policy "Users can insert company field geometries"
      on public.field_geometries for insert to authenticated with check (true);
    create policy "Users can update company field geometries"
      on public.field_geometries for update to authenticated using (true) with check (true);
    create policy "Users can delete company field geometries"
      on public.field_geometries for delete to authenticated using (true);

    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on table
      public.field_map_imports, public.field_geometries
      to public, anon, authenticated;
  `);
}

async function applyUnmodifiedMigrations(db: PGlite) {
  for (const path of migrationPaths) {
    const migration = readFileSync(resolve(process.cwd(), path), "utf8");
    assert.match(migration, /notify pgrst, 'reload schema';/i, `${path} must be loaded verbatim`);
    await db.exec(migration);
  }
}

async function seedFixtures(db: PGlite) {
  await db.query(
    `insert into public.companies(id, name) values ($1::uuid, 'Company A'), ($2::uuid, 'Company B')`,
    [ids.companyA, ids.companyB],
  );
  await db.query(
    `insert into public.profiles(id, company_id, role, status) values
      ($1::uuid, $4::uuid, 'global_admin', 'active'),
      ($2::uuid, $4::uuid, 'global_admin', 'inactive'),
      ($3::uuid, $4::uuid, 'agronomist', 'active')`,
    [ids.admin, ids.inactiveAdmin, ids.agronomist, ids.companyA],
  );
  await db.query(
    `insert into public.fields(id, company_id, name, area, notes, archived) values
      ($1::uuid, $6::uuid, 'A-1', 10, 'A-1 notes', false),
      ($2::uuid, $6::uuid, 'A-2', 20, 'A-2 notes', false),
      ($3::uuid, $6::uuid, 'A-3', 30, null, false),
      ($4::uuid, $6::uuid, 'A-archived', 40, null, true),
      ($5::uuid, $7::uuid, 'B-1', 50, 'B-1 notes', false)`,
    [
      ids.fieldA1,
      ids.fieldA2,
      ids.fieldA3,
      ids.archivedFieldA,
      ids.fieldB1,
      ids.companyA,
      ids.companyB,
    ],
  );
  await db.query(
    `insert into public.field_map_imports(
      id, company_id, source_file_name, status, total_polygons, matched_polygons,
      unmatched_polygons, error_count, preview_payload, imported_by, is_active
    ) values
      ($1::uuid, $8::uuid, 'legacy-a.kml', 'imported', 2, 2, 0, 0, '{}'::jsonb, $10::uuid, true),
      ($2::uuid, $8::uuid, 'happy-a.kml', 'draft', 0, 0, 0, 0, '{}'::jsonb, null, false),
      ($3::uuid, $8::uuid, 'duplicate-a.kml', 'draft', 0, 0, 0, 0, '{}'::jsonb, null, false),
      ($4::uuid, $8::uuid, 'overflow-a.kml', 'draft', 0, 0, 0, 0, '{}'::jsonb, null, false),
      ($5::uuid, $8::uuid, 'scoped-a.kml', 'draft', 0, 0, 0, 0, '{}'::jsonb, null, false),
      ($6::uuid, $8::uuid, 'archive-a.kml', 'imported', 1, 1, 0, 0, '{}'::jsonb, $10::uuid, false),
      ($7::uuid, $9::uuid, 'company-b.kml', 'imported', 1, 1, 0, 0, '{}'::jsonb, $10::uuid, true)`,
    [
      ids.legacyImportA,
      ids.happyImportA,
      ids.duplicateImportA,
      ids.overflowImportA,
      ids.scopedImportA,
      ids.archiveImportA,
      ids.importB,
      ids.companyA,
      ids.companyB,
      ids.admin,
    ],
  );
  for (const fixture of [
    [ids.legacyGeometryA1, ids.companyA, ids.fieldA1, ids.legacyImportA, polygon(0), 10, true],
    [ids.legacyGeometryA2, ids.companyA, ids.fieldA2, ids.legacyImportA, polygon(2), 20, true],
    [ids.archiveGeometryA3, ids.companyA, ids.fieldA3, ids.archiveImportA, polygon(4), 30, false],
    [ids.geometryB1, ids.companyB, ids.fieldB1, ids.importB, polygon(6), 40, true],
  ] as const) {
    await db.query(
      `insert into public.field_geometries(
        id, company_id, field_id, import_id, source_file_name, geometry_geojson,
        area_from_kml_ha, imported_by, is_active
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'fixture.kml', $5::jsonb, $6::numeric, $7::uuid, $8::boolean)`,
      [fixture[0], fixture[1], fixture[2], fixture[3], JSON.stringify(fixture[4]), fixture[5], ids.admin, fixture[6]],
    );
  }
}

async function confirmImportAs(
  db: PGlite,
  role: HarnessRole,
  input: {
    companyId: string;
    importId: string;
    actorId: string;
    resolvedRows: ResolvedRow[];
    total: number;
    unmatched: number;
    errors: number;
    expectedRevision?: unknown;
  },
) {
  const expectedRevision = Object.prototype.hasOwnProperty.call(input, "expectedRevision")
    ? input.expectedRevision
    : (await getFieldMapSnapshotAs(db, "service_role", input.companyId)).revision;
  return asRole(db, role, async () => {
    const result = await rows<{ result: unknown }>(db, `
      select public.confirm_field_map_import_v2(
        $1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::jsonb,
        $6::integer, $7::integer, $8::integer, $9::jsonb
      ) as result
    `, [
      input.companyId,
      input.importId,
      input.actorId,
      JSON.stringify(input.resolvedRows),
      JSON.stringify({ source: "pglite-runtime-qa" }),
      input.total,
      input.unmatched,
      input.errors,
      expectedRevision == null ? null : JSON.stringify(expectedRevision),
    ]);
    return decodedJson<DbRow>(result[0].result);
  });
}

async function getFieldMapSnapshotAs(
  db: PGlite,
  role: HarnessRole,
  companyId: string,
) {
  return asRole(db, role, async () => {
    const result = await rows<{ result: unknown }>(db, `
      select public.get_field_map_snapshot_v1($1::uuid) as result
    `, [companyId]);
    return decodedJson<DbRow>(result[0].result);
  });
}

async function importUpdatedAt(db: PGlite, companyId: string, importId: string): Promise<string | null> {
  const result = await rows(db, `
    select updated_at::text
    from public.field_map_imports
    where company_id = $1::uuid and id = $2::uuid
  `, [companyId, importId]);
  return (result[0]?.updated_at as string | undefined) ?? null;
}

async function setImportStateAs(
  db: PGlite,
  role: HarnessRole,
  companyId: string,
  importId: string,
  actorId: string,
  action: string,
  cas: {
    expectedRevision?: unknown;
    expectedTargetUpdatedAt?: string | null;
  } = {},
) {
  const expectedRevision = Object.prototype.hasOwnProperty.call(cas, "expectedRevision")
    ? cas.expectedRevision
    : (await getFieldMapSnapshotAs(db, "service_role", companyId)).revision;
  const expectedTargetUpdatedAt = Object.prototype.hasOwnProperty.call(cas, "expectedTargetUpdatedAt")
    ? cas.expectedTargetUpdatedAt
    : await importUpdatedAt(db, companyId, importId);
  return asRole(db, role, async () => {
    const result = await rows<{ result: unknown }>(db, `
      select public.set_field_map_import_state_v2(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb, $6::timestamptz
      ) as result
    `, [
      companyId,
      importId,
      actorId,
      action,
      expectedRevision == null ? null : JSON.stringify(expectedRevision),
      expectedTargetUpdatedAt,
    ]);
    return decodedJson<DbRow>(result[0].result);
  });
}

async function mutateBoundaryAs(
  db: PGlite,
  role: HarnessRole,
  input: {
    companyId: string;
    actorId: string;
    action: string;
    fieldId: string;
    expectedGeometryId: string | null;
    targetFieldId: string | null;
    geometry: GeoJson | null;
    area: number | null;
  },
) {
  return asRole(db, role, async () => {
    const result = await rows<{ result: unknown }>(db, `
      select public.mutate_field_boundary_v1(
        $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::uuid,
        $7::jsonb, $8::numeric
      ) as result
    `, [
      input.companyId,
      input.actorId,
      input.action,
      input.fieldId,
      input.expectedGeometryId,
      input.targetFieldId,
      input.geometry ? JSON.stringify(input.geometry) : null,
      input.area,
    ]);
    return decodedJson<DbRow>(result[0].result);
  });
}

async function activeSnapshot(db: PGlite, companyId: string) {
  return {
    imports: await rows(db, `
      select id::text, status, is_active
      from public.field_map_imports
      where company_id = $1::uuid and is_active = true
      order by id
    `, [companyId]),
    geometries: await rows(db, `
      select id::text, field_id::text, import_id::text, is_active
      from public.field_geometries
      where company_id = $1::uuid and is_active = true
      order by field_id, id
    `, [companyId]),
  };
}

async function immutableImportGeometryRows(db: PGlite, companyId: string, importId: string) {
  return rows(db, `
    select id::text, company_id::text, field_id::text, import_id::text,
      source_file_name, geometry_geojson::text, area_from_kml_ha::text,
      imported_at::text, imported_by::text, created_at::text, updated_at::text
    from public.field_geometries
    where company_id = $1::uuid and import_id = $2::uuid
    order by field_id, id
  `, [companyId, importId]);
}

async function companyFingerprint(db: PGlite, companyId: string) {
  return {
    fields: await rows(db, `
      select id::text, name, area::text, notes, archived
      from public.fields
      where company_id = $1::uuid
      order by id
    `, [companyId]),
    imports: await rows(db, `
      select id::text, status, total_polygons, matched_polygons,
        unmatched_polygons, error_count, is_active, updated_at::text
      from public.field_map_imports
      where company_id = $1::uuid
      order by id
    `, [companyId]),
    geometries: await rows(db, `
      select id::text, field_id::text, import_id::text, area_from_kml_ha::text, is_active
      from public.field_geometries
      where company_id = $1::uuid
      order by id
    `, [companyId]),
    audit: await rows(db, `
      select entity_type, entity_id, action, old_values, new_values, reason
      from public.audit_log
      where company_id = $1::uuid
      order by when_at, id
    `, [companyId]),
  };
}

async function activeGeometryId(db: PGlite, companyId: string, fieldId: string): Promise<string> {
  const value = await scalar<string>(db, `
    select id::text
    from public.field_geometries
    where company_id = $1::uuid and field_id = $2::uuid and is_active = true
  `, [companyId, fieldId]);
  assert.ok(value, `expected an active geometry for ${fieldId}`);
  return value;
}

async function assertDirectDmlDenied(db: PGlite, role: "anon" | "authenticated") {
  const attempts = [
    `insert into public.field_map_imports(company_id, source_file_name) values ('${ids.companyA}', 'denied.kml')`,
    `update public.field_map_imports set source_file_name = 'denied.kml' where id = '${ids.happyImportA}'`,
    `delete from public.field_map_imports where id = '${ids.happyImportA}'`,
    `insert into public.field_geometries(company_id, field_id, geometry_geojson)
      values ('${ids.companyA}', '${ids.fieldA3}', '{"type":"Polygon","coordinates":[]}'::jsonb)`,
    `update public.field_geometries set source_file_name = 'denied.kml' where id = '${ids.legacyGeometryA1}'`,
    `delete from public.field_geometries where id = '${ids.legacyGeometryA1}'`,
  ];
  for (let index = 0; index < attempts.length; index += 1) {
    const statement = attempts[index];
    await expectDatabaseError(
      `${role} direct DML ${index + 1}`,
      () => asRole(db, role, () => db.exec(statement)),
      /permission denied for table (field_map_imports|field_geometries)/i,
    );
  }
}

async function main() {
  const db = new PGlite();
  const harnessAdaptations: string[] = [];
  try {
    await bootstrapLegacySchema(db);

    await check("legacy fixture exposes the direct-write bypass before migration", async () => {
      for (const role of ["anon", "authenticated"] as const) {
        for (const table of ["field_map_imports", "field_geometries"] as const) {
          for (const privilege of ["INSERT", "UPDATE", "DELETE"] as const) {
            assert.equal(
              await scalar<boolean>(db, `select has_table_privilege($1, $2, $3)`, [role, `public.${table}`, privilege]),
              true,
            );
          }
        }
      }
      assert.equal(await scalar<number>(db, `
        select count(*)::integer
        from pg_policies
        where schemaname = 'public'
          and tablename in ('field_map_imports', 'field_geometries')
          and cmd in ('INSERT', 'UPDATE', 'DELETE')
      `), 6);
    });

    await check("both checked-in migrations apply verbatim", async () => {
      await applyUnmodifiedMigrations(db);
      for (const name of [
        "mutate_field_boundary_v1",
        "get_field_map_snapshot_v1",
        "confirm_field_map_import_v2",
        "set_field_map_import_state_v2",
      ]) {
        assert.equal(await scalar<number>(db, `
          select count(*)::integer from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
          where namespace.nspname = 'public' and procedure.proname = $1
        `, [name]), 1);
      }
    });

    await check("anon/authenticated DML and RPC execution are revoked while service_role is granted", async () => {
      assert.equal(await scalar<number>(db, `
        select count(*)::integer
        from pg_policies
        where schemaname = 'public'
          and tablename in ('field_map_imports', 'field_geometries')
          and cmd in ('INSERT', 'UPDATE', 'DELETE')
      `), 0);
      for (const role of ["anon", "authenticated"] as const) {
        for (const table of ["field_map_imports", "field_geometries"] as const) {
          for (const privilege of ["INSERT", "UPDATE", "DELETE"] as const) {
            assert.equal(
              await scalar<boolean>(db, `select has_table_privilege($1, $2, $3)`, [role, `public.${table}`, privilege]),
              false,
            );
          }
        }
      }
      for (const table of ["field_map_imports", "field_geometries"] as const) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
          assert.equal(
            await scalar<boolean>(db, `select has_table_privilege('service_role', $1, $2)`, [`public.${table}`, privilege]),
            true,
          );
        }
      }
      const signatures = [
        "public.mutate_field_boundary_v1(uuid,uuid,text,uuid,uuid,uuid,jsonb,numeric)",
        "public.get_field_map_snapshot_v1(uuid)",
        "public.confirm_field_map_import_v2(uuid,uuid,uuid,jsonb,jsonb,integer,integer,integer,jsonb)",
        "public.set_field_map_import_state_v2(uuid,uuid,uuid,text,jsonb,timestamptz)",
      ];
      for (const signature of signatures) {
        assert.equal(await scalar<boolean>(db, `select has_function_privilege('anon', $1, 'EXECUTE')`, [signature]), false);
        assert.equal(await scalar<boolean>(db, `select has_function_privilege('authenticated', $1, 'EXECUTE')`, [signature]), false);
        assert.equal(await scalar<boolean>(db, `select has_function_privilege('service_role', $1, 'EXECUTE')`, [signature]), true);
      }
    });

    await seedFixtures(db);

    await check("revoked grants block real anon/authenticated DML and RPC calls", async () => {
      await assertDirectDmlDenied(db, "anon");
      await assertDirectDmlDenied(db, "authenticated");
      const serviceSnapshot = await getFieldMapSnapshotAs(db, "service_role", ids.companyA);
      const serviceRevision = serviceSnapshot.revision as DbRow;
      assert.deepEqual(
        (serviceSnapshot.fields as DbRow[]).map((field) => field.id),
        [ids.fieldA1, ids.fieldA2, ids.fieldA3],
      );
      assert.deepEqual(serviceRevision.active_import_ids, [ids.legacyImportA]);
      const row: ResolvedRow = {
        polygon_id: "denied",
        field_id: ids.fieldA1,
        geometry_geojson: polygon(10),
        area_from_kml_ha: 1,
      };
      for (const role of ["anon", "authenticated"] as const) {
        await expectDatabaseError(
          `${role} snapshot RPC execute`,
          () => getFieldMapSnapshotAs(db, role, ids.companyA),
          /permission denied for function get_field_map_snapshot_v1/i,
        );
        await expectDatabaseError(
          `${role} RPC execute`,
          () => confirmImportAs(db, role, {
            companyId: ids.companyA,
            importId: ids.happyImportA,
            actorId: ids.admin,
            resolvedRows: [row],
            total: 1,
            unmatched: 0,
            errors: 0,
          }),
          /permission denied for function confirm_field_map_import_v2/i,
        );
      }
    });

    const companyBSentinel = await activeSnapshot(db, ids.companyB);
    const happyRows: ResolvedRow[] = [
      {
        polygon_id: "polygon-a1",
        field_id: ids.fieldA1,
        geometry_geojson: polygon(10),
        area_from_kml_ha: 11.25,
      },
      {
        polygon_id: "polygon-a2",
        field_id: ids.fieldA2,
        geometry_geojson: multiPolygon(20),
        area_from_kml_ha: 22.5,
      },
    ];
    let originalHappyImportRows: DbRow[] = [];

    await check("atomic confirm replaces only the company snapshot and writes audit", async () => {
      const result = await confirmImportAs(db, "service_role", {
        companyId: ids.companyA,
        importId: ids.happyImportA,
        actorId: ids.admin,
        resolvedRows: happyRows,
        total: 3,
        unmatched: 1,
        errors: 0,
      });
      assert.deepEqual(result, {
        import_id: ids.happyImportA,
        saved_polygons: 2,
        skipped_polygons: 1,
        status: "imported",
      });
      const snapshot = await activeSnapshot(db, ids.companyA);
      assert.deepEqual(snapshot.imports, [{ id: ids.happyImportA, status: "imported", is_active: true }]);
      assert.equal(snapshot.geometries.length, 2);
      assert.deepEqual(snapshot.geometries.map((row) => row.field_id), [ids.fieldA1, ids.fieldA2]);
      assert.ok(snapshot.geometries.every((row) => row.import_id === ids.happyImportA && row.is_active === true));
      assert.equal(await scalar<number>(db, `
        select count(*)::integer from public.field_geometries
        where id in ($1::uuid, $2::uuid) and is_active = false
      `, [ids.legacyGeometryA1, ids.legacyGeometryA2]), 2);
      const audit = await rows(db, `
        select who::text, entity_id, action, new_values, reason
        from public.audit_log where action = 'confirm_atomic_v2'
      `);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].who, ids.admin);
      assert.equal(audit[0].entity_id, ids.happyImportA);
      assert.deepEqual(audit[0].new_values, {
        active: true,
        matched_polygons: 2,
        source_file_name: "happy-a.kml",
        total_polygons: 3,
        unmatched_polygons: 1,
      });
      assert.equal(audit[0].reason, "Validated KML import confirmation");
      originalHappyImportRows = await immutableImportGeometryRows(db, ids.companyA, ids.happyImportA);
      assert.equal(originalHappyImportRows.length, 2);
      assert.deepEqual(
        originalHappyImportRows.map((row) => row.field_id),
        [ids.fieldA1, ids.fieldA2],
      );
      assert.deepEqual(await activeSnapshot(db, ids.companyB), companyBSentinel);
    });

    await check("duplicate field rejection preserves the full previous snapshot", async () => {
      const before = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "duplicate field",
        () => confirmImportAs(db, "service_role", {
          companyId: ids.companyA,
          importId: ids.duplicateImportA,
          actorId: ids.admin,
          resolvedRows: [
            { ...happyRows[0], polygon_id: "duplicate-1" },
            { ...happyRows[0], polygon_id: "duplicate-2", geometry_geojson: polygon(30) },
          ],
          total: 2,
          unmatched: 0,
          errors: 0,
        }),
        /FIELD_MAP_DUPLICATE_FIELD/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), before);
    });

    await check("post-deactivation insert error rolls back the full previous snapshot", async () => {
      const before = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "numeric overflow after deactivation",
        () => confirmImportAs(db, "service_role", {
          companyId: ids.companyA,
          importId: ids.overflowImportA,
          actorId: ids.admin,
          resolvedRows: [{
            polygon_id: "overflow",
            field_id: ids.fieldA1,
            geometry_geojson: polygon(40),
            area_from_kml_ha: 10_000_000_000,
          }],
          total: 1,
          unmatched: 0,
          errors: 0,
        }),
        /numeric field overflow|overflows numeric format/i,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), before);
    });

    await check("confirm role, company, field-scope and draft CAS guards preserve state", async () => {
      const before = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "confirm role guard",
        () => confirmImportAs(db, "service_role", {
          companyId: ids.companyA,
          importId: ids.scopedImportA,
          actorId: ids.agronomist,
          resolvedRows: [happyRows[0]],
          total: 1,
          unmatched: 0,
          errors: 0,
        }),
        /FIELD_MAP_GLOBAL_ADMIN_REQUIRED/,
      );
      await expectDatabaseError(
        "confirm company guard",
        () => confirmImportAs(db, "service_role", {
          companyId: ids.companyB,
          importId: ids.scopedImportA,
          actorId: ids.admin,
          resolvedRows: [{ ...happyRows[0], field_id: ids.fieldB1 }],
          total: 1,
          unmatched: 0,
          errors: 0,
        }),
        /FIELD_MAP_IMPORT_NOT_FOUND/,
      );
      await expectDatabaseError(
        "confirm field scope guard",
        () => confirmImportAs(db, "service_role", {
          companyId: ids.companyA,
          importId: ids.scopedImportA,
          actorId: ids.admin,
          resolvedRows: [{ ...happyRows[0], field_id: ids.fieldB1 }],
          total: 1,
          unmatched: 0,
          errors: 0,
        }),
        /FIELD_MAP_FIELD_SCOPE_MISMATCH/,
      );
      await expectDatabaseError(
        "confirm draft CAS guard",
        () => confirmImportAs(db, "service_role", {
          companyId: ids.companyA,
          importId: ids.happyImportA,
          actorId: ids.admin,
          resolvedRows: [happyRows[0]],
          total: 1,
          unmatched: 0,
          errors: 0,
        }),
        /FIELD_MAP_IMPORT_NOT_DRAFT/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), before);
      assert.deepEqual(await activeSnapshot(db, ids.companyB), companyBSentinel);
    });

    await check("import state RPC deactivates, activates and archives atomically with audit", async () => {
      const deactivated = await setImportStateAs(
        db, "service_role", ids.companyA, ids.happyImportA, ids.admin, "deactivate",
      );
      assert.equal(deactivated.action, "deactivate");
      assert.deepEqual(await activeSnapshot(db, ids.companyA), { imports: [], geometries: [] });

      const activated = await setImportStateAs(
        db, "service_role", ids.companyA, ids.happyImportA, ids.admin, "activate",
      );
      assert.equal(activated.action, "activate");
      assert.equal((await activeSnapshot(db, ids.companyA)).geometries.length, 2);

      const archived = await setImportStateAs(
        db, "service_role", ids.companyA, ids.archiveImportA, ids.admin, "archive",
      );
      assert.equal(archived.status, "archived");
      assert.equal(await scalar<string>(db, `
        select status from public.field_map_imports where id = $1::uuid
      `, [ids.archiveImportA]), "archived");
      assert.equal(await scalar<number>(db, `
        select count(*)::integer from public.audit_log
        where action in ('state_deactivate_atomic_v2', 'state_activate_atomic_v2', 'state_archive_atomic_v2')
      `), 3);
      assert.deepEqual(await activeSnapshot(db, ids.companyB), companyBSentinel);
    });

    await check("import state role and company guards reject without side effects", async () => {
      const before = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "state role guard",
        () => setImportStateAs(db, "service_role", ids.companyA, ids.happyImportA, ids.agronomist, "deactivate"),
        /FIELD_MAP_GLOBAL_ADMIN_REQUIRED/,
      );
      await expectDatabaseError(
        "state company guard",
        () => setImportStateAs(db, "service_role", ids.companyB, ids.happyImportA, ids.admin, "deactivate"),
        /FIELD_MAP_IMPORT_NOT_FOUND/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), before);
      assert.deepEqual(await activeSnapshot(db, ids.companyB), companyBSentinel);
    });

    let replacedGeometryId = "";
    let relinkedGeometryId = "";
    let postUnlinkReplacementGeometryId = "";
    let restoredGeometryId = "";

    await check("boundary role, company and CAS guards preserve the active geometry", async () => {
      const activeA1 = await activeGeometryId(db, ids.companyA, ids.fieldA1);
      const before = await companyFingerprint(db, ids.companyA);
      const base = {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "replace",
        fieldId: ids.fieldA1,
        expectedGeometryId: activeA1,
        targetFieldId: null,
        geometry: polygon(50),
        area: 51,
      };
      await expectDatabaseError(
        "boundary role guard",
        () => mutateBoundaryAs(db, "service_role", { ...base, actorId: ids.agronomist }),
        /FIELD_MAP_GLOBAL_ADMIN_REQUIRED/,
      );
      await expectDatabaseError(
        "boundary inactive role guard",
        () => mutateBoundaryAs(db, "service_role", { ...base, actorId: ids.inactiveAdmin }),
        /FIELD_MAP_GLOBAL_ADMIN_REQUIRED/,
      );
      await expectDatabaseError(
        "boundary company guard",
        () => mutateBoundaryAs(db, "service_role", { ...base, companyId: ids.companyB }),
        /FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH/,
      );
      await expectDatabaseError(
        "boundary null expected CAS guard",
        () => mutateBoundaryAs(db, "service_role", { ...base, expectedGeometryId: null }),
        /FIELD_BOUNDARY_CAS_FAILED/,
      );
      await expectDatabaseError(
        "boundary stale expected CAS guard",
        () => mutateBoundaryAs(db, "service_role", { ...base, expectedGeometryId: ids.missingGeometry }),
        /FIELD_BOUNDARY_CAS_FAILED/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), before);
    });

    await check("replace creates one active revision and records source/result audit", async () => {
      const activeA1 = await activeGeometryId(db, ids.companyA, ids.fieldA1);
      const result = await mutateBoundaryAs(db, "service_role", {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "replace",
        fieldId: ids.fieldA1,
        expectedGeometryId: activeA1,
        targetFieldId: null,
        geometry: polygon(60),
        area: 61.5,
      });
      replacedGeometryId = String(result.geometry_id);
      assert.equal(result.action, "replace");
      assert.equal(result.previous_geometry_id, activeA1);
      assert.equal(result.field_id, ids.fieldA1);
      assert.equal(await activeGeometryId(db, ids.companyA, ids.fieldA1), replacedGeometryId);
      assert.equal(await scalar<boolean>(db, `select is_active from public.field_geometries where id = $1::uuid`, [activeA1]), false);
      const audit = (await rows(db, `
        select old_values, new_values, reason from public.audit_log
        where action = 'boundary_replace_atomic_v1' order by when_at desc, id desc limit 1
      `))[0];
      assert.equal((audit.old_values as DbRow).source_geometry_id, activeA1);
      assert.equal((audit.new_values as DbRow).geometry_id, replacedGeometryId);
      assert.equal((audit.new_values as DbRow).field_id, ids.fieldA1);
      assert.equal(audit.reason, "Validated full boundary revision");
    });

    await check("stale replace and occupied relink roll back without audit", async () => {
      const before = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "stale replace",
        () => mutateBoundaryAs(db, "service_role", {
          companyId: ids.companyA,
          actorId: ids.admin,
          action: "replace",
          fieldId: ids.fieldA1,
          expectedGeometryId: ids.legacyGeometryA1,
          targetFieldId: null,
          geometry: polygon(70),
          area: 70,
        }),
        /FIELD_BOUNDARY_CAS_FAILED/,
      );
      const activeA2 = await activeGeometryId(db, ids.companyA, ids.fieldA2);
      await expectDatabaseError(
        "occupied relink",
        () => mutateBoundaryAs(db, "service_role", {
          companyId: ids.companyA,
          actorId: ids.admin,
          action: "relink",
          fieldId: ids.fieldA2,
          expectedGeometryId: activeA2,
          targetFieldId: ids.fieldA1,
          geometry: null,
          area: null,
        }),
        /FIELD_BOUNDARY_TARGET_OCCUPIED/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), before);
    });

    await check("relink moves a boundary revision to an empty field and audits it", async () => {
      const activeA2 = await activeGeometryId(db, ids.companyA, ids.fieldA2);
      const result = await mutateBoundaryAs(db, "service_role", {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "relink",
        fieldId: ids.fieldA2,
        expectedGeometryId: activeA2,
        targetFieldId: ids.fieldA3,
        geometry: null,
        area: null,
      });
      relinkedGeometryId = String(result.geometry_id);
      assert.equal(result.action, "relink");
      assert.equal(result.previous_geometry_id, activeA2);
      assert.equal(result.field_id, ids.fieldA3);
      assert.equal(await scalar<number>(db, `
        select count(*)::integer from public.field_geometries
        where company_id = $1::uuid and field_id = $2::uuid and is_active = true
      `, [ids.companyA, ids.fieldA2]), 0);
      assert.equal(await activeGeometryId(db, ids.companyA, ids.fieldA3), relinkedGeometryId);
      assert.equal(await scalar<number>(db, `
        select count(*)::integer from public.audit_log where action = 'boundary_relink_atomic_v1'
      `), 1);
    });

    await check("unlink deactivates exactly the expected revision and writes reversible audit", async () => {
      const result = await mutateBoundaryAs(db, "service_role", {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "unlink",
        fieldId: ids.fieldA3,
        expectedGeometryId: relinkedGeometryId,
        targetFieldId: null,
        geometry: null,
        area: null,
      });
      assert.equal(result.action, "unlink");
      assert.equal(result.geometry_id, null);
      assert.equal(result.previous_geometry_id, relinkedGeometryId);
      assert.equal(await scalar<boolean>(db, `select is_active from public.field_geometries where id = $1::uuid`, [relinkedGeometryId]), false);
      const audit = (await rows(db, `
        select entity_id, old_values, new_values, reason from public.audit_log
        where action = 'boundary_unlink_atomic_v1' order by when_at desc, id desc limit 1
      `))[0];
      assert.equal(audit.entity_id, relinkedGeometryId);
      assert.equal((audit.old_values as DbRow).source_geometry_id, relinkedGeometryId);
      assert.equal((audit.new_values as DbRow).active, false);
      assert.equal(audit.reason, "Explicit boundary unlink");
    });

    await check("restore requires matching target and latest company unlink, succeeds once, then rejects reuse", async () => {
      const beforeRejectedRestore = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "restore without unlink audit",
        () => mutateBoundaryAs(db, "service_role", {
          companyId: ids.companyA,
          actorId: ids.admin,
          action: "restore",
          fieldId: ids.fieldA1,
          expectedGeometryId: ids.legacyGeometryA1,
          targetFieldId: ids.fieldA1,
          geometry: null,
          area: null,
        }),
        /FIELD_BOUNDARY_RESTORE_NOT_ALLOWED/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), beforeRejectedRestore);

      await expectDatabaseError(
        "restore target differs from source field",
        () => mutateBoundaryAs(db, "service_role", {
          companyId: ids.companyA,
          actorId: ids.admin,
          action: "restore",
          fieldId: ids.fieldA3,
          expectedGeometryId: relinkedGeometryId,
          targetFieldId: ids.fieldA2,
          geometry: null,
          area: null,
        }),
        /FIELD_BOUNDARY_RESTORE_TARGET_MISMATCH/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), beforeRejectedRestore);

      const interveningReplacement = await mutateBoundaryAs(db, "service_role", {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "replace",
        fieldId: ids.fieldA1,
        expectedGeometryId: replacedGeometryId,
        targetFieldId: null,
        geometry: polygon(80),
        area: 81.5,
      });
      postUnlinkReplacementGeometryId = String(interveningReplacement.geometry_id);
      const afterInterveningBoundaryAction = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "restore after a newer company boundary action",
        () => mutateBoundaryAs(db, "service_role", {
          companyId: ids.companyA,
          actorId: ids.admin,
          action: "restore",
          fieldId: ids.fieldA3,
          expectedGeometryId: relinkedGeometryId,
          targetFieldId: ids.fieldA3,
          geometry: null,
          area: null,
        }),
        /FIELD_BOUNDARY_RESTORE_NOT_ALLOWED/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), afterInterveningBoundaryAction);

      const latestUnlink = await mutateBoundaryAs(db, "service_role", {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "unlink",
        fieldId: ids.fieldA1,
        expectedGeometryId: postUnlinkReplacementGeometryId,
        targetFieldId: null,
        geometry: null,
        area: null,
      });
      assert.equal(latestUnlink.previous_geometry_id, postUnlinkReplacementGeometryId);

      const restored = await mutateBoundaryAs(db, "service_role", {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "restore",
        fieldId: ids.fieldA1,
        expectedGeometryId: postUnlinkReplacementGeometryId,
        targetFieldId: ids.fieldA1,
        geometry: null,
        area: null,
      });
      restoredGeometryId = String(restored.geometry_id);
      assert.equal(restored.action, "restore");
      assert.equal(restored.previous_geometry_id, postUnlinkReplacementGeometryId);
      assert.equal(await activeGeometryId(db, ids.companyA, ids.fieldA1), restoredGeometryId);
      const afterRestore = await companyFingerprint(db, ids.companyA);

      await expectDatabaseError(
        "second restore",
        () => mutateBoundaryAs(db, "service_role", {
          companyId: ids.companyA,
          actorId: ids.admin,
          action: "restore",
          fieldId: ids.fieldA1,
          expectedGeometryId: postUnlinkReplacementGeometryId,
          targetFieldId: ids.fieldA1,
          geometry: null,
          area: null,
        }),
        /FIELD_BOUNDARY_RESTORE_NOT_ALLOWED/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), afterRestore);
      const restoreAudit = (await rows(db, `
        select old_values, new_values, reason from public.audit_log
        where action = 'boundary_restore_atomic_v1'
      `))[0];
      assert.equal((restoreAudit.old_values as DbRow).source_geometry_id, postUnlinkReplacementGeometryId);
      assert.equal((restoreAudit.new_values as DbRow).geometry_id, restoredGeometryId);
      assert.equal(restoreAudit.reason, "One-time undo of explicit boundary unlink");
    });

    await check("manual revisions stay detached from imports across deactivate and exact reactivation", async () => {
      const manualRevisionIds = [
        replacedGeometryId,
        relinkedGeometryId,
        postUnlinkReplacementGeometryId,
        restoredGeometryId,
      ];
      const manualRows = await rows(db, `
        select id::text, import_id::text, is_active
        from public.field_geometries
        where id in ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
        order by id
      `, manualRevisionIds);
      assert.equal(manualRows.length, 4);
      assert.ok(manualRows.every((row) => row.import_id === null));
      assert.deepEqual(
        (await activeSnapshot(db, ids.companyA)).geometries.map((row) => row.id),
        [restoredGeometryId],
      );

      const deactivated = await setImportStateAs(
        db, "service_role", ids.companyA, ids.happyImportA, ids.admin, "deactivate",
      );
      assert.equal(deactivated.active, false);
      assert.deepEqual(await activeSnapshot(db, ids.companyA), { imports: [], geometries: [] });
      assert.equal(await scalar<number>(db, `
        select count(*)::integer
        from public.field_geometries
        where company_id = $1::uuid and is_active = true
      `, [ids.companyA]), 0);

      const activated = await setImportStateAs(
        db, "service_role", ids.companyA, ids.happyImportA, ids.admin, "activate",
      );
      assert.equal(activated.active, true);
      const restoredSnapshot = await activeSnapshot(db, ids.companyA);
      assert.deepEqual(restoredSnapshot.imports, [
        { id: ids.happyImportA, status: "imported", is_active: true },
      ]);
      assert.deepEqual(
        restoredSnapshot.geometries.map((row) => ({
          id: row.id,
          field_id: row.field_id,
          import_id: row.import_id,
        })),
        originalHappyImportRows.map((row) => ({
          id: row.id,
          field_id: row.field_id,
          import_id: row.import_id,
        })),
      );
      assert.deepEqual(
        restoredSnapshot.geometries.map((row) => row.field_id),
        [ids.fieldA1, ids.fieldA2],
      );
      assert.deepEqual(
        await immutableImportGeometryRows(db, ids.companyA, ids.happyImportA),
        originalHappyImportRows,
      );
      assert.deepEqual(await rows(db, `
        select count(*)::integer as row_count,
          count(distinct field_id)::integer as field_count
        from public.field_geometries
        where company_id = $1::uuid and import_id = $2::uuid
      `, [ids.companyA, ids.happyImportA]), [{ row_count: 2, field_count: 2 }]);
      assert.equal(await scalar<number>(db, `
        select count(*)::integer
        from public.field_geometries
        where company_id = $1::uuid and import_id is null and is_active = true
      `, [ids.companyA]), 0);
      assert.equal(await scalar<number>(db, `
        select count(*)::integer
        from public.field_geometries
        where id in ($1::uuid, $2::uuid, $3::uuid, $4::uuid) and is_active = false
      `, manualRevisionIds), 4);
    });

    await check("inactive import state actions never extinguish another active snapshot", async () => {
      const activeBefore = await activeSnapshot(db, ids.companyA);
      assert.equal(activeBefore.imports[0].id, ids.happyImportA);

      const inactiveDeactivated = await setImportStateAs(
        db, "service_role", ids.companyA, ids.archiveImportA, ids.admin, "deactivate",
      );
      assert.equal(inactiveDeactivated.active, false);
      assert.deepEqual(await activeSnapshot(db, ids.companyA), activeBefore);

      const otherArchived = await setImportStateAs(
        db, "service_role", ids.companyA, ids.duplicateImportA, ids.admin, "archive",
      );
      assert.equal(otherArchived.active, false);
      assert.equal(otherArchived.status, "archived");
      assert.deepEqual(await activeSnapshot(db, ids.companyA), activeBefore);
      assert.deepEqual(await activeSnapshot(db, ids.companyB), companyBSentinel);
    });

    const staleConfirmInput = {
      companyId: ids.companyA,
      importId: ids.scopedImportA,
      actorId: ids.admin,
      resolvedRows: [{
        polygon_id: "two-tab-field-a3",
        field_id: ids.fieldA3,
        geometry_geojson: polygon(110),
        area_from_kml_ha: 31,
      }],
      total: 1,
      unmatched: 0,
      errors: 0,
    };

    await check("two-tab boundary, import and field changes stale the preview with full rollback", async () => {
      const previewBeforeBoundary = (await getFieldMapSnapshotAs(db, "service_role", ids.companyA)).revision;
      const activeA1 = await activeGeometryId(db, ids.companyA, ids.fieldA1);
      const concurrentBoundary = await mutateBoundaryAs(db, "service_role", {
        companyId: ids.companyA,
        actorId: ids.admin,
        action: "replace",
        fieldId: ids.fieldA1,
        expectedGeometryId: activeA1,
        targetFieldId: null,
        geometry: polygon(100),
        area: 10.5,
      });
      assert.equal(await scalar<string | null>(db, `
        select import_id::text from public.field_geometries where id = $1::uuid
      `, [concurrentBoundary.geometry_id]), null);
      const afterConcurrentBoundary = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "confirm after concurrent boundary change",
        () => confirmImportAs(db, "service_role", {
          ...staleConfirmInput,
          expectedRevision: previewBeforeBoundary,
        }),
        /FIELD_MAP_PREVIEW_STALE/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), afterConcurrentBoundary);

      const previewBeforeImport = (await getFieldMapSnapshotAs(db, "service_role", ids.companyA)).revision;
      await setImportStateAs(
        db, "service_role", ids.companyA, ids.happyImportA, ids.admin, "deactivate",
      );
      const afterConcurrentImport = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "confirm after concurrent import state change",
        () => confirmImportAs(db, "service_role", {
          ...staleConfirmInput,
          expectedRevision: previewBeforeImport,
        }),
        /FIELD_MAP_PREVIEW_STALE/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), afterConcurrentImport);
      await setImportStateAs(
        db, "service_role", ids.companyA, ids.happyImportA, ids.admin, "activate",
      );

      const previewBeforeField = (await getFieldMapSnapshotAs(db, "service_role", ids.companyA)).revision;
      await db.query(`
        update public.fields set name = 'A-3 concurrent', notes = 'changed in another tab'
        where id = $1::uuid and company_id = $2::uuid
      `, [ids.fieldA3, ids.companyA]);
      const afterConcurrentField = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "confirm after concurrent field metadata change",
        () => confirmImportAs(db, "service_role", {
          ...staleConfirmInput,
          expectedRevision: previewBeforeField,
        }),
        /FIELD_MAP_PREVIEW_STALE/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), afterConcurrentField);
    });

    await check("stale state revision and target timestamp reject without side effects", async () => {
      const staleRevision = (await getFieldMapSnapshotAs(db, "service_role", ids.companyA)).revision;
      await db.query(`
        update public.fields set area = area + 1
        where id = $1::uuid and company_id = $2::uuid
      `, [ids.fieldA3, ids.companyA]);
      const targetUpdatedAt = await importUpdatedAt(db, ids.companyA, ids.happyImportA);
      const afterRevisionChange = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "state stale snapshot revision",
        () => setImportStateAs(
          db,
          "service_role",
          ids.companyA,
          ids.happyImportA,
          ids.admin,
          "deactivate",
          { expectedRevision: staleRevision, expectedTargetUpdatedAt: targetUpdatedAt },
        ),
        /FIELD_MAP_STATE_STALE/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), afterRevisionChange);

      const freshRevision = (await getFieldMapSnapshotAs(db, "service_role", ids.companyA)).revision;
      const staleTargetUpdatedAt = await importUpdatedAt(db, ids.companyA, ids.happyImportA);
      await db.query(`
        update public.field_map_imports set updated_at = updated_at + interval '1 second'
        where id = $1::uuid and company_id = $2::uuid
      `, [ids.happyImportA, ids.companyA]);
      assert.deepEqual(
        (await getFieldMapSnapshotAs(db, "service_role", ids.companyA)).revision,
        freshRevision,
      );
      const afterTargetTimestampChange = await companyFingerprint(db, ids.companyA);
      await expectDatabaseError(
        "state stale target timestamp",
        () => setImportStateAs(
          db,
          "service_role",
          ids.companyA,
          ids.happyImportA,
          ids.admin,
          "deactivate",
          { expectedRevision: freshRevision, expectedTargetUpdatedAt: staleTargetUpdatedAt },
        ),
        /FIELD_MAP_STATE_STALE/,
      );
      assert.deepEqual(await companyFingerprint(db, ids.companyA), afterTargetTimestampChange);
      assert.equal((await activeSnapshot(db, ids.companyA)).imports[0].id, ids.happyImportA);
    });

    await check("successful operations have complete scoped audit and never touch company B", async () => {
      const actions = await rows<{ action: string; count: number }>(db, `
        select action, count(*)::integer as count
        from public.audit_log
        where company_id = $1::uuid
        group by action
        order by action
      `, [ids.companyA]);
      assert.deepEqual(actions, [
        { action: "boundary_relink_atomic_v1", count: 1 },
        { action: "boundary_replace_atomic_v1", count: 3 },
        { action: "boundary_restore_atomic_v1", count: 1 },
        { action: "boundary_unlink_atomic_v1", count: 2 },
        { action: "confirm_atomic_v2", count: 1 },
        { action: "state_activate_atomic_v2", count: 3 },
        { action: "state_archive_atomic_v2", count: 2 },
        { action: "state_deactivate_atomic_v2", count: 4 },
      ]);
      assert.equal(await scalar<number>(db, `
        select count(*)::integer from public.audit_log
        where company_id <> $1::uuid or who <> $2::uuid
      `, [ids.companyA, ids.admin]), 0);
      assert.deepEqual(await activeSnapshot(db, ids.companyB), companyBSentinel);
      assert.equal(
        replacedGeometryId.length > 0
          && relinkedGeometryId.length > 0
          && postUnlinkReplacementGeometryId.length > 0
          && restoredGeometryId.length > 0,
        true,
      );
    });

    console.log(JSON.stringify({
      suite: "fields-map migrations PGlite runtime integration",
      passed,
      failed: 0,
      migrations: migrationPaths,
      harnessAdaptations,
      note: "PGlite accepted roles and NOTIFY; both migration files executed verbatim.",
    }, null, 2));
  } finally {
    await db.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
