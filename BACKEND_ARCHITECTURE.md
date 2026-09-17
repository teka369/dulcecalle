# DulceCalle — Backend architecture

Specification only. Do **not** treat this file as permission to ship Nest/Prisma.
Business rules live in [DOMAIN.md](DOMAIN.md). This file says **how** a server must implement them.

Related: [DATABASE.md](DATABASE.md) · [API_CONTRACT.md](API_CONTRACT.md) · [MIGRATION.md](MIGRATION.md)

---

## 1. Goal

Move from:

```
UI → Store → Repository → Dexie
```

to:

```
UI → Store → Repository port
                 ├── Dexie adapter   (current PWA, stays working)
                 └── HTTP adapter    (future)
                          ↓
              NestJS application
                          ↓
              Prisma / PostgreSQL
```

The PWA keeps working local-first until an adapter is swapped. Dexie is **not** deleted in the first backend slice.

---

## 2. Target stack (when implementation starts)

| Layer | Choice | Why |
|-------|--------|-----|
| API | NestJS + TypeScript | Same language as domain |
| ORM | Prisma | Migrations + typed client |
| DB | PostgreSQL 16 | Constraints, unique indexes, txn |
| Auth | JWT access + refresh (httpOnly cookie or bearer) | Spec only this phase |
| Money | `BIGINT` integer COP | Never floats; Int32 is too tight long-term |
| Time | `timestamptz` UTC + `DATE` business local | Colombia, not server TZ |
| IDs | UUID PK + optional `legacy_dexie_id` | Sync-safe; Dexie ints stay on the phone |

---

## 3. Modules (Nest)

```
app
├── identity        users, sessions, JWT
├── tenancy         businesses, memberships, BusinessContext
├── catalog         products, customers, suppliers
├── sales           sales, lines, returns   ← first domain BC (with cash)
├── cash            sessions, moves, expenses, aporte/retiro
├── inventory       stock moves, surtir, shrink, gifted birth
├── ledger          payments, initial debts
├── stats           read-model queries (no writes)
├── import          Dexie dump → Postgres (offline job)
└── shared          money, clock, errors, request-id, day-guard
```

`aporte` / `retiro` stay **CashMove.kind**. Do not invent tables.

`adjust` stays a reserved stock reason. No UI, no new endpoint.

---

## 4. Request path

```
HTTP
 → AuthGuard            (user id)
 → MembershipGuard      (resolves business from membership, NEVER from body)
 → ValidationPipe       (DTO)
 → Application service  (one Postgres transaction)
 → Domain rules         (port of src/domain: money, day, returns split, weighted avg)
 → Prisma
```

`businessId` in a JSON body is ignored. The server uses the membership of the authenticated user (header `X-Business-Id` only as a **selector among memberships**, then verified).

---

## 5. Domain vs storage

Port the **rules** from `src/domain` (money, `assertDayEditable`, `splitReturnSettlement`, `weightedAvgCost`, `needCost` / gifted). Do not port `getDb()`.

Repository **ports** keep today’s method names:

`createSale`, `createReturn`, `recordPayment`, `recordInitialDebt`, `surtir`, `applyShrink`, `recordExpense`, `ownerAporte`, `ownerRetiro`, `openSession`, `closeSession`, `product.create`.

Implementations:

| Adapter | When |
|---------|------|
| `Dexie*Repository` | Current PWA |
| `Http*Repository` | After API exists |
| `Prisma*Repository` | Inside Nest |

Do not rewrite every store in this phase. First backend slice uses Prisma only on the server.

---

## 6. Derived state

Same as Dexie: `product.stock` and `customer.debt` are **caches** updated in the same transaction as the event.

Postgres CHECK: `stock >= 0`, `debt >= 0`.

On import, reconstruct from events and **compare** to cache (see [MIGRATION.md](MIGRATION.md)). Do not silently overwrite.

Server never accepts `stock`, `avgCost` (except product birth), `debt`, `unitCost` of a sale from the client. It reads them from DB.

---

## 7. Clock

Every `Business` has `timezone` default `'America/Bogota'`.

| Field | Type | Meaning |
|-------|------|---------|
| `created_at` | `timestamptz` | Instant (UTC) |
| `occurred_on` | `DATE` | Commercial day in **business** TZ, written at insert |

