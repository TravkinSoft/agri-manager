drop policy if exists "Authenticated users can read active global products" on public.products;

create policy "Authenticated users can read active global products"
on public.products
for select
to authenticated
using (
  company_id is null
  and coalesce(is_active, true) = true
  and coalesce(archived, false) = false
);
