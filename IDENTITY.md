# DulceCalle — Identity & compatibility bridge (Fase 6.7)

Audit only. **Do not run an import.** The owner re-enters products, customers and fiados by hand (deudas as **deuda anterior**, never as sales).

M3: the PWA business UI talks HTTP (`pwaStorage() === "http"`, UUID routes via `routeId()`). Dexie repositories remain for domain tests only. Dexie `++id` and PG UUID must not mix.

Contracts this document does **not** change: [DOMAIN.md](DOMAIN.md), [DATABASE.md](DATABASE.md), [MIGRATION.md](MIGRATION.md), [API_CONTRACT.md](API_CONTRACT.md), [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md).

Helpers (no I/O): [`src/data/identity.ts`](src/data/identity.ts).

---

## Compatibilidad

### Dexie IDs

All persisted business rows except `settings` use Dexie `++id` (device-local **positive integer**).

| Entity | Table | PK | FKs (numeric) |
|--------|--------|----|----------------|
| Product | `products` | `++id` | — |
| Customer | `customers` | `++id` | — |
| Supplier | `suppliers` | `++id` | — |
| Sale | `sales` | `++id` | `customerId` |
| SaleLine | `saleLines` | `++id` | `saleId`, `productId` |
| SaleReturn | `saleReturns` | `++id` | `saleId` |
| SaleReturnLine | `saleReturnLines` | `++id` | `returnId`, `saleLineId`, `productId` |
| StockMove | `stockMoves` | `++id` | `productId`, `supplierId?`, `refId?` |
| CashSession | `cashSessions` | `++id` | — (`localDate` unique) |
| CashMove | `cashMoves` | `++id` | `sessionId?`, `refId?` |
| CustomerPayment | `customerPayments` | `++id` | `customerId`, `saleId?` |
| InitialDebt | `initialDebts` | `++id` | `customerId` |
| Expense | `expenses` | `++id` | — |
| Setting | `settings` | `key` string | — (not `++id`) |

`CartItem` is UI memory only — not imported ([MIGRATION.md](MIGRATION.md) §9).

`id?: number` is optional until Dexie assigns it. Comparisons use `===`. React list keys use `p.id` / `c.id` / `s.id` (fine for both int and UUID **if** the value is already the live PK).

`Number(params.id)` on App Router pages **is Dexie-only**. A UUID becomes `NaN` and `getById` misses.

### Backend UUIDs

Postgres PK is UUID on every business table. App generates UUID (same idea as `requestId`).

Also on each imported row:

- `legacy_dexie_id INTEGER NULL` — never a column named `legacy_id`
- unique `(business_id, legacy_dexie_id)` WHERE not null

API JSON ids are **strings**. `HttpRepository` maps with `asUuid()`; numbers are rejected.

Identity tables (`users`, `businesses`, `business_memberships`) are UUID from day one — they have no Dexie counterpart.

### Repository Port

[`src/repositories/ports.ts`](src/repositories/ports.ts) lists **operations**, not a shared `id` type.

| Adapter | ID type | Wired to UI |
|---------|---------|-------------|
| Dexie `*Repository` | `number` | **yes (default)** |
| `HttpRepository` | UUID `string` | **no** |

The port is **not** storage-agnostic on types. Swapping adapters in the UI without an import would mix `productId: 3` with `/products/{uuid}`.

Do **not** globally change `id: number` → `string` while Dexie is live.

### HTTP Adapter

[`src/data/http/repository.ts`](src/data/http/repository.ts) is transport only.

- Path/body/response ids: UUID strings (`asUuid`)
- COP: JSON integers (`asCopJson`) — not IDs
- Qty/stock/lowStockAt: integers (not money, not ids)
- `Idempotency-Key` / `X-Business-Id` / `Authorization`: unchanged
- Does **not** send `legacy_dexie_id` (import job only)
- Does **not** compute stock, debt, totals, cost, profit, caja

### Rutas afectadas

All of these parse `Number(params.id)` today:

| Route | Entity |
|-------|--------|
| `/ventas/[id]` | Sale |
| `/ventas/[id]/devolver` | Sale |
| `/clientes/[id]` | Customer |
| `/clientes/[id]/abono` | Customer |
| `/clientes/[id]/deuda-inicial` | Customer |
| `/inventario/[id]` | Product |
| `/inventario/[id]/surtir` | Product |
| `/inventario/[id]/me-lo-comi` | Product |
| `/inventario/[id]/regalo` | Product |
| `/inventario/[id]/perdido` | Product |
| `/inventario/proveedores/[id]` | Supplier |

`<select>` on cobrar / surtir uses `value={c.id}` + `Number(e.target.value)` — also Dexie-only.

Links like `` href={`/ventas/${s.id}`} `` work for UUID **after** the parse change.

### Tipos TypeScript

