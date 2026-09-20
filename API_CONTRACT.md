# DulceCalle — API contract

Conceptual REST `/v1`. Business domain implemented through M3: catalog, sales, cash, stats reads, and PWA HTTP (UUID). Settings, memberships admin, wipe, import, and sync remain later.
Auth (M2): register, login, refresh, logout. JWT is stateless.
Auth: Bearer. `businessId` comes from membership, not from the body.

Error envelope:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "No hay suficiente stock." } }
```

`message` is the existing Spanish copy from `src/domain`. Clients may switch on `code`.

---

## 1. Error codes (stable)

| HTTP | code | When |
|------|------|------|
| 400 | `VALIDATION` | DTO |
| 401 | `UNAUTHORIZED` | no/invalid token |
| 403 | `FORBIDDEN` | no membership for this business, or role cannot do this action |
| 404 | `NOT_FOUND` | member of this business, but this id is not here (also used for ids that belong to another tenant — do not leak) |
| 409 | `CLOSED_DAY` | `dayClosed` |
| 409 | `SESSION_ALREADY_CLOSED` | re-close |
| 409 | `INSUFFICIENT_STOCK` | |
| 409 | `ABONO_EXCEEDS_DEBT` | |
| 409 | `RETURN_EXCEEDS` | |
| 409 | `NEED_COST` | stock>0, cost 0, not gifted |
| 409 | `STOCK_VIA_MOVES` | patch stock |
| 200 | *(idempotent hit)* | same request_id; body = original resource |
| 429 | `RATE_LIMIT` | |
| 500 | `INTERNAL` | |

Duplicate request_id is **not** 409: it is 200 with the first result.

---

## 2. Auth & tenancy

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/v1/auth/register` | no | first owner + first business |
| POST | `/v1/auth/login` | no | access 15m + refresh 7d |
| POST | `/v1/auth/refresh` | no | body `{ refreshToken }`; new access + refresh |
| POST | `/v1/auth/logout` | yes | `{ ok: true }`. Does **not** revoke JWTs |
| GET | `/v1/me` | yes | user + memberships |
| GET | `/v1/businesses` | yes | memberships only |
| POST | `/v1/businesses` | yes | new business, caller = owner |
| GET | `/v1/health` | no | |

