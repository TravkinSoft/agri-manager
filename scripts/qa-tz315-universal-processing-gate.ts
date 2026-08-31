import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { bootstrapProcessingSourceDebit } from "./qa-tz315-processing-source-debit";

const migrationUrl = new URL(
  "../supabase/migrations/20260831102443_tz315_universal_processing_concurrency_gate_v1.sql",
  import.meta.url,
);
const sourceDebitUrl = new URL(
  "../supabase/migrations/20260831121645_tz315_processing_output_source_debit_v1.sql",
  import.meta.url,
);

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string, params?: unknown[]) =>
  (await db.query(sql, params)).rows as Row[];
const scalar = async (db: PGlite, sql: string) => Object.values((await rows(db, sql))[0] ?? {})[0];

const COMPANY = "31900000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31900000-0000-4000-8000-000000000002";
const ACTOR = "31900000-0000-4000-8000-000000000003";
const OTHER_ACTOR = "31900000-0000-4000-8000-000000000004";
const GLOBAL_ADMIN = "31900000-0000-4000-8000-000000000005";
const EMAIL_AUTH_USER = "31900000-0000-4000-8000-000000000006";
const SEASON = "31900000-0000-4000-8000-000000000011";
const OTHER_SEASON = "31900000-0000-4000-8000-000000000012";
const LOT = "31900000-0000-4000-8000-000000000021";
const DESTINATION_LOT = "31900000-0000-4000-8000-000000000022";
const INVENTORY_BATCH = "31900000-0000-4000-8000-000000000023";
const LOT_LINK = "31900000-0000-4000-8000-000000000024";
const TICKET = "31900000-0000-4000-8000-000000000031";
const NONPROCESSING_TICKET = "31900000-0000-4000-8000-000000000032";
const TRANSFORMATION = "31900000-0000-4000-8000-000000000041";

