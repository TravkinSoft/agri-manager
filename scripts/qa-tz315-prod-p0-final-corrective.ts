import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901140732_tz315_field_material_batch_class_corrective_v1.sql",
  import.meta.url,
);
const summariesRouteUrl = new URL("../app/api/warehouses/summaries/route.ts", import.meta.url);

async function main() {
  const db = new PGlite();
  await db.exec(`
    create table public.ticket_lines (
      id uuid primary key,
      product_id uuid not null,
      quantity numeric,
      uom text,
      mass_kg numeric,
      batch_class text,
      density_kg_per_l numeric,
      density_unit text,
      density_source text,
      density_verification_status text,
      density_verified_at timestamptz,
      unit_contract_version smallint
    );

    create table public.field_material_consumptions (
      id uuid primary key default gen_random_uuid(),
      ticket_line_id uuid,
      product_id uuid not null,
      quantity numeric,
      quantity_kg numeric,
      uom text,
      mass_kg numeric,
      batch_class text,
      density_kg_per_l numeric,
      density_unit text,
      density_source text,
      density_verification_status text,
      density_verified_at timestamptz,
      unit_contract_version smallint,
      constraint field_material_consumptions_batch_class_check
        check (batch_class is null or batch_class in ('commodity','seed','feed','waste','processing','rejected'))
    );

    create function public.validate_stock_quantity_contract(
      p_product_id uuid,
      p_quantity numeric,
      p_uom text,
      p_batch_class text,
      p_mass_kg numeric,
      p_density_kg_per_l numeric,
      p_density_unit text,
      p_density_source text,
      p_density_verification_status text,
      p_density_verified_at timestamptz
    ) returns void language plpgsql as $$ begin return; end $$;
  `);

  const migration = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
  await db.exec(migration);
  await db.exec(migration);

  const lineId = "31500000-0000-4000-8000-000000000101";
  const productId = "31500000-0000-4000-8000-000000000102";
  await db.exec(`
    insert into public.ticket_lines(
      id, product_id, quantity, uom, mass_kg, batch_class, unit_contract_version
    ) values (
      '${lineId}', '${productId}', 1, 'kg', 1, 'material', 2
    );
    insert into public.field_material_consumptions(ticket_line_id, product_id)
    values ('${lineId}', '${productId}');
  `);

  const fact = await db.query<Record<string, unknown>>(`
    select quantity::text, quantity_kg::text, uom, mass_kg::text,
           batch_class, unit_contract_version
    from public.field_material_consumptions
  `);
  assert.deepEqual(fact.rows, [{
    quantity: "1",
    quantity_kg: "1",
    uom: "kg",
    mass_kg: "1",
    batch_class: "material",
    unit_contract_version: 2,
  }]);

  const constraints = await db.query<{ name: string; definition: string }>(`
    select conname name, pg_get_constraintdef(oid, true) definition
    from pg_constraint
    where conrelid='public.field_material_consumptions'::regclass
      and conname in (
        'field_material_consumptions_batch_class_check',
        'field_material_consumptions_unit_contract_v2'
      )
    order by conname
  `);
  assert.equal(constraints.rows.length, 2);
  constraints.rows.forEach((row) => assert.match(row.definition, /material/i));

  const trigger = await db.query<{ count: number }>(`
    select count(*)::int count
    from pg_trigger
    where tgrelid='public.field_material_consumptions'::regclass
      and tgname='trg_enforce_field_material_contract_v2'
      and not tgisinternal
  `);
  assert.equal(trigger.rows[0]?.count, 1);

  const summariesRoute = await readFile(summariesRouteUrl, "utf8");
  const balanceQuery = summariesRoute.match(/const \[balancesResult[\s\S]*?Promise\.all\(\[([\s\S]*?)\n    \]\);/)?.[1] || "";
  assert.match(balanceQuery, /from\("v_stock_balance_identity"\)/);
  assert.match(balanceQuery, /warehouse_id,product_id,quantity,uom,batch_class/);
  assert.doesNotMatch(balanceQuery, /from\("v_stock_balance_canonical"\)/);

  console.log("TZ315 Production P0 final corrective: PASS");
  await db.close();
}

main().catch((error) => {
  console.error("TZ315 Production P0 final corrective: FAIL");
  console.error(error);
  process.exitCode = 1;
});
