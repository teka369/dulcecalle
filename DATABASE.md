# DulceCalle — Database

Conceptual PostgreSQL model. **Do not create these tables yet.**
Rules: [DOMAIN.md](DOMAIN.md). Architecture: [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md).

Money = `BIGINT` COP integers. Quantities = `INTEGER`. Never `NUMERIC`/`FLOAT` for COP.

Default PK: `UUID`. App generates UUID (same idea as today’s `requestId`).

Column names: see canonical table in [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md). Dexie `requestId` → `request_id`. Event day → `occurred_on`. Session day → `local_date`. Import tracer → `legacy_dexie_id` (never `legacy_id`).

Every business table: `business_id UUID NOT NULL REFERENCES businesses(id)` — including child tables (`sale_lines`, `sale_return_lines`, etc.).

---

## 1. Identity & tenancy

### users
| Column | Type | Notes |
|--------|------|--------|
| id | UUID PK | |
| email | TEXT UNIQUE NOT NULL | |
| password_hash | TEXT | nullable if magic-link later |
| created_at | timestamptz | |

### businesses
| Column | Type | Notes |
|--------|------|--------|
| id | UUID PK | |
| name | TEXT NOT NULL | e.g. DulceCalle |
| timezone | TEXT NOT NULL DEFAULT `'America/Bogota'` | **never** use server TZ |
| created_at | timestamptz | |

### business_memberships
| Column | Type | Notes |
|--------|------|--------|
| id | UUID PK | |
| business_id | UUID FK | |
| user_id | UUID FK | |
| role | ENUM `owner` \| `staff` | |
| created_at | timestamptz | |

Unique: `(business_id, user_id)`.

### import_id_map
Used only by the Dexie import job. Not a business document.

| Column | Type |
|--------|------|
| business_id | UUID |
| table_name | TEXT |
| dexie_id | INTEGER |
| pg_id | UUID |

Unique `(business_id, table_name, dexie_id)`. Also denormalized as `legacy_dexie_id` on the row.

---

## 2. Catalog

### products
| Column | Type | Notes |
|--------|------|--------|
| id | UUID PK | |
| business_id | UUID | |
| name | TEXT NOT NULL | |
| category | TEXT NOT NULL DEFAULT `'General'` | |
| price | BIGINT NOT NULL CHECK >= 0 | selling price catalog |
| avg_cost | BIGINT NOT NULL CHECK >= 0 | weighted average cache |
| stock | INTEGER NOT NULL CHECK >= 0 | cache; **no client patch** |
| low_stock_at | INTEGER NOT NULL CHECK >= 0 | |
| archived_at | timestamptz NULL | no hard delete |
| legacy_dexie_id | INTEGER NULL | import only |
| created_at / updated_at | timestamptz | |

Unique import: `(business_id, legacy_dexie_id)` WHERE legacy not null.

**No `gifted` column.** Gift is a birth `stock_moves.reason = inicial` + note.

### customers
Same pattern: name, phone, `debt BIGINT CHECK >= 0` (cache), archived_at, legacy_dexie_id.

### suppliers
name, phone, notes. **No accounts payable.**

### settings
`(business_id, key)` PK. Values as TEXT. Keys today: `demoLoaded`, `businessName`.

---

## 3. Sales

### sales
| Column | Type | Notes |
|--------|------|--------|
| id | UUID PK | |
| business_id | UUID | |
| customer_id | UUID NULL FK | required if partial/credit |
| payment_kind | ENUM `paid` \| `partial` \| `credit` | |
| method | ENUM `Efectivo` \| `Nequi` NULL | **stored in PG**; Dexie reconstructs from cash_move. Required if amount_received > 0 |
| sale_total | BIGINT NOT NULL CHECK >= 0 | |
| amount_received | BIGINT NOT NULL CHECK >= 0 | |
| credit | BIGINT NOT NULL CHECK >= 0 | sale_total − amount_received |
| request_id | UUID NULL | unique per business; copy from Dexie if UUID-shaped |
| legacy_request_id | TEXT NULL | Dexie non-UUID requestId, if any |
| note | TEXT | |
| occurred_on | DATE NOT NULL | business local day (`America/Bogota` unless business.timezone says otherwise) |
| created_at | timestamptz | immutable |
| legacy_dexie_id | INTEGER NULL | import only |

Check: `amount_received + credit = sale_total`.  
Check: `payment_kind = 'paid'` ⇒ credit = 0; `credit` ⇒ amount_received = 0.  
Unique: `(business_id, request_id)` WHERE request_id IS NOT NULL.

**Immutable.** No UPDATE.

### sale_lines
`business_id`, sale_id, product_id, product_name (snapshot), qty > 0, unit_price >= 0, unit_cost >= 0, line_total = unit_price * qty.  
Snapshots never change when product price/cost/name change. Immutable. `legacy_dexie_id` nullable.

### sale_returns
sale_id, refund_amount >= 0, debt_reduced >= 0, method NULL if debt-only, request_id unique per business, occurred_on, created_at. Immutable.

### sale_return_lines
return_id, sale_line_id, product_id, qty > 0, unit_price/unit_cost **copied from the sale line**.

App check: sum(returned qty per line) ≤ original qty.

---

## 4. Inventory events

