# Fase 6.9 — Real data preflight

Read-only export + TEST dry-run. Does **not** treat `TEST_FIXTURE` as the phone.

## Official source

DEVICE_COPY dump `544b330b-e499-40b4-8909-cdcf6745fc64` (2026-09-18T01:59:13.031Z).

| Check | Value |
|-------|--------|
| products | 7 |
| customers | 14 |
| suppliers | 1 |
| stockMoves inicial | 7 |
| initialDebts | 14 |
| sales / caja / pagos | 0 |
| stock units | 74 |
| Σ initialDebts | **45_200 COP** (owner confirmed; not 45000) |
| avgCost / unitCost | 0 (gifted / unknown; keep) |
| TEST import | PASS (embedded Postgres) |
| Production / HTTP | not touched |

Do not invent costs. Do not migrate production until an explicit later order.
