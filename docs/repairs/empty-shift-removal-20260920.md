# Accidental zero shift removed — Production

Explicit user request: remove the second accidentally opened/closed empty shift on 20 September; retain the real shift with about 731 tonnes.

- Removed shift: `9a7f2cf8-d7e3-4364-b0d1-fe518ae72a28`, company `10000000-0000-0000-0000-000000000001`.
- Local Asia/Qyzylorda time: 20 September 23:03:58–23:05:40; closed, 0 tickets, 0 kg.
- Before deletion: zero tickets by shift_id, zero ticket_weighings, zero handover references; snapshot ticketIds/tickets arrays empty. One already-revoked operator session was the only dependent row and cascaded on deletion; no active session removed. That session table has no referencing foreign keys.
- Full shift backup: `C:/Users/TRAVKIN/Downloads/CodecSaaS/.codex-artifacts/repairs/20260920-empty-shift-9a7f2cf8.json`. The empty report can be restored if necessary; the revoked session was not backed up as reusable credentials and need not be restored.
- Deletion ran in a transaction with row lock, exact company/id/timestamps/zero guards, dependency checks and retained-shift fingerprint check. Exactly one shift deleted.
- Retained shift: `3d80386e-f480-4d5a-848a-0eac3d2db99a`, closed 20 September at 23:00 local. It is again the latest shift.
- Retained result: 920,510 kg potato receipts minus 189,020 kg impurities = **731,490 kg**. 84 receipt trips, 35 impurity trips; 119 closed tickets and 3 voided tickets.
- Full retained row MD5 before and after: `0c8722558ac7e2f395e0f5c9338a64df`. No change to its report, tickets, stock or quantities.
- Postcheck: removed shift count = 0; retained shift unchanged. Database live-verified; browser rendering not separately inspected.