Customer portal (M5). Not a `User`. Business comes from the token, not `X-Business-Id`.

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/v1/customer-access/login` | no | `{ code, name }`; 10/min; generic fail |
| POST | `/v1/customer-access/refresh` | no | `{ refreshToken }` |
| POST | `/v1/customer-access/logout` | customer | `{ ok: true }`; does not revoke JWTs |
| GET | `/v1/customer/me` | customer | id, code, name, debt |
| GET | `/v1/customer/me/ledger` | customer | ledger without `unitCost` / extra ids |

Selector: header `X-Business-Id` must be a membership of the user. Do not send it when no business is selected.

**JWT**

- Access: 15m, `JWT_SECRET`. Refresh: 7d, `JWT_REFRESH_SECRET`, claim `typ: "refresh"`.
- Customer portal access: 15m, claim `typ: "customer"` + `businessId`. Customer refresh: 7d, `typ: "customer_refresh"`.
- Both secrets are **required** at boot. No fallback (no `dev-access-secret`).
- Refresh tokens and customer tokens are rejected as admin Bearer (`401 UNAUTHORIZED`).
- There is no denylist. Logout is client-side: delete stored tokens. An old refresh remains valid until expiry.

**403 vs 404**

- **A.** Caller is not a member of the selected business → `403 FORBIDDEN`.
- **B.** Caller is a member, id does not exist **in that business** (unknown id, or id of another business) → `404 NOT_FOUND`.
- Staff calling an owner-only route → `403 FORBIDDEN`.

---

## 3. Catalog

### Products
| Method | Path | Idempotent | Notes |
|--------|------|------------|-------|
| GET | `/v1/products` | | |
| GET | `/v1/products/:id` | | |
| GET | `/v1/products/:id/moves` | | stock history |
| POST | `/v1/products` | requestId | create; may include opening stock |

**CreateProductDto** (client may send):

- name, price, stock?, avgCost?, lowStockAt?, **gifted?**, requestId

Server sets: id, businessId, avgCost (0 if gifted), inicial move, **not** cash.

Reject: stock>0 and avgCost<=0 and gifted≠true → `NEED_COST`.  
Reject: client `id`, `businessId`.

No PATCH stock. PATCH name/price/lowStockAt only.

### Customers
POST name, phone?. `Idempotency-Key` required (M6.0). Debt starts at 0. `code` (`DC-NNNN`) is assigned by the server, including archived, never reused. Client must not invent a code. Same requestId → same customer. Initial debt is a **separate** POST.
`GET /v1/customers/:id/ledger` → customer + initials + sales (with lines/returns) + payments.

### Suppliers
name, phone?, notes?. `Idempotency-Key` required (M6.0). Same requestId → same supplier. No CxP. `GET /v1/suppliers/:id/surtidas` → surtir history.

---

## 4. Sales + cash (first BC)

### Create sale
`POST /v1/sales`  
Header: `Idempotency-Key` = requestId (required).

**CreateSaleDto**

```
lines: [{ productId, qty, unitPrice? }]
paymentKind: paid | partial | credit
customerId?: uuid   // required partial/credit
amountReceived: integer
method?: Efectivo | Nequi   // required if amountReceived > 0
note?:
```

Server computes: saleTotal, credit, line unitCost from **current** product.avgCost, stock decrement, cash_move if amountReceived>0, debt if credit>0, occurred_on.

**Forbidden in DTO:** businessId, unitCost, stock, customer.debt, saleTotal, credit.

Response: sale + lines. Repeat key → same sale, no extra stock/cash.

### List / get
`GET /v1/sales?from&to` (filter `occurred_on`)  
`GET /v1/sales/:id`

No PATCH/DELETE.

### Payments
`POST /v1/customers/:id/payments`  
Dto: amount, method, requestId. Server: **reject** if amount > current debt (`ABONO_EXCEEDS_DEBT`). Do not clamp. cash_move kind=`debt_collect`.

### Cash sessions
`POST /v1/cash/sessions` Dto: `{ openingFloat }` → unique day, second call returns existing.  
`POST /v1/cash/sessions/:id/close` Dto: `{ countedEfectivo }` → snapshot expected, difference.  
`GET /v1/cash/today` → session + expected buckets (Efectivo vs Nequi).

### Cash moves (read)
`GET /v1/cash/moves?date=` or `?from&to` (`occurred_on`).

### Aporte / retiro (when cash module expands)
`POST /v1/cash/aportes` `{ amount, method, requestId }`  
`POST /v1/cash/retiros` same.  
Kinds on cash_moves, not new tables. UI today requires an open session; keep that.

---

## 5. Inventory (after first BC)

`POST /v1/products/:id/surtir` qty, unitCost, totalCost, method, supplierId?, requestId. Today only (`occurred_on` = today). Cash `compra` if total>0. Reweights avg_cost.

`POST /v1/products/:id/shrink` reason: me_lo_comi \| regalar \| perdido, qty, note, requestId.

No `adjust` endpoint. No client `createdAt` in the past (Dexie tests only).

---

## 6. Returns

`POST /v1/sales/:id/returns`  
Dto: `{ lines: [{ saleLineId, qty }], requestId, note? }`  
Server: remaining qty, snapshots from the **sale line** (not current catalog), `splitReturnSettlement` from DOMAIN (fiada of **this** sale first, never below `customer.debt`, remainder is cash refund on the original sale method). stock_move `devolucion` does **not** reweight avg_cost. cash_move if refund>0. Original sale untouched. Hits **today’s** `occurred_on`, not the sale’s day.

---

## 7. Initial debt

`POST /v1/customers/:id/initial-debts` `{ amount, note?, requestId }`  
No cash, no stock, no sale. Increases debt. Skips closed-day lock (carga inicial).

The $45.200 live debts (dump `544b330b-…`, owner-confirmed) are rows here after import — never POST them as sales. Do not round to 45000.

---

## 8. Expenses

`POST /v1/expenses` `{ amount, category, method, note?, requestId }`  
Txn: expense + cash_move kind=expense.

`GET /v1/expenses?from&to`

---

## 9. Stats (M3)

`GET /v1/stats?period=hoy|semana|mes`  
Computed in **business timezone** on `occurred_on`. Formulas = DOMAIN.md §16.  
Ventas brutas; Devoluciones separate; Ganancia = sale margins − return margins; Por cobrar = Σ debt now (includes initial debts); Gasté = expenses; Invertí = cash_moves compra; Recibido does not subtract refunds.

No extra BI. The PWA stats page reads this endpoint.

---

## 10. Who may call what (owner vs staff)

| | staff | owner |
|--|-------|-------|
| sales, payments, inventory, returns, expenses, open/close caja | yes | yes |
| initial debt | yes | yes |
| archive product/customer | no | yes |
| memberships, wipe, import | no | yes |

---

## 11. DTO trust boundary

| Client | Server |
|--------|--------|
| qty, unitPrice override, paymentKind, method, amountReceived, gifted flag, countedEfectivo, openingFloat, **stock + avgCost only on product create** | unitCost on sale/return, live stock, debt, avgCost after surtir, occurred_on, businessId, expected buckets, difference, return split |

---

## 12. Idempotency header

All economic POST (and `POST /v1/products`): header `Idempotency-Key: <uuid>` required.

If the body also has `requestId`, it **must equal** the header or the call is `400 VALIDATION`.

Stored on the owning row (`sales.request_id`, `customer_payments.request_id`, `initial_debts.request_id`, `expenses.request_id`, `stock_moves.request_id`, `sale_returns.request_id`, `cash_moves.request_id` for aporte/retiro). Unique per business. Kept forever.

Dexie `product.create` has **no** requestId today. The API still requires the header. Do not change Dexie in this phase.