const targets = [
  ["public.void_ticket_with_storno_v2(uuid,uuid,text)", "993cb6f058a8b8a3b2959c7880e0daf4", "56b24f966e30525abad2601c4fa5d414"],
  ["public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)", "485073abd5b8f85cd65c482e2779fe60", "f51d55b8628848f5d55fe3ae4ae37c81"],
  ["public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text)", "d274a37700b2d505eab3819c4d70a7c8", "078177b34a77442900cd0c2b670dc99d"],
  ["public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text)", "f5c240e5714ab02087c12fef65ddae0d", "369e8dc82e88d9a590f0b65e9ad7005c"],
  ["public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)", "d48fcb31997d70e4ddaa3554b7b42372", "59e195df4b432de27bca6f73491f5d77"],
  ["public.finalize_weighbridge_ticket_v2(uuid,uuid)", "4f2f5c25ee3bb9898256e63351e13420", "f1dcb87a4a4128389d8b9ef6fb6fcd8e"],
  ["public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid)", "9ae55ba26f9b4202a0fcad7314bbdee6", "db9378e76a2ae1324025237ddaf4035e"],
  ["public.finalize_weighbridge_ticket_for_session_v1(uuid)", "d653502088a41e030e391bfad9a3a04e", "33d7f0f183e53187288ed7976d2fd3c3"],
  ["public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)", "c47a12f9d542cb4d11c2c4bca21d9893", "c212c3432f0869064d5c06c145e60467"],
  ["public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text)", "a13d63f36698b6b338c1995ff8cf0f26", "3d7a793e556024c353ee87ad1cdd2ee9"],
  ["public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamp with time zone,text,text,text,jsonb,uuid)", "3321cb3856be8bfb130ac080c9c02f32", "f373241039a2b9efb5ab8d3a53ea8938"],
  ["public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamp with time zone,uuid,uuid,text,text,jsonb,uuid)", "7730438973d27e8bc0bf0f1e6a41f60e", "d85061635dcf2cabc0004b649fe2d7d0"],
  ["public.reassign_harvest_batch_lot_v1(uuid,uuid,text)", "b39fcfc520abeac31197d4cc5e00bbfb", "881612b337e75679957b4182d93ec4e2"],
] as const;

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;

    create or replace function auth.uid() returns uuid language sql stable set search_path='' as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
    $$;
    create or replace function auth.role() returns text language sql stable set search_path='' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.role', true),''),
        (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role')
      )::text
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable set search_path='' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true),'')::jsonb,
        jsonb_build_object('email',nullif(current_setting('request.jwt.claim.email',true),''))
      )
    $$;
    create table public.profiles(id uuid primary key,company_id uuid,role text,status text,email text);
    create table public.global_admin_company_contexts(user_id uuid,company_id uuid);
    create table public.global_admin_impersonation_contexts(
      admin_user_id uuid,impersonated_profile_id uuid,impersonated_company_id uuid,
      updated_at timestamptz default now()
    );
    create table public.seasons(id uuid primary key,company_id uuid not null);
    create table public.harvest_lots(
      id uuid primary key,company_id uuid not null,season_id uuid,status text not null default 'active',
      merged_into_lot_id uuid,updated_at timestamptz default now()
    );
    create table public.inventory_batches(
      id uuid primary key,company_id uuid not null,season_id uuid,status text not null default 'active'
    );
    create table public.harvest_lot_batches(
      id uuid primary key,company_id uuid not null,harvest_lot_id uuid not null,
      inventory_batch_id uuid not null unique,assigned_by uuid,assignment_reason text,
      updated_at timestamptz default now()
    );
    create table public.tickets(
      id uuid primary key, company_id uuid not null, season_id uuid,
      harvest_lot_id uuid, linked_processing_id uuid
    );
    create table public.batch_transformations(
      id uuid primary key, company_id uuid not null, season_id uuid not null,
      harvest_lot_id uuid, node_warehouse_id uuid, processing_node_id uuid,
      transformation_type text
    );
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      transformation_id uuid not null, source_ticket_id uuid
    );
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      transformation_id uuid not null, source_ticket_id uuid
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      ticket_id uuid, processing_id uuid
    );
    insert into public.profiles values
      ('${ACTOR}','${COMPANY}','company_admin','active','actor@example.test'),
      ('${OTHER_ACTOR}','${OTHER_COMPANY}','company_admin','active','other@example.test'),
      ('${GLOBAL_ADMIN}','${OTHER_COMPANY}','global_admin','active','ga@example.test');
    insert into public.seasons values ('${SEASON}','${COMPANY}'),('${OTHER_SEASON}','${OTHER_COMPANY}');
    insert into public.harvest_lots(id,company_id,season_id) values
      ('${LOT}','${COMPANY}','${SEASON}'),
      ('${DESTINATION_LOT}','${COMPANY}','${SEASON}');
    insert into public.inventory_batches(id,company_id,season_id)
      values('${INVENTORY_BATCH}','${COMPANY}','${SEASON}');
    insert into public.harvest_lot_batches(id,company_id,harvest_lot_id,inventory_batch_id)
      values('${LOT_LINK}','${COMPANY}','${LOT}','${INVENTORY_BATCH}');
    insert into public.batch_transformations values(
      '${TRANSFORMATION}','${COMPANY}','${SEASON}','${LOT}',null,null,'cleaning'
    );
    insert into public.tickets values('${TICKET}','${COMPANY}',null,'${LOT}',null);
    insert into public.tickets values('${NONPROCESSING_TICKET}','${COMPANY}',null,null,null);
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
      values('${COMPANY}','${TRANSFORMATION}','${TICKET}');

    create or replace function public.get_user_company_id()
    returns uuid language sql stable security definer set search_path='' as $$
      select p.company_id from public.profiles p where p.id=auth.uid() limit 1
    $$;
    create or replace function public.resolve_actor_context_from_session_v1()
    returns table(
      auth_user_id uuid,profile_id uuid,profile_user_id uuid,role text,status text,
      company_id uuid,email text,context_company_id uuid,impersonated_profile_id uuid,
      impersonated_company_id uuid,impersonated_role text,impersonated_status text,
      impersonated_email text
    ) language plpgsql security definer set search_path=pg_catalog,public as $$
    declare
      v_auth_user_id uuid:=auth.uid(); v_email text:=lower(coalesce(auth.jwt()->>'email',''));
      v_profile public.profiles%rowtype; v_impersonated public.profiles%rowtype;
      v_impersonation public.global_admin_impersonation_contexts%rowtype;
    begin
      if v_auth_user_id is null then return; end if;
      select * into v_profile from public.profiles p
      where p.id=v_auth_user_id or (v_email<>'' and lower(coalesce(p.email,''))=v_email)
      order by case when p.id=v_auth_user_id then 0 else 2 end,
        case when coalesce(p.status,'active')='active' then 0 else 1 end limit 1;
      if not found then return; end if;
      select gac.company_id into context_company_id from public.global_admin_company_contexts gac
      where gac.user_id in(v_profile.id,v_auth_user_id)
      order by case when gac.user_id=v_profile.id then 0 else 1 end limit 1;
      select * into v_impersonation from public.global_admin_impersonation_contexts gai
      where gai.admin_user_id in(v_profile.id,v_auth_user_id) order by gai.updated_at desc limit 1;
      if v_impersonation.impersonated_profile_id is not null then
        select * into v_impersonated from public.profiles p
        where p.id=v_impersonation.impersonated_profile_id limit 1;
      end if;
      auth_user_id:=v_auth_user_id; profile_id:=v_profile.id; profile_user_id:=null;
      role:=v_profile.role; status:=v_profile.status; company_id:=v_profile.company_id; email:=v_profile.email;
      impersonated_profile_id:=v_impersonation.impersonated_profile_id;
      impersonated_company_id:=coalesce(v_impersonation.impersonated_company_id,v_impersonated.company_id);
      impersonated_role:=v_impersonated.role; impersonated_status:=v_impersonated.status;
      impersonated_email:=v_impersonated.email; return next;
    end $$;
    revoke all on function public.resolve_actor_context_from_session_v1() from public,anon;
    grant execute on function public.resolve_actor_context_from_session_v1() to service_role,authenticated;
    create or replace function public.tz297_assert_processing_actor_v1(uuid,uuid,text[])
    returns void language sql security definer set search_path='' as $$ select $$;

    create or replace function public.void_ticket_with_storno_v2(p_ticket_id uuid,p_actor_user_id uuid,p_reason text)
    returns uuid language plpgsql security definer set search_path='' as $$
    begin
      if auth.uid() is null or auth.uid() is distinct from p_actor_user_id then
        raise exception 'WEIGHBRIDGE_VOID_FORBIDDEN';
      end if;
      if not exists(select 1 from public.profiles p where p.id=p_actor_user_id and p.status='active') then
        raise exception 'WEIGHBRIDGE_VOID_ACTOR_NOT_FOUND';
      end if;
      if false then raise exception 'WEIGHBRIDGE_VOID_PROCESSING_CYCLE_REVERSAL_REQUIRED'; end if; return $1;
    end $$;
    create or replace function public.void_weighbridge_ticket_for_session_v1(p_ticket_id uuid,p_reason text)
    returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      return public.void_ticket_with_storno_v2(p_ticket_id,auth.uid(),p_reason);
    end $$;
    create or replace function public.reverse_processing_material_balance_v1(p_transformation_id uuid,p_company_id uuid,p_season_id uuid,p_actor_user_id uuid,p_reason text,p_idempotency_key text,p_audit_run_code text default null)
    returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      perform 1 from public.batch_transformations where id=$1 for update; return '{}'::jsonb;
    end $$;
    create or replace function public.finalize_harvest_intake_for_session_v1(p_ticket_id uuid,p_lock_token text,p_tare_weight numeric,p_moisture_percent numeric default null,p_impurity_percent numeric default null,p_other_percent numeric default null,p_notes text default null,p_manual_weight boolean default false,p_idempotency_key text default null)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
    begin
      perform 1 from public.tickets where id=$1 for update; return '{}'::jsonb;
    end $$;
    create or replace function public.close_transfer_ticket_atomic_v2(p_ticket_id uuid,p_lock_token text,p_tare_weight numeric,p_moisture_percent numeric default null,p_manual_weight boolean default false,p_idempotency_key text default null)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
    begin
      perform 1 from public.tickets where id=$1 for update; return '{}'::jsonb;
    end $$;
    create or replace function public.close_processing_output_ticket_atomic_v1(p_ticket_id uuid,p_lock_token text,p_tare_weight numeric,p_moisture_percent numeric default null,p_manual_weight boolean default false,p_idempotency_key text default null)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
    begin
      perform 1 from public.tickets where id=$1 for update; return '{}'::jsonb;
    end $$;
    create or replace function public.finalize_weighbridge_ticket_v2(p_ticket_id uuid,p_actor_user_id uuid)
    returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      perform 1 from public.tickets where id=$1 for update; return $1;
    end $$;
    create or replace function public.finalize_weighbridge_ticket_authenticated_v1(p_ticket_id uuid,p_actor_user_id uuid)
    returns uuid language plpgsql security definer set search_path='' as $$
    begin
      perform 1 from public.tickets where id=$1 for update; return public.finalize_weighbridge_ticket_v2($1,$2);
    end $$;
    create or replace function public.finalize_weighbridge_ticket_for_session_v1(p_ticket_id uuid)
    returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      perform 1 from public.tickets where id=$1 for update; return public.finalize_weighbridge_ticket_v2($1,auth.uid());
    end $$;
    create or replace function public.finalize_weighbridge_impurity_ticket_for_session_v1(p_ticket_id uuid)
    returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      perform 1 from public.tickets where id=$1 for update; return public.finalize_weighbridge_ticket_v2($1,auth.uid());
    end $$;
    create or replace function public.create_supplier_invoice_atomic_v1(p_company_id uuid,p_supplier_id uuid,p_document_no text,p_notes text,p_lines jsonb,p_vehicle_id uuid,p_driver_id uuid,p_idempotency_key uuid,p_request_fingerprint text)
    returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      return '{}'::jsonb;
    end $$;
    create or replace function public.create_warehouse_receipt_atomic_v1(p_company_id uuid,p_warehouse_id uuid,p_received_at timestamptz,p_supplier text,p_document_no text,p_notes text,p_lines jsonb,p_idempotency_key uuid)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      return '{}'::jsonb;
    end $$;
    create or replace function public.create_warehouse_receipt_atomic_v2(p_company_id uuid,p_warehouse_id uuid,p_received_at timestamptz,p_supplier_company_counterparty_id uuid,p_supplier_global_counterparty_id uuid,p_document_no text,p_notes text,p_lines jsonb,p_idempotency_key uuid)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      return '{}'::jsonb;
    end $$;
    create or replace function public.reassign_harvest_batch_lot_v1(p_inventory_batch_id uuid,p_destination_lot_id uuid,p_reason text)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
    declare v_actor public.profiles%rowtype; v_link public.harvest_lot_batches%rowtype;
    begin
      select * into v_actor from public.profiles where id=auth.uid() and status='active';
      if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'reason'; end if;
  select * into v_link from public.harvest_lot_batches
  where inventory_batch_id = p_inventory_batch_id for update;
      return jsonb_build_object('ok',true);
    end $$;

    revoke all on function public.void_ticket_with_storno_v2(uuid,uuid,text) from public,anon,authenticated;
    grant execute on function public.void_ticket_with_storno_v2(uuid,uuid,text) to service_role;
    revoke all on function public.void_weighbridge_ticket_for_session_v1(uuid,text) from public,anon;
    grant execute on function public.void_weighbridge_ticket_for_session_v1(uuid,text) to authenticated,service_role;
    revoke all on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text) from public,anon;
    grant execute on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text) to service_role,authenticated;
    revoke all on function public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text) from public,anon;
    grant execute on function public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text) to authenticated,service_role;
    revoke all on function public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text) from public,anon;
    grant execute on function public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text) to authenticated,service_role;
    revoke all on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text) from public,anon;
    grant execute on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text) to authenticated,service_role;
    revoke all on function public.finalize_weighbridge_ticket_v2(uuid,uuid) from public,anon,authenticated;
    grant execute on function public.finalize_weighbridge_ticket_v2(uuid,uuid) to service_role;
    revoke all on function public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid) from public,anon;
    grant execute on function public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid) to authenticated,service_role;
    revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from public,anon;
    grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to service_role,authenticated;
    revoke all on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) from public,anon;
    grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) to authenticated,service_role;
    revoke all on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) from public,anon;
    grant execute on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) to authenticated,service_role;
    revoke all on function public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamptz,text,text,text,jsonb,uuid) from public,anon;
    grant execute on function public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamptz,text,text,text,jsonb,uuid) to authenticated,service_role;
    revoke all on function public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamptz,uuid,uuid,text,text,jsonb,uuid) from public,anon,authenticated;
    grant execute on function public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamptz,uuid,uuid,text,text,jsonb,uuid) to service_role;
    revoke all on function public.reassign_harvest_batch_lot_v1(uuid,uuid,text) from public,anon;
    grant execute on function public.reassign_harvest_batch_lot_v1(uuid,uuid,text) to authenticated,service_role;
  `);
  await scalar(db, `select set_config('request.jwt.claim.sub','${ACTOR}',false)`);
  await scalar(db, `select set_config('request.jwt.claim.role','authenticated',false)`);
}

async function bootstrapMigrationOrder(db: PGlite) {
  await bootstrapProcessingSourceDebit(db);
  await db.exec(`
    create schema auth;
    create or replace function auth.uid() returns uuid language sql stable set search_path='' as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
    $$;
    create or replace function auth.role() returns text language sql stable set search_path='' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.role', true),''),
        (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role')
      )::text
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable set search_path='' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true),'')::jsonb,
        jsonb_build_object('email',nullif(current_setting('request.jwt.claim.email',true),''))
      )
    $$;
    create table public.profiles(id uuid primary key,company_id uuid,role text,status text,email text);
    create table public.global_admin_company_contexts(user_id uuid,company_id uuid);
    create table public.global_admin_impersonation_contexts(
      admin_user_id uuid,impersonated_profile_id uuid,impersonated_company_id uuid,
      updated_at timestamptz default now()
    );
    create table public.seasons(id uuid primary key,company_id uuid not null);
    create table public.harvest_lots(
      id uuid primary key,company_id uuid not null,season_id uuid,status text not null default 'active'
    );
    alter table public.harvest_lot_batches add column id uuid default gen_random_uuid();
    alter table public.harvest_lot_batches add column company_id uuid;
    alter table public.harvest_lot_batches add column harvest_lot_id uuid;
    alter table public.tickets add column harvest_lot_id uuid;
    alter table public.batch_transformations add column node_warehouse_id uuid;
    alter table public.batch_transformations add column processing_node_id uuid;
    alter table public.batch_transformation_inputs add column source_ticket_id uuid;

    insert into public.profiles values('${ACTOR}','${COMPANY}','company_admin','active','actor@example.test');
    insert into public.seasons values('${SEASON}','${COMPANY}');
    insert into public.harvest_lots values('${LOT}','${COMPANY}','${SEASON}');

    create or replace function public.get_user_company_id()
    returns uuid language sql stable security definer set search_path='' as $$
      select p.company_id from public.profiles p where p.id=auth.uid() limit 1
    $$;
    create or replace function public.resolve_actor_context_from_session_v1()
    returns table(
      auth_user_id uuid,profile_id uuid,profile_user_id uuid,role text,status text,
      company_id uuid,email text,context_company_id uuid,impersonated_profile_id uuid,
      impersonated_company_id uuid,impersonated_role text,impersonated_status text,
      impersonated_email text
    ) language plpgsql security definer set search_path=pg_catalog,public as $$
    declare
      v_profile public.profiles%rowtype;
    begin
      select * into v_profile from public.profiles p where p.id=auth.uid() limit 1;
      if not found then return; end if;
      auth_user_id:=auth.uid(); profile_id:=v_profile.id; role:=v_profile.role;
      status:=v_profile.status; company_id:=v_profile.company_id; email:=v_profile.email;
      return next;
    end $$;
    revoke all on function public.resolve_actor_context_from_session_v1() from public,anon;
    grant execute on function public.resolve_actor_context_from_session_v1() to service_role,authenticated;

    alter function public.void_ticket_with_storno_v2(uuid,uuid,text) security definer;
    alter function public.void_ticket_with_storno_v2(uuid,uuid,text) set search_path='';
    alter function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text) security definer;
    alter function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text) set search_path='';
    alter function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text) security definer;
    alter function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)
      set search_path=pg_catalog,public,private,extensions;

    create or replace function public.finalize_harvest_intake_for_session_v1(p_ticket_id uuid,p_lock_token text,p_tare_weight numeric,p_moisture_percent numeric default null,p_impurity_percent numeric default null,p_other_percent numeric default null,p_notes text default null,p_manual_weight boolean default false,p_idempotency_key text default null)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
    begin
      perform 1 from public.tickets where id=p_ticket_id for update; return '{}'::jsonb;
    end $$;
    create or replace function public.close_transfer_ticket_atomic_v2(p_ticket_id uuid,p_lock_token text,p_tare_weight numeric,p_moisture_percent numeric default null,p_manual_weight boolean default false,p_idempotency_key text default null)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
    begin
      perform 1 from public.tickets where id=p_ticket_id for update; return '{}'::jsonb;
    end $$;
    create or replace function public.finalize_weighbridge_ticket_v2(p_ticket_id uuid,p_actor_user_id uuid)
    returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      perform 1 from public.tickets where id=p_ticket_id for update; return p_ticket_id;
    end $$;
    create or replace function public.finalize_weighbridge_ticket_authenticated_v1(p_ticket_id uuid,p_actor_user_id uuid)
    returns uuid language plpgsql security definer set search_path='' as $$
    begin
      perform 1 from public.tickets where id=p_ticket_id for update;
      return public.finalize_weighbridge_ticket_v2(p_ticket_id,p_actor_user_id);
    end $$;
    create or replace function public.finalize_weighbridge_ticket_for_session_v1(p_ticket_id uuid)
    returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      perform 1 from public.tickets where id=p_ticket_id for update;
      return public.finalize_weighbridge_ticket_v2(p_ticket_id,auth.uid());
    end $$;
    create or replace function public.finalize_weighbridge_impurity_ticket_for_session_v1(p_ticket_id uuid)
    returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      perform 1 from public.tickets where id=p_ticket_id for update;
      return public.finalize_weighbridge_ticket_v2(p_ticket_id,auth.uid());
    end $$;
    create or replace function public.create_supplier_invoice_atomic_v1(p_company_id uuid,p_supplier_id uuid,p_document_no text,p_notes text,p_lines jsonb,p_vehicle_id uuid,p_driver_id uuid,p_idempotency_key uuid,p_request_fingerprint text)
    returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      return '{}'::jsonb;
    end $$;
    create or replace function public.create_warehouse_receipt_atomic_v1(p_company_id uuid,p_warehouse_id uuid,p_received_at timestamptz,p_supplier text,p_document_no text,p_notes text,p_lines jsonb,p_idempotency_key uuid)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      return '{}'::jsonb;
    end $$;
    create or replace function public.create_warehouse_receipt_atomic_v2(p_company_id uuid,p_warehouse_id uuid,p_received_at timestamptz,p_supplier_company_counterparty_id uuid,p_supplier_global_counterparty_id uuid,p_document_no text,p_notes text,p_lines jsonb,p_idempotency_key uuid)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      return '{}'::jsonb;
    end $$;
    create or replace function public.reassign_harvest_batch_lot_v1(p_inventory_batch_id uuid,p_destination_lot_id uuid,p_reason text)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
    declare v_actor public.profiles%rowtype; v_link public.harvest_lot_batches%rowtype;
    begin
      select * into v_actor from public.profiles where id=auth.uid() and status='active';
      if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'reason'; end if;
  select * into v_link from public.harvest_lot_batches
  where inventory_batch_id = p_inventory_batch_id for update;
      return jsonb_build_object('ok',true);
    end $$;

    revoke all on function public.void_ticket_with_storno_v2(uuid,uuid,text) from public,anon,authenticated;
    grant execute on function public.void_ticket_with_storno_v2(uuid,uuid,text) to service_role;
    revoke all on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text) from public,anon;
    grant execute on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text) to service_role,authenticated;
    revoke all on function public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text) from public,anon;
    grant execute on function public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text) to authenticated,service_role;
    revoke all on function public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text) from public,anon;
    grant execute on function public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text) to authenticated,service_role;
    revoke all on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text) from public,anon;
    grant execute on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text) to authenticated,service_role;
    revoke all on function public.finalize_weighbridge_ticket_v2(uuid,uuid) from public,anon,authenticated;
    grant execute on function public.finalize_weighbridge_ticket_v2(uuid,uuid) to service_role;
    revoke all on function public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid) from public,anon;
    grant execute on function public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid) to authenticated,service_role;
    revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from public,anon;
    grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to service_role,authenticated;
    revoke all on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) from public,anon;
    grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) to authenticated,service_role;
    revoke all on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) from public,anon;
    grant execute on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) to authenticated,service_role;
    revoke all on function public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamptz,text,text,text,jsonb,uuid) from public,anon;
    grant execute on function public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamptz,text,text,text,jsonb,uuid) to authenticated,service_role;
    revoke all on function public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamptz,uuid,uuid,text,text,jsonb,uuid) from public,anon,authenticated;
    grant execute on function public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamptz,uuid,uuid,text,text,jsonb,uuid) to service_role;
    revoke all on function public.reassign_harvest_batch_lot_v1(uuid,uuid,text) from public,anon;
    grant execute on function public.reassign_harvest_batch_lot_v1(uuid,uuid,text) to authenticated,service_role;
  `);
  await scalar(db, `select set_config('request.jwt.claim.sub','${ACTOR}',false)`);
  await scalar(db, `select set_config('request.jwt.claim.role','authenticated',false)`);
}

async function adaptHashes(db: PGlite, migration: string) {
  let adapted = migration;
  const [actorContext] = await rows(db, `
    select
      md5(regexp_replace(pg_get_functiondef('public.resolve_actor_context_from_session_v1()'::regprocedure),'\\s+',' ','g')) def_hash,
      md5(regexp_replace(prosrc,'\\s+',' ','g')) body_hash
    from pg_proc where oid='public.resolve_actor_context_from_session_v1()'::regprocedure
  `);
  adapted = adapted.replace("9d1edf5101f226f9d4ed87f9748df916", String(actorContext.def_hash));
  adapted = adapted.replace("ca1e2f7c7bf523204c02160ed5076f37", String(actorContext.body_hash));
  for (const [regprocedure, expectedDefinition, expectedBody] of targets) {
    const gateCall = regprocedure.includes("reverse_processing_material_balance_v1")
      ? "perform private.acquire_transformation_processing_gate_v1(p_transformation_id, p_company_id, p_season_id, p_actor_user_id);"
      : regprocedure.includes("reassign_harvest_batch_lot_v1")
        ? "perform private.acquire_harvest_batch_reassignment_gate_v1(p_inventory_batch_id, p_destination_lot_id);"
      : regprocedure.includes("create_supplier_invoice_atomic_v1") || regprocedure.includes("create_warehouse_receipt_atomic_v")
        ? "perform private.acquire_nonprocessing_company_gate_v1(p_company_id);"
        : regprocedure.includes("void_ticket_with_storno_v2")
          || regprocedure.includes("finalize_weighbridge_ticket_v2(uuid,uuid)")
          || regprocedure.includes("finalize_weighbridge_ticket_authenticated_v1")
          ? "perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, p_actor_user_id);"
          : "perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);";
    const fragment = `  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  ${gateCall}\n`;
    const [actual] = await rows(db, `
      select
        md5(regexp_replace(replace(pg_get_functiondef($1::regprocedure),$2,''),'\\s+',' ','g')) def_hash,
        md5(regexp_replace(replace(prosrc,$2,''),'\\s+',' ','g')) body_hash
      from pg_proc where oid=$1::regprocedure
    `, [regprocedure, fragment]);
    adapted = adapted.replace(expectedDefinition, String(actual.def_hash));
    adapted = adapted.replace(expectedBody, String(actual.body_hash));
  }
  return adapted;
}

async function proveMigrationOrder(
  gateSource: string,
  sourceDebit: string,
  order: "gate-first" | "source-debit-first",
) {
  const db = new PGlite();
  await bootstrapMigrationOrder(db);

  if (order === "gate-first") {
    const gate = await adaptHashes(db, gateSource);
    await db.exec(gate);
    await db.exec(gate);
    await db.exec(sourceDebit);
    await db.exec(sourceDebit);
    const postSourceDebitGate = await adaptHashes(db, gateSource);
    await db.exec(postSourceDebitGate);
  } else {
    await db.exec(sourceDebit);
    await db.exec(sourceDebit);
    const gate = await adaptHashes(db, gateSource);
    await db.exec(gate);
    await db.exec(gate);
  }

  for (const [regprocedure] of targets) {
    const definition = String(await scalar(db, `select pg_get_functiondef('${regprocedure}'::regprocedure)`));
    assert.equal(
      (definition.match(/TZ315_UNIVERSAL_PROCESSING_GATE_V1/g) ?? []).length,
      1,
      `${order}:${regprocedure}`,
    );
  }
  const closeDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)'::regprocedure)
  `));
  assert.equal((closeDefinition.match(/output_ticket\.status::text <> 'voided'/g) ?? []).length, 2);
  const reverseDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure)
  `));
  assert.match(reverseDefinition, /processing_output_ticket_trace_valid_v2/);
  assert.match(reverseDefinition, /processing_moisture_loss/);
  const voidDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure)
  `));
  assert.match(voidDefinition, /WEIGHBRIDGE_VOID_PROCESSING_CYCLE/);
  assert.match(voidDefinition, /PROCESSING_OUTPUT_CYCLE_REVERSAL_REQUIRED/);
  assert.equal(
    Number(await scalar(db, `select count(*) from pg_trigger where tgname='trg_processing_output_source_debit_v1' and not tgisinternal`)),
    1,
  );
  await db.close();
}

