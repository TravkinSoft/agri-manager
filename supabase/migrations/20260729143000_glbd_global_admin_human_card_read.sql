-- TZ-237: Global Admin may review canonical GLBD component links that are not
-- yet recommendation-ready. This is SELECT-only and does not broaden company
-- user access or grant any catalog mutation.

alter table public.glbd_components enable row level security;
alter table public.glbd_product_components enable row level security;

drop policy if exists "glbd_components_global_admin_read_review" on public.glbd_components;
create policy "glbd_components_global_admin_read_review"
  on public.glbd_components
  for select
  to authenticated
  using (
    archived_at is null
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'global_admin'
        and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "glbd_product_components_global_admin_read_review" on public.glbd_product_components;
create policy "glbd_product_components_global_admin_read_review"
  on public.glbd_product_components
  for select
  to authenticated
  using (
    review_status not in ('archived', 'rejected')
    and exists (
      select 1
      from public.products product
      where product.id = glbd_product_components.product_id
        and product.company_id is null
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'global_admin'
        and coalesce(p.status, 'active') = 'active'
    )
  );

comment on policy "glbd_components_global_admin_read_review" on public.glbd_components
  is 'TZ-237 SELECT-only review access for active Global Admin profiles.';

comment on policy "glbd_product_components_global_admin_read_review" on public.glbd_product_components
  is 'TZ-237 SELECT-only review access for active Global Admin profiles.';
