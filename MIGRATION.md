# DulceCalle — Dexie → PostgreSQL migration

**Do not run a migration in this phase.** Do not drop IndexedDB. Do not POST fake sales for old debts.

Source of truth today: IndexedDB database `dulcecalle` (Dexie). **Not** the Cache API / service worker cache.

---

## 1. Strategy: hybrid (C)

| | A copy cache only | B replay ops through services | **C hybrid (chosen)** |
|--|-------------------|-------------------------------|------------------------|
| Integrity of snapshots | yes | can rewrite unitCost if code drifted | **yes — insert rows as stored** |
| Trazability | weak | strong | **strong** |
| Demo `createdAt` stamps | copied | would not match | **copied** |
| Pre-P0.5 products with stock and no `inicial` | copied | would invent moves | **copied; do not invent inicial** |
| Risk | cache vs events diverge | double effects / new avgCost | **compare cache vs events, stop on mismatch** |

**Insert historical rows. Do not call `createSale` / `surtir` for old data.**  
Then **reconcile**:

```
If the product has a stock_move reason=inicial:
  reconstructed_stock = Σ stock_moves.delta
  must equal products.stock

If the product has **zero** moves (pre-P0.5 / demo):
  trust products.stock; do **not** synthesize inicial

If the product has later moves (sale/surtir/…) but **no inicial**:
  do **not** require Σ delta == stock (DOMAIN forbids inventing inicial)
  trust products.stock; log a warning; import still succeeds
```

Debt:

```
reconstructed_debt =
  Σ initial_debts + Σ sale.credit − Σ payments − Σ return.debtReduced
must equal customers.debt
```

Mismatch on debt, or on stock when `inicial` exists → fail the import for that business. Do not auto-fix. Operator inspects.

---

## 2. IDs

Dexie: autoincrement `number`. Postgres: UUID.

1. Insert rows with **new UUID** PKs in FK order (catalog → events). Never reuse Dexie ints as PG PKs.
2. Fill `import_id_map(business_id, table_name, dexie_id, pg_id)` unique `(business_id, table_name, dexie_id)`.
3. Also store nullable `legacy_dexie_id` on the row (never a column named `legacy_id`).
4. Rewrite FKs via the map (`sale.customerId` 3 → uuid).
5. `requestId`: if it is a UUID, copy into `request_id`. If it is the Dexie fallback (`prefix-Date.now-random`), store it in `legacy_request_id` and set `request_id` to UUID v5 of that string so the unique index still works. Future API calls use UUID `Idempotency-Key` only.

Do not change Dexie IDs on the phone.

---

## 3. Dates

Dexie `createdAt` is epoch ms from the **device**.

Import:

```
created_at = to_timestamp(ms / 1000) AT TIME ZONE 'UTC'
occurred_on = (created_at AT TIME ZONE 'America/Bogota')::date
```

CashSession.localDate is already `YYYY-MM-DD` — copy as `local_date`. If it disagrees with `opened_at` in Bogota, **keep localDate** (that is what closed-day used) and log a warning.

---

## 4. Initial debts (official live total: $45.200)

These rows live in Dexie `initialDebts`. They are **not** sales.

Official DEVICE_COPY dump `544b330b-e499-40b4-8909-cdcf6745fc64` (2026-09-18):

`SUM(initialDebts.amount) = 45_200 COP`

The owner confirmed **45200 is correct**. Do **not** round to the older freeze figure of 45000.

Import:

- `initial_debts` amount, customer via map, request_id, created_at
- `customers.debt` already includes them — after import, reconciliation must still match
- **zero** sales, cash_moves, stock_moves, Nequi, Invertí, Ventas from this step

If a later dump’s sum is not 45200, **do not invent the difference**. The dump is the authority.


---

## 5. Sale.method

Dexie `sales` has no method. Paid/partial method is on `cashMoves` where `kind=sale` and `refId=saleId`.

Import: set `sales.method` from that cash move. Credit-only sales → method NULL.

---

## 6. Gifted opening stock

No product flag. Detect: `stock_moves.reason=inicial` AND `unit_cost=0` AND note contains the gifted copy. Keep as-is. Do not set a `gifted` column.

---

## 7. Demo vs real — NEEDS DECISION at import time

There is **no reliable automatic split**.

- `settings.demoLoaded = 1` only means demo ran **once**. The owner may have added real products/debts afterwards.
- Demo names (Doña Rosa, Carlos, Chicle menta, …) are hints, not proof.
- F4.5 `isDbEmpty` now blocks demo on top of real books; **older dumps may already mix**.

**Rule:** the owner points at **one** device export as canonical. The job imports **all** rows in that dump. It never deletes Dexie. It never drops rows because they “look like demo”.

If the owner wants demo catalog stripped, that is a **manual** checklist before import (delete those products only if they have no real sales). The importer will not guess.

---

## 8. Job steps (when we run it)

1. Owner exports Dexie (e.g. `dexie.backend()` JSON) from the phone. Keep the file.
2. Backup Postgres empty business.
3. Create `users` + `businesses` + membership (owner). Timezone `America/Bogota`.
4. Validate JSON schema vs Dexie v8 tables.
5. Import in order: settings, products, customers, suppliers, cash_sessions, sales, sale_lines, sale_returns, sale_return_lines, stock_moves, customer_payments, initial_debts, expenses, cash_moves. Rewrite FKs.
6. Count rows Dexie vs PG per table.
7. Reconcile stock, debt, Σ sale.saleTotal, Σ cash_moves by method/kind, Σ initial_debts.
8. Stats smoke: por cobrar, ventas, invertí on a known day.
9. If any check fails → rollback PG business schema for that tenant; Dexie untouched.
10. Leave IndexedDB on the device until the HTTP adapter is live.

Never write the dump into Cache Storage.

---

## 9. What not to migrate

- `CartItem` (memory only)
- Service worker cache
- Test databases
- `Date.now()` IDs

---

## 10. Rollback

Import runs in one Postgres transaction per business (or savepoints per table with a final reconcile gate). Failure → DELETE that business’s rows (or drop schema). Dexie file remains the backup.

---

## 11. After go-live

New ops use UUID + request_id. `legacy_dexie_id` stays for support (“this PG sale was Dexie #42”).