### stock_moves
| Column | Type | Notes |
|--------|------|--------|
| reason | ENUM | `inicial` `surtir` `sale` `me_lo_comi` `regalar` `perdido` `devolucion` `adjust` |
| delta | INTEGER NOT NULL CHECK ≠ 0 | |
| unit_cost | BIGINT NOT NULL CHECK >= 0 | |
| supplier_id | UUID NULL | surtir only |
| ref_type / ref_id | TEXT / UUID | sale, product, return, … |
| note | TEXT | gifted: `Me lo regalaron / costo desconocido` |
| request_id | UUID NULL | unique per business |
| occurred_on | DATE NOT NULL | commercial day; not `CURRENT_DATE` |
| created_at | timestamptz | |
| legacy_dexie_id | INTEGER NULL | import only |

`adjust` exists in the enum, unused. Do not expose.

Unique `(business_id, request_id)` WHERE request_id IS NOT NULL.

---

## 5. Cash

### cash_sessions
| Column | Type | Notes |
|--------|------|--------|
| local_date | DATE NOT NULL | business TZ day |
| opened_at | timestamptz | |
| closed_at | timestamptz NULL | |
| opening_float | BIGINT NOT NULL CHECK >= 0 | **not** a cash_move |
| closing_count | BIGINT NULL | physical Efectivo |
| expected_efectivo / expected_nequi | BIGINT NULL | snapshot at close |
| difference | BIGINT NULL | closing_count − expected_efectivo |
| note | TEXT | |
| legacy_dexie_id | INTEGER NULL | |

**UNIQUE (business_id, local_date).** Second open → return existing.

Opening float is bills at start, not post-sale pocket.

### cash_moves
| Column | Type | Notes |
|--------|------|--------|
| amount | BIGINT CHECK > 0 | |
| direction | ENUM `in` \| `out` | |
| method | ENUM `Efectivo` \| `Nequi` | never mix in one row |
| kind | ENUM | `sale` `debt_collect` `expense` `retiro` `aporte` `compra` `devolucion` |
| session_id | UUID NULL | null if caja never opened that day |
| ref_type / ref_id | | |
| request_id | UUID NULL | unique per business |
| occurred_on | DATE NOT NULL | commercial day |
| created_at | timestamptz | |
| legacy_dexie_id | INTEGER NULL | import only |

retiro ≠ expense. aporte ≠ sale. compra = paid surtir. Diferencia is **not** a kind.

### expenses
amount, category, note, method, request_id unique, occurred_on, created_at. Immutable. Always paired with cash_move kind=expense in the same txn.

---

## 6. Debts

### customer_payments (abonos)
customer_id, amount > 0, method, sale_id **usually NULL** (debt is on the customer, not allocated per ticket — keep that), request_id unique, occurred_on.

### initial_debts
customer_id, amount > 0, note, request_id unique, created_at, occurred_on.

**Not a sale. Not caja. Not Nequi. Not inventory.**  
The owner’s live books include **$45.000 COP** in this table. Import must keep that meaning (see [MIGRATION.md](MIGRATION.md)).

---

## 7. Indexes (justified)

| Index | Why |
|-------|-----|
| `(business_id, occurred_on)` on sales, cash_moves, stock_moves, expenses, payments, returns | day/stats |
| `(business_id, customer_id)` on sales, payments, initial_debts | ficha |
| `(business_id, product_id, created_at)` on stock_moves | product history |
| `(business_id, request_id)` unique partial on each idempotent table | retries |
| `(business_id, local_date)` unique on cash_sessions | one session / day |
| `(business_id, sale_id)` on sale_lines, sale_returns | ficha venta |
| `(business_id, debt)` on customers WHERE debt > 0 | por cobrar |

No extra analytics warehouse.

---

## 8. Cross-row / same-business FKs

Every FK must belong to the same `business_id`. Enforce in the service (Prisma cannot easily composite-FK every pair). Optional composite FKs later: `(business_id, id)` unique on parents.

---

## 9. Atomic operations → tables

| Op | Writes | Rollback if |
|----|--------|-------------|
| createSale | sales, sale_lines, products.stock, stock_moves, cash_moves?, customers.debt? | any fail |
| createReturn | sale_returns, lines, products.stock, stock_moves, cash_moves? and/or customers.debt | any |
| recordPayment | customer_payments, customers.debt, cash_moves | any |
| recordInitialDebt | initial_debts, customers.debt | any (no cash) |
| surtir | products.stock+avg_cost, stock_moves, cash_moves? | any |
| applyShrink | products.stock, stock_moves | any |
| recordExpense | expenses, cash_moves | any |
| ownerAporte / ownerRetiro | cash_moves | any |
| openSession | cash_sessions | unique day → return existing |
| closeSession | cash_sessions close cols only | already closed → error |
| product.create | products, stock_moves inicial if stock>0 | gifted allows cost 0; else needCost |

---

## 10. Layering of checks

| Rule | Postgres | Prisma/DTO | Domain service |
|------|----------|------------|----------------|
| money ≥ 0, stock ≥ 0, debt ≥ 0 | CHECK | yes | yes |
| unique request_id / session day | UNIQUE | catch P2002 → return existing | lookup first |
| sale snapshots | NOT NULL | — | copy from product at write |
| gifted cost 0 | — | `gifted` flag on create DTO only | needCost unless gifted |
| closed day | — | — | assertDayEditable |
| return qty ≤ remaining | — | — | yes |
| abono ≤ debt | — | — | yes |
| same-tenant FKs | FK + service | — | yes |
| Nequi ≠ Efectivo | ENUM | ENUM | ENUM |

Do not rely on a single layer.