| Kind | Examples | Verdict |
|------|----------|---------|
| Dexie-only | `Product.id`, `getById(id: number)`, stores, pages | Keep `number` while Dexie is default |
| Domain money / qty | `price`, `debt`, `stock`, `qty` | Stay `number` (COP/int). Not identity |
| Should be agnostic later | route params, `productId` on cart/sale input | Become `string` **when** UI talks HTTP |
| Already UUID | `HttpRepository` / `RemoteProduct.id` | Keep `string`; never `Number(id)` |

No global replace in this phase.

### Relaciones afectadas

```
Business (future PG only)
  ├── Product ── stockMoves, saleLines, saleReturnLines
  ├── Customer ── sales, customerPayments, initialDebts
  ├── Supplier ── stockMoves.supplierId (surtir only; no CxP)
  ├── CashSession ── cashMoves.sessionId
  ├── Sale
  │     ├── customerId
  │     ├── saleLines.productId
  │     ├── cashMoves (kind=sale, refId=saleId)  → sales.method on import
  │     └── saleReturns → saleReturnLines
  ├── Expense ── cashMoves (kind=expense, refId)
  └── Setting (key)
```

Every numeric FK must be rewritten via `import_id_map` at import time. Until then the HTTP adapter must not receive Dexie ints.

---

## Migración futura (not executed)

Matches [MIGRATION.md](MIGRATION.md) hybrid C: **insert stored rows**, then reconcile. Do not replay `createSale` / `surtir`.

### Orden de importación

1. `users` + `businesses` + membership (`America/Bogota`)
2. `settings` (string PK `key` — no map)
3. `products` / `customers` / `suppliers`
4. `cash_sessions`
5. `sales`
6. `sale_lines`
7. `sale_returns`
8. `sale_return_lines`
9. `stock_moves`
10. `customer_payments`
11. `initial_debts`
12. `expenses`
13. `cash_moves`

Code list: `IMPORT_TABLE_ORDER` in [`src/data/identity.ts`](src/data/identity.ts) (mapped tables). The importer also writes `settings` first (string PK, no `import_id_map`). Users/business/membership are created before the dump import.

### Mapeo Dexie → UUID

For each inserted row:

1. Generate UUID PK (never reuse the Dexie int)
2. `INSERT import_id_map(business_id, table_name, dexie_id, pg_id)`
3. Set `legacy_dexie_id = dexie_id` on the row
4. Rewrite FKs with `resolveImportId(map, table, dexieId)`

Do not change Dexie IDs on the phone.

`requestId`: real UUID → `request_id`. Dexie fallback `prefix-Date.now-random` → `legacy_request_id` + UUID v5 for the unique index ([MIGRATION.md](MIGRATION.md) §2).

### Import ID Map

Table already exists in Prisma (`import_id_map`). Unique `(business_id, table_name, dexie_id)`. API services **never** write it.

In-memory helper for a future job: `importMapKey("products", 3)` → `"products:3"`.

### InitialDebt (official live total: $45.200)

Dexie `initialDebts` rows. **Not** a sale.

Official dump `544b330b-e499-40b4-8909-cdcf6745fc64`: `SUM = 45_200 COP`. Owner confirmed. Do not rewrite to 45000.

Import path:

- Copy `amount`, mapped `customer_id`, `request_id` / `legacy_request_id`, `created_at`
- `occurred_on` from created_at in `America/Bogota`
- **Zero** `sales`, `cash_moves`, `stock_moves`
- Do not touch Ventas / Recibido / Nequi / Invertí
- After import: `Σ initial_debts + Σ sale.credit − Σ payments − Σ return.debtReduced` **must equal** `customers.debt`

If a later dump’s sum ≠ 45200, **report that dump’s sum**. Do not invent the difference.


---

## Cambios necesarios antes de conectar HTTP

Exact, small, **future** list (not done here):

1. Run the Dexie → PG import job ([MIGRATION.md](MIGRATION.md)). Fill `import_id_map` + `legacy_dexie_id`.
2. Change route params from `Number(params.id)` to keep the string (UUID).
3. Change domain/store `id: number` (and FKs) to UUID `string` **or** introduce a generic `EntityId` used by both adapters after Dexie is no longer default.
4. Point stores at `HttpRepository` behind an explicit flag — still **no** auto-switch, **no** dual-write.
5. Cart / selects / React keys follow the same id type.
6. Keep Dexie on the phone until HTTP is proven (MIGRATION §8.10).

Out of scope until a later phase: sync, outbox, CRDT, returns/surtir/merma on the API, Fase 7.

---

## Riesgos

- Wiring HTTP before import would POST Dexie ints as UUID path params → 400/404 and could not reconstruct FKs.
- `Number(uuid)` is `NaN`; pages would show empty fichas.
- `legacy_dexie_id` is schema-ready but **unwritten** by Nest services (correct).
- Demo vs real mix in a dump is still **NEEDS DECISION at import time** ([MIGRATION.md](MIGRATION.md) §7) — not this phase.
