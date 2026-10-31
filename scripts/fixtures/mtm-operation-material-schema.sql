-- Synthetic tables for the actual create_operation_plan_atomic_v1/v12 functions.
-- No remote schema/data import. This is not the complete E1 target/trigger stack.
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
grant usage on schema auth to authenticated;
create table companies(id uuid primary key);
create table profiles(id uuid primary key, company_id uuid references companies, role text, status text);
create table global_admin_company_contexts(user_id uuid,company_id uuid);
create table global_admin_impersonation_contexts(admin_user_id uuid,impersonated_profile_id uuid,impersonated_company_id uuid);
create table products(id uuid primary key,company_id uuid references companies,type text,unit text,archived boolean default false);
create table fields(id uuid primary key,company_id uuid references companies);
create table seasons(id uuid primary key,company_id uuid,archived boolean);
create table crop_structure(id uuid primary key,company_id uuid,field_id uuid,season_id uuid,area numeric,
 crop_id uuid,variety_id uuid,reproduction_id uuid,status text,notes text,archived boolean,user_id uuid);
create table operations(id uuid primary key default gen_random_uuid(),company_id uuid references companies,
 field_id uuid references fields,crop_structure_id uuid,operation_type text,date date,notes text,user_id uuid,
 status text,work_status text,responsible_user_id uuid,operation_category_slug text,operation_type_slug text,
 machine_id uuid,equipment_id uuid,transport_id uuid,operation_target text,rate_per_ha numeric,spray_volume_per_ha numeric,
 operation_config jsonb,idempotency_key text,request_fingerprint text,operation_status text,specialist_task_status text,
 planned_area_ha numeric,completed_area_ha numeric,remaining_area_ha numeric,progress_percent numeric,
 unique(company_id,idempotency_key));
create table operation_lines(id uuid primary key default gen_random_uuid(),company_id uuid,operation_id uuid references operations,
 field_id uuid,crop_id uuid,variety_id uuid,reproduction_id uuid,planned_area_ha numeric,actual_area_ha numeric,
 row_spacing_m numeric,seed_spacing_cm numeric,calculated_plants_per_ha numeric,calculated_total_plants numeric,
 notes text,created_by_user_id uuid,updated_by_user_id uuid,created_at timestamptz default now());
create table operation_materials(id uuid primary key default gen_random_uuid(),company_id uuid,operation_id uuid references operations,
 operation_line_id uuid references operation_lines,product_id uuid references products,batch_id uuid,material_type text not null,
 unit text,planned_rate numeric,actual_rate numeric,planned_quantity numeric,issued_quantity numeric,notes text,
 crop_id uuid,variety_id uuid,reproduction_id uuid,created_by_user_id uuid,updated_by_user_id uuid,created_at timestamptz default now());
create table warehouse_issue_requests(id uuid primary key default gen_random_uuid(),company_id uuid,operation_id uuid references operations,
 field_id uuid,operation_line_id uuid,crop_id uuid,variety_id uuid,reproduction_id uuid,recipient_user_id uuid,
 assigned_specialist_id uuid,planned_datetime timestamp,comment text,status text,warehouse_request_status text,
 source_warehouse_id uuid,request_number text default 'SYNTHETIC');
create table warehouse_issue_request_items(id uuid primary key default gen_random_uuid(),request_id uuid references warehouse_issue_requests,
 company_id uuid,product_id uuid references products,product_category text,required_quantity numeric check(required_quantity>0),
 planned_quantity numeric,issued_quantity numeric,unit text,planned_rate_per_ha numeric,prepared_quantity numeric,
 expected_consumed_quantity numeric,expected_return_quantity numeric,return_received_quantity numeric,loss_quantity numeric,
 shortage_quantity numeric,reconciliation_status text,substitution_status text,planned_product_id uuid,actual_product_id uuid,
 prepared_unit text,issued_unit text,received_unit text,package_unit text,crop_id uuid,variety_id uuid,reproduction_id uuid,material_kind text);
create table operation_mutation_receipts(id uuid primary key default gen_random_uuid(),company_id uuid,action text,scope_id uuid,
 idempotency_key text,request_fingerprint text,response_payload jsonb,created_by_profile_id uuid,created_at timestamptz default now(),
 unique(company_id,action,idempotency_key));
create table audit_log(id uuid primary key default gen_random_uuid(),company_id uuid,who uuid,entity_type text,entity_id text,action text,new_values jsonb);
-- Sentinels prove planning does not post movements or create a second warehouse.
create table stock_ledger_entries(id uuid primary key,quantity numeric);
create table inventory_transactions(id uuid primary key,quantity numeric);
create table warehouses(id uuid primary key,name text);
