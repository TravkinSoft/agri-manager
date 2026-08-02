# A107 Core dataset proposal — Curamin Foliar localized name

STATUS: `PROPOSED_NOT_APPLIED`
OWNER SOURCE: A107 owner acceptance finding dated `2026-07-17`
TARGET: isolated QA branch `gsglkmudcwkdetqtocae` only
PRODUCTION: forbidden

## Observed QA row

- `products.id`: `f281b5ab-67ef-4006-9ab7-2260ecd352e2`
- `name`: `Curamin Foliar`
- `trade_name`: `Curamin Foliar`
- `name_en`: `Curamin Foliar`
- `name_ru`: `Curamin Foliar`
- `company_id`: `NULL` (global catalog row referenced by the QA stock ledger)

The QA dataset therefore has no Russian localized product name. There is also no product-alias relation in the checked repository schema. The assistant must not mutate this Core-owned catalog row.

## Requested Core-owned branch change

Set only `name_ru` for the exact product row to `Курамин Фолиар`. Preserve `name`, `trade_name`, `name_en`, product identity, unit, inventory rows, and all quantities.

Suggested branch-only migration body for Core review:

```sql
update public.products
set name_ru = 'Курамин Фолиар'
where id = 'f281b5ab-67ef-4006-9ab7-2260ecd352e2'
  and name = 'Curamin Foliar'
  and trade_name = 'Curamin Foliar'
  and company_id is null
  and archived = false;
```

Core must fail the migration unless exactly one row matches and exactly one row is updated. Do not apply it to production as part of A107.

## Acceptance after Core apply

Under QA User A JWT and RLS, all five inputs resolve to the same product ID:

1. `Curamin Foliar`
2. `Curamin`
3. `Курамин`
4. `Фолиар`
5. `курамин фолиар`

Each answer must remain grounded in `v_stock_balance_identity`: total `520 l`, `Основной склад — 480 l`, `Полевой склад — 40 l`. Any ambiguous partial name must produce a clarification question rather than aggregate multiple products.

## Rollback

On the isolated QA branch only, restore `name_ru = 'Curamin Foliar'` for the exact product ID. No inventory or ledger row is changed by either apply or rollback.
