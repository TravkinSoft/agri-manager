# P1: Weighbridge ticket finalize latency

Status: BACKLOG

Observed owner-facing latency: closing a weighbridge ticket takes approximately 5-6 seconds.

This is intentionally outside TZ277. The next focused performance task should profile the complete finalize path without changing ticket, batch, ledger, idempotency, or accounting semantics.
