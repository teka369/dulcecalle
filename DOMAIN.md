# DulceCalle — Business Domain Contract (frozen)

Local-first PWA. IndexedDB/Dexie is the source of truth.
This document is what a future NestJS + Prisma + PostgreSQL backend must implement.
It does **not** authorize building that backend yet.

Money is integer COP. Never floats.

---

## 1. Entities (as they exist today)

| Entity | Table | Purpose | Mutable? | Historical? |
|--------|--------|---------|----------|-------------|
| Product | `products` | Catalog + current stock/cost | name, price, avgCost*, lowStockAt | stock only via moves |
| Supplier | `suppliers` | Light contact for surtir. **No CxP** | name, phone, notes | — |
| Customer | `customers` | Who can owe | name, phone | `debt` only via ops |
| Sale | `sales` | One ticket. Immutable after create | no | yes |
| SaleLine | `saleLines` | Line snapshots | no | yes |
| SaleReturn | `saleReturns` | Return of a sale. Does not edit the sale | no | yes |
| SaleReturnLine | `saleReturnLines` | Returned qty + historical price/cost | no | yes |
| StockMove | `stockMoves` | Inventory event | no | yes |
| CashMove | `cashMoves` | Money event (Efectivo \| Nequi) | no | yes |
| CashSession | `cashSessions` | One per local calendar day | close fields once | opening immutable |
| CustomerPayment | `customerPayments` | Abono / cobro de deuda | no | yes |
| InitialDebt | `initialDebts` | Pre-system debt. **Not a sale** | no | yes |
| Expense | `expenses` | Gasto operativo | no | yes |
| Setting | `settings` | `demoLoaded`, `businessName` | yes | no |

Not persisted: `CartItem` (UI only). Aporte / retiro are **kinds of CashMove**, not tables.

IDs today: Dexie `++id` (device-local integers). `requestId` is a client UUID string, optional. `CashSession.localDate` is `YYYY-MM-DD` unique. `Setting.key` is the PK.

\* `avgCost` is written by `surtir` (weighted average). `productRepository.update` can patch it (tests only; no UI). Backend should only change avgCost via restock.

`StockMoveReason.adjust` exists in the type and **is never written**. Keep reserved; do not show in UI.

---

## 2. Ownership (future Business / User)

Today there is one implicit business = this browser profile.

| Belongs to Business | Belongs to User |
|---------------------|-----------------|
| products, suppliers, customers, sales, returns, stock, cash, debts, expenses, sessions, stats | login identity, which businesses they may access |

Future PostgreSQL every business table gets `business_id`. Isolation is mandatory. Local-only cannot mix two businesses today.

---

## 3. Identity

| Kind | How | Sync-safe? |
|------|-----|------------|
| Row `id` | Autoincrement int | **No** across devices |
| `requestId` | `crypto.randomUUID()` in UI | Yes as idempotency key |
| `localDate` | `YYYY-MM-DD` in **device local TZ** | Must become business timezone |
| `createdAt` | `Date.now()` epoch ms | Instant in time; pair with local date |

**Backend rule:** generate UUID PKs (or keep int + `legacy_dexie_id` on import). Unique `(business_id, request_id)` on every idempotent op. Do not use `Date.now()` as an ID.

Dexie indexes on `requestId` are **not unique**. Single-device safety is the Dexie `rw` transaction check-then-insert. Backend must add a unique constraint.

---

## 4. Immutability

Once created, never update:

Sale, SaleLine, SaleReturn, SaleReturnLine, StockMove, CashMove, InitialDebt, CustomerPayment, Expense.

If I change the product tomorrow:

- **Name** — sale line already stored `productName`. History still readable.
- **Price** — sale used `unitPrice` snapshot. History unchanged.
- **Cost / avgCost** — sale used `unitCost` snapshot. History unchanged.
- **Delete product** — **not allowed today**. Backend: archive, never hard-delete if moves/lines exist.
- **Delete customer** — **not allowed today**. Same.

Seed is the only code that later patches `createdAt` on demo sales (so Inicio shows “hoy”). Not a business path.

CashSession: `openingFloat` / `localDate` stay; close writes `closedAt`, `closingCount`, expected snapshots, `difference` once. Re-close is rejected.

---

## 5. State vs history

| Current state (cache) | Events that must explain it |
|-----------------------|-----------------------------|
| `product.stock` | StockMove (`inicial`, `surtir`, `sale`, shrink, `devolucion`) |
| `product.avgCost` | Weighted average on `surtir` |
| `customer.debt` | InitialDebt + sale.credit − abonos − return.debtReduced |
| Caja esperado | Session.openingFloat + day’s CashMoves |