`occurred_on = (created_at AT TIME ZONE business.timezone)::date`

Cash session `local_date` **is** `occurred_on` for that day.

Stats, close-day, “surtir today only” use `occurred_on`, never `CURRENT_DATE` of the server.

Closed day: a session exists for `(business_id, local_date)` with `closed_at IS NOT NULL` → reject economic writes whose `occurred_on` equals that date.

Exempt (same as today): product birth `inicial`, `initial_debts`.

---

## 8. Idempotency

Client sends `Idempotency-Key` / `requestId` (UUID). Required on every economic POST.

Postgres: **partial unique** `UNIQUE (business_id, request_id) WHERE request_id IS NOT NULL` on the owning table.

Repeat: find row, return it with HTTP 200. No second stock/cash/debt.

Open caja: `UNIQUE (business_id, local_date)` — second open returns the existing session.

Close caja: second close → `409 SESSION_ALREADY_CLOSED`.

Product create has **no** requestId in Dexie today. The **API** will require one. Dexie stays as-is until the HTTP adapter.

---

## 9. Transactions (must be 1 DB txn)

See [DATABASE.md](DATABASE.md) § operations. If any write fails → `ROLLBACK`.

No “save sale then stock in another request”.

---

## 10. Immutability

Ledger tables: application **rejects** PATCH/DELETE.

Postgres: revoke UPDATE/DELETE from the app role except:

- `cash_sessions`: only close columns (`closed_at`, `closing_count`, `expected_*`, `difference`, `note`) and only when `closed_at IS NULL`
- catalog: `products` name/price/`low_stock_at`/`archived_at`; `customers` name/phone/`archived_at`; `suppliers` name/phone/notes; `settings`
- derived caches: `products.stock` / `avg_cost`, `customers.debt` — **only** from the same txn as the event

No hard delete of sales, lines, returns, moves, payments, initial debts, expenses.

---

## 11. Tenancy isolation

Every business table has `business_id NOT NULL`.

Enforced in **three** places:

1. Guard: `BusinessContext.businessId` from membership
2. Every Prisma `where: { businessId }`
3. Optional RLS: `business_id = current_setting('app.business_id')::uuid` after `SET LOCAL` in the txn

Cross-tenant GET/POST is `403 FORBIDDEN`. IDs from another business look like `404` (do not leak existence).

---

## 12. Security (spec)

- TLS only in production
- Auth required except `GET /health`
- Role: `owner` (all writes) / `staff` (sales, payments, inventory; no wipe, no membership admin)
- Rate limit economic POSTs per user
- CORS: PWA origin only
- Secrets in env (`DATABASE_URL`, `JWT_SECRET`, …)
- Structured logs: `requestId`, `userId`, `businessId`, op, result — no full card/Nequi numbers (we don't store those)
- Do not log dump files with customer phones in plaintext beyond import audit

---

## 13. Offline future (do not build now)

Leave room for:

```
PWA Dexie  →  outbox (requestId, op, payload, localId)
           →  POST /v1/... with Idempotency-Key
           →  server UUID returned, stored as server_id
```

Conflicts: **server wins on unique requestId** (same op is a no-op). Two devices, two requestIds = two ops. No CRDT. No automatic merge of stock.

That is enough. Do not invent a sync engine in the first BC.

---

## 14. First bounded context to implement later

**Sales + Cash**, after a thin **foundation** (Nest, Prisma schema, auth, business, membership, products, customers as FK).

Why this BC first: it is where money, stock, debt, snapshots, closed-day, and idempotency meet. If that txn is wrong, the rest of the backend is decoration.

Out of scope for that first slice: surtir/shrink UI on the API, returns, expenses, stats, Dexie import, PWA adapter swap.

---

## 15. Later implementation order

1. Foundation: Nest, Prisma, Postgres, health, auth, business, membership
2. Catalog: products (birth + gifted), customers, suppliers (no CxP)
3. **Sales + Cash** (sessions, moves, createSale, payments)
4. Inventory writes: surtir, shrink
5. Returns
6. Expenses, aporte/retiro (if not already via cash)
7. Stats read
8. Dexie import job
9. HTTP adapter on the PWA
10. Outbox / multi-device sync

---

## 16. What this phase does not do

No Nest app, no Prisma schema file, no Docker Postgres, no JWT, no data move, no Dexie change.
