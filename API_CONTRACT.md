# DulceCalle — API contract

Conceptual REST `/v1`. **Do not implement endpoints in this phase.**
Auth: Bearer or httpOnly cookie. `businessId` comes from membership, not from the body.

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
| 403 | `FORBIDDEN` | no membership / wrong role |
| 404 | `NOT_FOUND` | missing in **this** business |
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
| POST | `/v1/auth/login` | no | |
| POST | `/v1/auth/logout` | yes | |
| GET | `/v1/me` | yes | user + memberships |
| GET | `/v1/businesses` | yes | memberships only |
| POST | `/v1/businesses` | yes | new business, caller = owner |
| GET | `/v1/health` | no | |

Selector: header `X-Business-Id` must be a membership of the user.

---

## 3. Catalog

### Products
| Method | Path | Idempotent | Notes |
|--------|------|------------|-------|
| GET | `/v1/products` | | |
| GET | `/v1/products/:id` | | |
| POST | `/v1/products` | requestId | create; may include opening stock |

**CreateProductDto** (client may send):

- name, price, stock?, avgCost?, lowStockAt?, **gifted?**, requestId

Server sets: id, businessId, avgCost (0 if gifted), inicial move, **not** cash.

Reject: stock>0 and avgCost<=0 and gifted≠true → `NEED_COST`.  
Reject: client `id`, `businessId`.

No PATCH stock. PATCH name/price/lowStockAt only.

### Customers
POST name, phone?. Debt starts at 0. Initial debt is a **separate** POST.

### Suppliers
name, phone?, notes?. No CxP.

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
Dto: amount, method, requestId. Server: clamp to debt, cash_move kind=debt_collect.

### Cash sessions
`POST /v1/cash/sessions` Dto: `{ openingFloat }` → unique day, second call returns existing.  
`POST /v1/cash/sessions/:id/close` Dto: `{ countedEfectivo }` → snapshot expected, difference.  
`GET /v1/cash/today` → session + expected buckets (Efectivo vs Nequi).

### Cash moves (read)
`GET /v1/cash/moves?date=`

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
Server: remaining qty, snapshots from sale line, split debt vs refund (DOMAIN return rules), stock_move devolucion (does **not** reweight avg_cost), cash_move if refund>0. Original sale untouched.

---

## 7. Initial debt

`POST /v1/customers/:id/initial-debts` `{ amount, note?, requestId }`  
No cash, no stock, no sale. Increases debt. Skips closed-day lock (carga inicial).

The $45.000 live debts are rows here after import — never POST them as sales.

---

## 8. Expenses

`POST /v1/expenses` `{ amount, category, method, note?, requestId }`  
Txn: expense + cash_move kind=expense.

---

## 9. Stats

`GET /v1/stats?period=hoy|semana|mes`  
Computed in **business timezone**. Formulas = DOMAIN.md §16.  
Ventas brutas; Devoluciones separate; Ganancia = sale margins − return margins; Por cobrar = Σ debt now (includes initial debts); Gasté = expenses; Invertí = cash_moves compra; Recibido does not subtract refunds.

No extra BI.

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
| qty, unitPrice override, paymentKind, method, amountReceived, gifted flag, countedEfectivo, openingFloat | unitCost, stock, debt, avgCost after surtir, occurred_on, businessId, expected buckets, difference, return split |

---

## 12. Idempotency header

All economic POST: `Idempotency-Key: <uuid>`.  
Stored on the **owning** row (`sales.request_id`, etc.). Unique per business. Forever (needed for sync later).