Must never: patch stock/debt without an event; emit an event without updating state. All writers do both in one Dexie transaction.

`metricCaja` / `balance()` = Σ cashMoves (no opening float).
`expectedBuckets.efectivo` = openingFloat + day’s Efectivo moves.

---

## 6. Atomic operations

| Op | Writes | Txn today |
|----|--------|-----------|
| `createSale` | sales, saleLines, products.stock, stockMoves, cashMoves?, customer.debt? | yes |
| `createReturn` | saleReturns, saleReturnLines, products.stock, stockMoves, cashMoves?, customer.debt? | yes |
| `recordPayment` | customerPayments, customer.debt, cashMoves | yes |
| `recordInitialDebt` | initialDebts, customer.debt | yes (no cash/stock) |
| `surtir` | products.stock+avgCost, stockMoves, cashMoves? | yes |
| `applyShrink` | products.stock, stockMoves | yes |
| `recordExpense` | expenses, cashMoves | yes |
| `ownerAporte` / `ownerRetiro` | cashMoves | yes (`recordMove`) |
| `openSession` | cashSessions | yes; 2nd open of same day returns existing |
| `closeSession` | cashSessions close snapshot | yes |
| `product.create` | products, stockMoves `inicial` if stock>0 | yes; no cash |

If any step fails, the Dexie txn rolls back. Backend: one DB transaction per op, same write set.

---

## 7. Financial matrix

Signs: `+` increase, `−` decrease, `0` unchanged.
Ventas = brutas (saleTotal). Ganancia = period sale margins − period return margins.
Gasté = expenses only. Invertí = cashMoves `compra`. Recibido = sale inflows + abonos (refunds do **not** subtract Recibido; they leave via Caja).

| Operación | Efectivo | Nequi | Deuda | Stock | Ventas | Ganancia | Gasté | Invertí | Recibido |
|-----------|----------|-------|-------|-------|--------|----------|-------|---------|----------|
| Venta Pagada Efectivo | + | 0 | 0 | − | + | + | 0 | 0 | + |
| Venta Pagada Nequi | 0 | + | 0 | − | + | + | 0 | 0 | + |
| Venta Fiada | 0 | 0 | + | − | + | + | 0 | 0 | 0 |
| Venta Parcial | +/0 | +/0 | + | − | + | + | 0 | 0 | + |
| Abono Efectivo | + | 0 | − | 0 | 0 | 0 | 0 | 0 | + |
| Abono Nequi | 0 | + | − | 0 | 0 | 0 | 0 | 0 | + |
| Deuda inicial | 0 | 0 | + | 0 | 0 | 0 | 0 | 0 | 0 |
| Gasto Efectivo | − | 0 | 0 | 0 | 0 | 0 | + | 0 | 0 |
| Gasto Nequi | 0 | − | 0 | 0 | 0 | 0 | + | 0 | 0 |
| Retiro (Efectivo/Nequi) | −/0 | −/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Aporte (Efectivo/Nequi) | +/0 | +/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Surtir pagado Efectivo | − | 0 | 0 | + | 0 | 0* | 0 | + | 0 |
| Surtir pagado Nequi | 0 | − | 0 | + | 0 | 0* | 0 | + | 0 |
| Surtir costo 0 | 0 | 0 | 0 | + | 0 | 0* | 0 | 0 | 0 |
| Me lo comí / Regalo / Perdido | 0 | 0 | 0 | − | 0 | 0 | 0 | 0 | 0 |
| Devolución (pagada) | −/0 | −/0 | 0 | + | 0† | − | 0 | 0 | 0 |
| Devolución (fiada) | 0 | 0 | − | + | 0† | − | 0 | 0 | 0 |
| Alta producto stock inicial | 0 | 0 | 0 | + | 0 | 0 | 0 | 0 | 0 |
| Abrir caja | 0‡ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cerrar caja | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

\* Surtir changes **future** avgCost, not past sale margins.
† Ventas brutas stay; **Devoluciones** metric increases.
‡ `openingFloat` is on the session, not a cashMove. It **does** raise Caja esperado Efectivo.

No mixed-tender sale (one method per ticket). Do not invent split payments in the backend.

---

## 8. Inventory

Reasons actually written: `inicial`, `surtir`, `sale`, `me_lo_comi`, `regalar`, `perdido`, `devolucion`.