async function main() {
  const db = new PGlite();
  const source = await readFile(migrationUrl, "utf8");
  const sourceDebit = await readFile(sourceDebitUrl, "utf8");
  await bootstrap(db);
  const voidPhysicalDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure)
  `));
  await db.exec(voidPhysicalDefinition.replace(/\n/g, "\r\n"));
  const originalOids = new Map<string, number>();
  for (const [regprocedure] of targets) {
    originalOids.set(
      regprocedure,
      Number(await scalar(db, `select '${regprocedure}'::regprocedure::oid`)),
    );
  }
  const migration = await adaptHashes(db, source);

  assert.doesNotMatch(migration, /lock\s+table/i);
  assert.doesNotMatch(migration, /private\..+_core_20260831/i);
  assert.match(migration, /security invoker[\s\S]*TZ315_PROCESSING_COMPANY_SEASON_GATE_V1/);
  assert.match(migration, /pg_advisory_xact_lock_shared/);
  assert.match(migration, /if p_canonical_season_id is null then[\s\S]*pg_advisory_xact_lock/);
  console.log("PASS 01 migration is DDL-only gate injection with no table-lock/core-clone graph");

  await db.exec(migration);
  await db.exec(migration);
  for (const [regprocedure] of targets) {
    assert.equal(
      Number(await scalar(db, `select '${regprocedure}'::regprocedure::oid`)),
      originalOids.get(regprocedure),
      `OID:${regprocedure}`,
    );
    const definition = String(await scalar(db, `select pg_get_functiondef('${regprocedure}'::regprocedure)`));
    assert.equal((definition.match(/TZ315_UNIVERSAL_PROCESSING_GATE_V1/g) ?? []).length, 1, regprocedure);
    const marker = definition.indexOf("TZ315_UNIVERSAL_PROCESSING_GATE_V1");
    const firstLockOrWrite = [" for update", "insert into", "update public.", "delete from", "lock table"]
      .map((token) => definition.toLowerCase().indexOf(token))
      .filter((position) => position >= 0)
      .sort((a, b) => a - b)[0];
    if (firstLockOrWrite !== undefined) assert.ok(marker < firstLockOrWrite, regprocedure);
  }
  console.log("PASS 02 all 6 cores, 6 pre-lock callers and harvest-lot reassignment gate before first lock/write; rerun is exact-once");

  assert.equal(
    await scalar(db, `select has_function_privilege('authenticated','private.tz315_lock_company_season_write_gate_v1(uuid,uuid)','EXECUTE')`),
    false,
  );
  assert.equal(
    await scalar(db, `select prosecdef from pg_proc where oid='private.tz315_lock_company_season_write_gate_v1(uuid,uuid)'::regprocedure`),
    false,
  );
  console.log("PASS 03 private gate is SECURITY INVOKER and unreachable to API roles");

  const canonical = await rows(db, `select * from private.resolve_ticket_processing_gate_scope_v1('${TICKET}')`);
  assert.deepEqual(canonical, [{ company_id: COMPANY, canonical_season_id: SEASON, uses_company_umbrella: false }]);
  const legacy = await rows(db, `select * from private.resolve_ticket_processing_gate_scope_v1('${NONPROCESSING_TICKET}')`);
  assert.equal(legacy[0].canonical_season_id, null);
  assert.equal(legacy[0].uses_company_umbrella, true);
  await scalar(db, `select private.acquire_harvest_batch_reassignment_gate_v1('${INVENTORY_BATCH}','${DESTINATION_LOT}')`);
  await db.exec(`update public.harvest_lots set season_id='${OTHER_SEASON}' where id='${DESTINATION_LOT}'`);
  await assert.rejects(
    () => db.query(`select private.acquire_harvest_batch_reassignment_gate_v1('${INVENTORY_BATCH}','${DESTINATION_LOT}')`),
    /TZ315_HARVEST_BATCH_REASSIGN_SCOPE_MISMATCH/,
  );
  await db.exec(`update public.harvest_lots set season_id='${SEASON}' where id='${DESTINATION_LOT}'`);
  await db.exec(`update public.harvest_lots set company_id='${OTHER_COMPANY}' where id='${DESTINATION_LOT}'`);
  await assert.rejects(
    () => db.query(`select private.acquire_harvest_batch_reassignment_gate_v1('${INVENTORY_BATCH}','${DESTINATION_LOT}')`),
    /TZ315_HARVEST_BATCH_REASSIGN_SCOPE_MISMATCH/,
  );
  await db.exec(`update public.harvest_lots set company_id='${COMPANY}' where id='${DESTINATION_LOT}'`);

  await db.exec(`
    create or replace function private.tz315_lock_company_season_write_gate_v1(
      p_company_id uuid,p_canonical_season_id uuid
    )
    returns void language plpgsql security invoker set search_path='' as $$
    begin
      update public.harvest_lot_batches
      set harvest_lot_id='${DESTINATION_LOT}' where id='${LOT_LINK}';
    end $$;
  `);
  await assert.rejects(
    () => db.query(`select private.acquire_harvest_batch_reassignment_gate_v1('${INVENTORY_BATCH}','${DESTINATION_LOT}')`),
    /TZ315_HARVEST_BATCH_REASSIGN_SCOPE_CHANGED_RETRY/,
  );
  await db.exec(migration);
  const reassignmentGate = String(await scalar(db, `
    select pg_get_functiondef('private.acquire_harvest_batch_reassignment_gate_v1(uuid,uuid)'::regprocedure)
  `));
  assert.ok(
    reassignmentGate.indexOf("tz315_lock_company_season_write_gate_v1")
      < reassignmentGate.toLowerCase().indexOf("for update"),
  );
  console.log("PASS 04 canonical/NULL scopes and reassignment company+season scope resolve deterministically and fail closed");

  await scalar(db, `select private.acquire_ticket_processing_gate_for_actor_v1('${TICKET}','${ACTOR}')`);
  await scalar(db, `select set_config('request.jwt.claim.sub','${OTHER_ACTOR}',false)`);
  await assert.rejects(
    () => db.query(`select private.acquire_ticket_processing_gate_for_actor_v1('${TICKET}','${OTHER_ACTOR}')`),
    /TZ315_PROCESSING_GATE_(ACTOR|COMPANY)_FORBIDDEN/,
  );

  await scalar(db, `select set_config('request.jwt.claim.sub','${EMAIL_AUTH_USER}',false)`);
  await scalar(db, `select set_config('request.jwt.claim.email','actor@example.test',false)`);
  await scalar(db, `select private.acquire_ticket_processing_gate_for_session_v1('${TICKET}')`);

  await db.exec(`
    insert into public.global_admin_impersonation_contexts(
      admin_user_id,impersonated_profile_id,impersonated_company_id
    ) values('${GLOBAL_ADMIN}','${ACTOR}','${COMPANY}');
  `);
  await scalar(db, `select set_config('request.jwt.claim.sub','${GLOBAL_ADMIN}',false)`);
  await scalar(db, `select set_config('request.jwt.claim.email','ga@example.test',false)`);
  await scalar(db, `select private.acquire_ticket_processing_gate_for_session_v1('${TICKET}')`);
  await scalar(db, `select private.assert_processing_gate_actor_v1('${COMPANY}','${ACTOR}')`);
  await scalar(db, `select private.assert_processing_gate_actor_v1('${COMPANY}','${GLOBAL_ADMIN}')`);
  await scalar(db, `select public.void_weighbridge_ticket_for_session_v1('${TICKET}','verified GA session wrapper')`);
  await scalar(db, `select public.finalize_weighbridge_ticket_for_session_v1('${TICKET}')`);
  await scalar(db, `select public.finalize_weighbridge_impurity_ticket_for_session_v1('${TICKET}')`);

  await db.exec(`update public.global_admin_impersonation_contexts
    set impersonated_company_id='${OTHER_COMPANY}' where admin_user_id='${GLOBAL_ADMIN}'`);
  await assert.rejects(
    () => db.query(`select public.void_weighbridge_ticket_for_session_v1('${TICKET}','wrong company')`),
    /TZ315_PROCESSING_GATE_ACTOR_FORBIDDEN/,
  );
  await assert.rejects(
    () => db.query(`select public.finalize_weighbridge_ticket_for_session_v1('${TICKET}')`),
    /TZ315_PROCESSING_GATE_ACTOR_FORBIDDEN/,
  );
  await db.exec(`update public.global_admin_impersonation_contexts
    set impersonated_company_id='${COMPANY}' where admin_user_id='${GLOBAL_ADMIN}'`);

  await scalar(db, `select set_config('request.jwt.claim.sub','${ACTOR}',false)`);
  await scalar(db, `select set_config('request.jwt.claim.email','actor@example.test',false)`);
  await assert.rejects(
    () => db.query(`select private.assert_processing_gate_actor_v1('${COMPANY}','${GLOBAL_ADMIN}')`),
    /TZ315_PROCESSING_GATE_ACTOR_FORBIDDEN/,
  );
  await scalar(db, `select public.finalize_weighbridge_ticket_authenticated_v1('${TICKET}','${ACTOR}')`);
  await scalar(db, `select set_config('request.jwt.claim.role','service_role',false)`);
  await scalar(db, `select set_config('request.jwt.claim.sub','',false)`);
  await scalar(db, `select public.finalize_weighbridge_ticket_v2('${TICKET}','${ACTOR}')`);
  await scalar(db, `select set_config('request.jwt.claim.role','authenticated',false)`);
  await scalar(db, `select set_config('request.jwt.claim.sub','${ACTOR}',false)`);
  console.log("PASS 05 actor/company boundary covers cross-company, email fallback, real GA session void/finalize chains, ordinary spoof rejection and service-only core");

  assert.match(sourceDebit, /processing_output_ticket_trace_valid_v2/);
  assert.match(sourceDebit, /processing_moisture_loss/);
  assert.match(source, /ba7b8d22fe3dcc5b8e386b2599088dfe/);
  assert.match(source, /4d3b289a4acb497d835660525f8e37df/);
  await proveMigrationOrder(source, sourceDebit, "gate-first");
  await proveMigrationOrder(source, sourceDebit, "source-debit-first");
  console.log("PASS 06 gate→source-debit and source-debit→gate both execute, rerun, preserve anchors and retain exact-one gate marker");

  const voidDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure)
  `));
  assert.match(voidDefinition, /WEIGHBRIDGE_VOID_PROCESSING_CYCLE_REVERSAL_REQUIRED/);
  assert.match(sourceDebit, /position\('WEIGHBRIDGE_VOID_PROCESSING_CYCLE' in v_definition\)>0 then return/);
  console.log("PASS 07 void source-debit early return remains truthful after gate injection");

  await db.close();
  console.log("TZ315 UNIVERSAL PROCESSING GATE 7/7 PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
