# P0 Karataev impurity ticket closure — 2026-09-20

## Resolved in Production

- Existing ticket: WB-100000-20260920080110-I13K
- ID: 24b28bd9-284c-41d4-8614-8d65c36a4b42
- Driver: Каратаев Павел, ZIL Т-829 BN
- Operation: soil/trash removal from Хранилище (Тайынша)
- Gross/tare/net unchanged: 9440 / 5120 / 4320 kg
- Finalized: 2026-09-20 08:15:34.785232 UTC (13:15 Asia/Qyzylorda)
- Exactly one outbound ledger entry: c5793429-bc65-4afc-a8af-6346f6c693c9, -4320 kg
- Actor: active Global Admin, not an impersonated weighman. Maintenance reason recorded in ticket.audit_json.

The user clarified that they and the weighman were leaving this ticket alone for
the assistant to repair; other tickets must continue normally.

## Evidence and cause

The screenshot error was WEIGHBRIDGE_STOCK_INSUFFICIENT|0.000000|4320.000000.
Both weights had already persisted. The original ticket was ready_to_close,
not finalized, with zero ledger entries: the reboot had not erased the weights
or caused a duplicate write. Its causal relationship to the reservation conflict
is not established.

The shared-impurity ticket 95aaf629-389b-4f12-b75c-c53de780bb51 held whole-source-batch
reservations. A sampled source batch had 15580 kg in the ledger and the same 15580 kg
reserved by that ticket, making availability zero. This was a stock reservation
conflict, not an authentication failure or missing incoming stock.

While investigating, the weighman independently closed the blocking ticket at
08:09:46 UTC (6420 kg impurities). Reservations disappeared; recheck of the selected
lot/warehouse showed 123 source batches with 1042750 kg available.
No blocking ticket was voided, changed, or force-unreserved by the assistant.

## Procedure and checks

1. Saved exact ticket/lines/weighings before image in the adjacent JSON backup.
2. Used existing actor-based stock finalizer in a scoped maintenance transaction,
   with exact ticket/driver/vehicle/lot/warehouse/weight assertions.
3. Initial test without service context was denied by the session gate and rolled back.
4. Used the documented trusted service-role core path with explicit active Global Admin
   actor. No grants, RLS, functions or immutable ledger guards were changed or bypassed.
5. Dry-run completed with one -4320 kg outbound entry, then rolled back.
6. Repeated the same guarded operation with commit and verified the persisted result.
7. Canonical finalizer replay in a rollback transaction retained one entry, -4320 kg.
8. Another harvest ticket, ...RCX1, independently finalized at 08:14:09 UTC for 10320 kg,
   demonstrating continued weighing work during this scoped repair.

## Scope and remaining UX

No application deployment or schema migration was needed or performed for this
incident. Main domain remained deployment agri-manager-q41df3kks-travkin-ais-projects.vercel.app.

The existing impurity finalization API surfaces the raw insufficient-stock string;
it does not explain the blocking ticket. That UX and early conflict detection remain
unchanged. Do not claim this incident removed all possible reservation conflicts.
Do not remove the whole-batch protection without redesigning and testing shared-pool
allocation concurrency. Refresh the weighbridge to see the completed existing ticket.