`adjust`: type-only, unused. Keep internal; no UI.

Stock never `< 0`. Direct `products.stock` patch is rejected. `inicial` and `devolucion` cannot go through `applyMove` (only create product / createReturn).

Surtir is **today only**. Stock move and cash `compra` share the same `createdAt`.

### Opening stock

Two legal births, both `StockMove(reason=inicial)`. Neither is a compra, aporte, venta, gasto, or cash/Nequi move.

**A. Known cost.** `stock > 0` and `avgCost > 0`. Default.

**B. Gifted / unknown cost.** `stock > 0` and `avgCost = 0` only when the user **explicitly** sets `gifted: true` at create time (“Me lo regalaron / no sé el costo”). The flag is **not** stored on Product. The inicial move keeps `unitCost` 0 and note `Me lo regalaron / costo desconocido`.

Without that declaration, `stock > 0` + `avgCost <= 0` is rejected (`needCost`). Accidental $0 cost must not inflate ganancia.

Gifted means: **these opening units** entered at historical cost 0. It does **not** mean the product is forever free. Later `surtir` reweights `avgCost` with the existing weighted-average formula. Sales already done keep their `saleLine.unitCost` snapshot.

Stock 0 may be created with cost 0 or cost > 0. No inicial move until there are units.

---

## 9. Cost model

**Weighted average** on surtir (`Math.round`). Not FIFO/LIFO.

- Sale snapshots `product.avgCost` at that instant → `saleLine.unitCost`.
- Return uses **that line’s** `unitCost` / `unitPrice`, not current catalog.
- Product create with `stock > 0` requires `avgCost > 0`, unless the user explicitly declares gifted/unknown cost (`gifted: true`). That declaration is create-time only; Product is not a special type. Gifted units are `reason=inicial`, `unitCost` 0, note `Me lo regalaron / costo desconocido`. Not a compra. Later surtir reweights avgCost. Past sale snapshots stay put.
- Stock 0 may have cost 0 until first surtir.

Do not replace this with FIFO unless the owner asks. It is coherent for a candy cart.

---

## 10. Dates

| Field | Meaning | Stats / caja |
|-------|---------|--------------|
| `createdAt` | epoch ms of the operation | period filters, cash day |
| `CashSession.localDate` | `YYYY-MM-DD` in **device local timezone** | one session / day, closed-day lock |
| Return `createdAt` | when the return happens (**today**) | return hits **today’s** caja/stats, not the original sale day |

`localDateKey` uses `Date#getFullYear/Month/Date` (browser TZ).

**Backend:** store UTC timestamptz + `business_local_date` computed in the **business** timezone (Colombia, `America/Bogota`). Never use the server’s TZ to close a day.

---

## 11. Cash day

| State | Meaning |
|-------|---------|
| Sin abrir | no session for `localDate`. Sales/surtir/returns allowed. Gasto/retiro/aporte UI require a session |
| Abierta | session exists, `closedAt` null |
| Cerrada | `closedAt` set. **No** economic mutation for that local date |

`assertDayEditable(atMs)`: if a session for that local date has `closedAt`, throw.

Opening float = bills you **started** with, not the pocket after selling.

Close counts **Efectivo only**. Nequi is snapshotted, not counted. Difference = counted − expected Efectivo.

Initial product stock and initial customer debt skip the closed-day lock (carga inicial).

---

## 12. Idempotency

| Operación | requestId | Repeat |
|-----------|-----------|--------|
| Venta | sales.requestId | return existing id |
| Abono | customerPayments.requestId | return existing id |
| Deuda inicial | initialDebts.requestId | return existing id |
| Gasto | expenses.requestId | return existing id |
| Retiro / aporte | cashMoves.requestId | return existing id |
| Surtir | stockMoves.requestId | return existing id |
| Merma | stockMoves.requestId | return existing id |
| Devolución | saleReturns.requestId | return existing id |
| Abrir caja | unique `localDate` | return existing session |
| Cerrar caja | re-close throws | — |

UI `busy` is not enough. Repository is the guard. Keep `requestId` forever for replay/sync.

---

## 13. Delete

| Can delete? | What |
|-------------|------|
| No | sale, line, return, stockMove, cashMove, abono, initialDebt, expense, session rows |
| No | customer or product with history |
| Yes | **wipe entire IndexedDB** after typing `BORRAR` (this device only) |

Backend: no hard delete of ledger rows. Archive products/customers. Wipe is a device reset, not a server op.

