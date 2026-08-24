# TZ301 Production cleanup audit

Read-only snapshot for `ТОО "Астык-STEM"`. No Production data or schema was changed.

## Owner manifest

| Object | Finding | Classification | Safe next action |
| --- | --- | --- | --- |
| `TEST — Приёмка урожая` | Active, 4 tickets, 4 physical batches, 48,300 kg ledger balance | OWNER_REVIEW | Keep until the owner chooses a permanent name or moves the stock through the standard warehouse flow. Do not archive while it carries stock. |
| `Ангар(тест)` | Active, 3 tickets, 3 physical batches, 60,100 kg ledger balance | OWNER_REVIEW | Keep until the owner confirms the real facility identity. Rename through warehouse management; do not delete. |
| `Каменный` | Active, 1 ticket, 1 physical batch, 14,000 kg ledger balance | KEEP | No action. |
| Eight finalized harvest tickets | 122,400 kg total; two weighing events per ticket; ticket net equals line quantity and active ledger effect | KEEP | Preserve. |
| Eight technical harvest batches | One per source ticket; legacy weight columns carry the current balance | KEEP | Preserve traceability. Do not merge or rewrite physical batches. |
| Seven provisional harvest lots | Missing variety and reproduction; one trip each | OWNER_REVIEW | Resolve only from source documents. Do not infer or auto-merge. |
| One confirmed harvest lot | Crop, variety and reproduction are present | KEEP | No action. |
| Closed historical shifts | One empty historical shift, one inactivity close with eight linked tickets, one handover shift | KEEP | Preserve audit history. |
| Closed shift summary counters | The inactivity-closed shift has 8 linked tickets while stored summary counter is 0 | REPAIR | Rebuild summary only through an approved deterministic maintenance command; no mass effect. |
| Current open shift | Open since 23.08.2026, no tickets, recent handover context | KEEP | Operational state; do not close automatically. |
| People | 166 active records; no names matching QA/test/demo markers | KEEP | No cleanup candidate found. |
| Vehicles | 54 active; internal `OSV-ROW-*` identifiers are present on imported rows | KEEP | Internal identifiers stay hidden by the canonical display formatter. They are not proof of test data. |
| Machinery | 64 active; no names matching QA/test/demo markers | KEEP | No cleanup candidate found. |
| Processing | No transformations or processing nodes | KEEP | No cleanup needed. |

## Mass-chain result

- Ticket net total: **122,400 kg**.
- Ticket line total: **122,400 kg**.
- Active ledger total: **122,400 kg**.
- Each ticket has exactly two weighing events.
- Each ticket has exactly one source physical batch.
- No storno rows or active correction chains were found.
- No ticket-level mass mismatch was found.

The current physical batches use the legacy `initial_weight_kg/current_weight_kg` contract; the newer quantity fields are null. This is not a cleanup target and must not be rewritten without a separately approved compatibility migration.

## UUID appendix

### Warehouses

- `ad111536-3349-47d6-82d9-3378ea764008` — TEST — Приёмка урожая
- `e12d2360-5f40-4dca-80df-6601fe3bbf33` — Ангар(тест)
- `ab66450b-1f81-4f75-b12d-338df78f2226` — Каменный

### Tickets

- `0a0ca208-b0d0-40e2-84be-8bd853a34285` — WB-100000-20260814223220-P9EA — 18,000 kg
- `1525922c-e997-44be-9913-8897efe95992` — WB-100000-20260814223307-V42N — 19,100 kg
- `e98bad47-faa3-4846-888a-7ba327bff176` — WB-100000-20260814223402-JFYA — 8,100 kg
- `99e3c72e-c2f9-46ab-b91a-215ce2676881` — WB-100000-20260814223441-CSVF — 27,000 kg
- `bb98369a-e91e-4787-98e7-becc9cdb0723` — WB-100000-20260815115804-ZEIU — 14,000 kg
- `77f2588b-bf3f-4d93-8e9b-b5fad7f09cfd` — WB-100000-20260815152603-EVVK — 13,000 kg
- `974cc22a-fbbf-4c26-b064-40f600e1617c` — WB-100000-20260816095639-M5S0 — 9,200 kg
- `929ef384-8dad-49c8-a124-341c3af917f5` — WB-100000-20260817231333-3WGR — 14,000 kg

### Shifts

- `3262b3ef-e440-434e-8230-373deef8140b` — closed, empty historical shift
- `73ac2d24-6fae-40bd-9d3b-6a9fa7fbdff7` — closed by 24-hour inactivity, 8 linked tickets
- `376e3d4b-0cbc-4488-9430-278ba0cdb66c` — closed by handover
- `7d53a7b8-1088-44fe-bd0a-6dbd8a0394ca` — currently open, 0 tickets

### Provisional lots

- `1d85ddc3-6a21-4cbc-8cac-d34c27806d0e`
- `7df9a12b-9ab6-46ed-afc2-2a554d0d4b4d`
- `852b1ca6-4472-4b0f-b57c-358d65e5f9c7`
- `dad6e644-6873-46db-b6aa-e58522b7e586`
- `38a32f78-2b45-417f-9249-135cf0008c88`
- `1d94ea3c-64bf-4ca8-9c0c-e3439a6693e4`
- `50da91df-e1e2-4c90-9892-4220d4757a59`

### Confirmed lot

- `eef0e725-83da-4966-98fe-1438248b0f52`