Demo must not load if **any** business data exists (products, customers, debts, sales, cash, stock moves, sessions, expenses).

---

## 14. Relations

```
Customer 1—* Sale (nullable customerId on paid)
Customer 1—* CustomerPayment
Customer 1—* InitialDebt
Sale 1—* SaleLine → Product (id + productName snapshot)
Sale 1—* SaleReturn 1—* SaleReturnLine → SaleLine, Product
Product 1—* StockMove
Sale / SaleReturn / Expense / Purchase → CashMove (refType + refId)
CashSession 1—* CashMove (sessionId nullable if no session)
Supplier 1—* StockMove.supplierId (surtir only, no payable)
```

Weak spots (reconstructable, tighten in Postgres):

- Sale has **no** `method`; paid method lives on CashMove `kind=sale`.
- Abono `saleId` is usually null (debt is on the customer, not allocated per ticket).
- CashMove.sessionId may be null if caja was never opened.

---

## 15. Future PostgreSQL (conceptual — do not create)

```
users
businesses
business_users              -- membership
products                    -- business_id, uuid
customers
suppliers
sales                       -- + method, request_id unique per business
sale_lines
sale_returns
sale_return_lines
stock_moves
cash_sessions               -- unique (business_id, local_date)
cash_moves
customer_payments
initial_debts
expenses
settings                    -- per business
```

Import from Dexie: keep `legacy_id` int. Rebuild `product.stock` / `customer.debt` from events and **compare** to cached values before go-live.

Do **not** import Cache Storage. Only IndexedDB.

---

## 16. Stats (current formulas)

Period = hoy / semana / mes in **local** TZ (`rangeForPeriod`).

| Metric | Formula | Initial debt | Returns | Merma | Retiro | Aporte |
|--------|---------|--------------|---------|-------|--------|--------|
| Ventas | Σ sale.saleTotal in period | no | not subtracted | no | no | no |
| Devoluciones | Σ returnLine.unitPrice×qty in **return** period | no | yes | no | no | no |
| Recibido | amountReceived + abonos in period | no | not subtracted | no | no | no |
| Recibido Efectivo/Nequi | cashMoves in `sale`\|`debt_collect` | no | no | no | no | no |
| Por cobrar | Σ customer.debt **now** | **yes** | after debtReduced | no | no | no |
| Gasté | Σ expenses in period | no | no | no | **no** | no |
| Invertí | cashMoves `compra` | no | no | no | no | **no** |
| Ganancia aprox | sale margins in period − return margins in period | no | yes | **no** | no | no |
| Valor inventario | Σ stock×avgCost now | — | via stock | via stock | — | — |

Ganancia is **sale margin**, not full P&L. Caption says it does not subtract merma/regalos and is not caja.

---

## 17. Repository contract

Layers: UI → store → repository → Dexie.

Repositories **import `getDb()`** today. For backend, keep method names; swap the adapter. Domain must not mention IndexedDB.

Critical methods: `createSale`, `createReturn`, `recordPayment`, `recordInitialDebt`, `surtir`, `applyShrink`, `recordExpense`, `ownerAporte`, `ownerRetiro`, `openSession`, `closeSession`, `product.create`.

---

## 18. Rules that must never break

1. A historical sale is immutable. Returns are new rows.
2. Stock changes only through StockMove.
3. Debt changes only through initial debt, sale credit, abono, or return.
4. Initial debt is not a sale, not caja, not inventory, not period fiado.
5. Retiro ≠ gasto. Aporte ≠ venta. Nequi ≠ efectivo físico.
6. A closed local day cannot receive economic mutations.
7. Critical ops are idempotent via `requestId` (or unique localDate for caja).
8. Money is integer COP.
9. Sale/return economics use snapshots, never current catalog.
10. One PayMethod per ticket. No CxP on suppliers.
11. Opening float is starting bills, not post-sale pocket.
12. Demo never loads on top of real books. Wipe is whole-device only.
13. `product.stock` and `customer.debt` stay ≥ 0.
14. Weighted-average cost on surtir; do not rewrite past `unitCost`. Opening stock is either known-cost or explicitly gifted at 0 — never a silent 0.

---

## 19. Before backend (checklist)

- Map Dexie int ids → UUID (or dual key).
- Unique `(business_id, request_id)`.
- `business_id` on every table + RLS/where-clause isolation.
- Persist sale `method`.
- Business timezone for `local_date`.
- Import job: replay vs cached stock/debt.
- No Nest/Prisma until this contract is the spec.
