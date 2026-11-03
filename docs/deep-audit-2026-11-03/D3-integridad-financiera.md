# D3 — Integridad financiera (DulceCalle)
- **SHA auditado:** `6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c` (main; merge PR #41, 2026-10-26 16:30 UTC-5). Clon: `/workspace/deep-audit/dev/dulcecalle`.
- **Modo:** solo lectura. No se tocó Neon ni Render. Pruebas en Postgres embebido local y fake-indexeddb.
- **Hallazgos:** ver `findings-dev.md` (D3-F01…F12). Evidencia: `evidence-dev/`.
- Convención: **HECHO DEMOSTRADO** (código + test ejecutado), **RIESGO** (mecanismo demostrado, ocurrencia no), **HIPÓTESIS**.

## 1. Arquitectura del dinero (resumen)
FE página → store (`src/store/`) → `*WithOfflineFallback` (intenta HTTP; si `NetworkError` aplica optimista en Dexie + outbox) → `getPwaApi()` con `Idempotency-Key` → controlador Nest → servicio → `prisma.$transaction` con `pg_advisory_xact_lock(hashtext(businessId))` + `SELECT … FOR UPDATE` de `cash_sessions` del día (`backend/src/shared/day-guard.ts:39-55`) → tablas.
- Moneda: COP entero en `BigInt` (servidor, `shared/money.ts`), `number` entero en FE; tope 100.000.000 por monto (`money.ts:9`), `copToJson` lanza si no es safe integer. Sin decimales ⇒ **no hay errores de redondeo** (HECHO por código).
- Fecha: `occurredOn` la calcula **el servidor** con la zona del negocio al recibir la petición (`shared/clock.ts`), no la del hecho offline (D3-F05).

## 2. Reconstrucción por flujo
| Flujo | Endpoint / servicio | Tablas escritas (en una TX) | Day-guard / lock | Idempotencia |
|---|---|---|---|---|
| Venta pagada | `POST /v1/sales` · `sales.service.ts:102-320` | sales, sale_lines, products.stock (UPDATE con `stock >= qty`), stock_moves(sale), cash_moves(in, sale, Efectivo/Nequi) | sí (assert + lock) | `sales(business_id, request_id)` único; búsqueda previa + P2002 |
| Venta parcial | ídem; `assertPaymentMath` exige 0<recibido<total (`sale-math.ts:4-40`) | + customers.debt += credit (`sales.service.ts:296-300`) | sí | ídem |
| Venta fiada | ídem; recibido=0 | customers.debt += total | sí | ídem |
| Deuda previa + nueva compra | igual que fiada/parcial: `increment` atómico sobre saldo global | — | sí | — |
| Abono | `POST /v1/customers/:id/payments` · `cash.service.ts:338-457` | customer_payments, customers.debt −= monto (UPDATE con `debt >= monto`, si no 409 ABONO_EXCEEDS_DEBT), cash_moves(in, debt_collect) | sí | `customer_payments(business_id,request_id)`; cash_moves también con request_id |
| Pago total | abono = debt (botón "Todo"); no hay operación distinta | — | — | — |
| Deuda inicial | `POST /v1/customers/:id/initial-debts` · `catalog.service.ts:670-720` | initial_debts, customers.debt += | **no** (exento) | único por request_id |
| Devolución | `POST /v1/sales/:id/returns` · `sales.service.ts:364-585` | sale_returns(+lines), products.stock +=, stock_moves(devolucion), cash_moves(out, devolucion) si reembolso, customers.debt −= debt_reduced (con guarda ≥) | sí | único por request_id |
| Cancelación / venta equivocada | **No existe.** Solo devolución total/parcial (stock y deuda/reembolso), sujeta a día abierto | — | — | — |
| Consumo propio | `POST /v1/products/:id/shrink` reason `me_lo_comi/regalar/perdido` (`catalog.dto.ts:198`) | stock_moves(−), products.stock; sin dinero | sí | request_id |
| Surtido | `POST /v1/products/:id/surtir` · `shared/inventory.ts` promedio ponderado; combos/insumos guardan valor de lote en avgCost | stock_moves(+), products.stock/avgCost, cash_moves(out) | sí | request_id |
| Gasto | `POST /v1/expenses` · `cash.service.ts:477-557` | expenses, cash_moves(out) | sí | `expenses.request_id` |
| Aporte/Retiro | `POST /v1/cash/aportes|retiros` · `cash.service.ts:559-620` | cash_moves | sí | `cash_moves.request_id` |
| Apertura | `POST /v1/cash/sessions` · `cash.service.ts:135-188` | cash_sessions (una por día, índice de "una abierta") | lock | request_id; mismo día devuelve la existente |
| Cierre | `POST /v1/cash/sessions/:id/close` · `cash.service.ts:190-242` | cash_sessions (expected*, difference, close_request_id) | lock | close_request_id único; otro request ⇒ 409 SESSION_ALREADY_CLOSED |
| Carry / asignar | `cash-manager.service.ts:190-371` | cash_sessions, cash_moves.session_id | lock | request_id |

Offline (FE): `offline-sales.ts`, `offline-payments.ts`, `offline-returns.ts`, `offline-initial-debt.ts`, `offline-operations.ts`, `offline-production.ts` aplican efectos optimistas en Dexie y encolan en `outbox` con el mismo `requestId`; el replay usa esa clave ⇒ un timeout con commit real se resuelve devolviendo la fila existente (HECHO por código y e2e I4).

## 3. Escritores de `customer.debt`
### Backend (Postgres)
| # | Archivo:línea | Operación | ¿Movimiento asociado en la misma TX? |
|---|---|---|---|
| B1 | `catalog.service.ts:497` | alta de cliente, debt=0 | n/a |
| B2 | `catalog.service.ts:716-719` | `+= amount` deuda inicial | sí, initial_debts |
| B3 | `sales.service.ts:296-300` | `+= credit` venta parcial/fiada | sí, sales.credit |
| B4 | `sales.service.ts:553-563` | `−= debt_reduced` devolución (guarda ≥) | sí, sale_returns.debt_reduced |
| B5 | `cash.service.ts:392-404` | `−= amount` abono (guarda ≥, 409) | sí, customer_payments + cash_moves |
| B6 | `business-data.service.ts:151-181` | reset: borra clientes y todo el historial | borra ambos |
| B7 | `migration/importer.ts:192` | import CLI copia `debt` cacheado | **no** (solo warning `reconcile.ts:124-136`) |
| — | `PATCH customers/:id` | rechaza `debt` (`catalog.dto.ts:142-144`) | — |

### Frontend (Dexie)
| # | Archivo:línea | Qué hace |
|---|---|---|
| F1 | `offline-sales.ts:289` | venta offline: debt += credit |
| F2 | `offline-sales.ts:516`, `:600` | revert / re-apply de venta offline |
| F3 | `offline-payments.ts:88-92` | abono offline: debt −= monto |
| F4 | `offline-payments.ts:185-189` | revert en rechazo (debt += monto) |
| F5 | `offline-payments.ts:209-212` | re-apply con piso 0 |
| F6 | `offline-returns.ts:264`, `:444`, `:505` | devolución offline / revert / re-apply |
| F7 | `offline-initial-debt.ts:105`, `:173`, `:212` | deuda inicial offline y conciliación |
| F8 | `outbox-cleanup.ts:90`, `:134`, `:159`, `:179` | `cleanupOutboxLocalEffect` (venta, abono, deuda inicial, devolución) en reject/discard |
| F9 | `read-cache.ts:162-164`, `:210-212` + `:400-407` | refresco: snapshot servidor + `pendingDebtAdjustment` |
| F10 | `offline-history.ts:139` | warmLedgerHistory: servidor + pendiente |
| F11 | `offline-catalog.ts:94`, `:367`, `:662-674` | alta/conciliación/patch de cliente |
| F12 | `src/repositories/*` (`saleRepository.ts:235,463`, `customerRepository.ts:214,284`), `src/storage/seed.ts:92` | **legado Dexie**, no cableado a páginas (`src/data/backend.ts:3-5`, `pwaStorage()` = "http") |

## 4. Invariantes
Fórmula real de reconstrucción (verificada contra `migration/reconcile.ts:124-130` y escritores B2-B5):
`debt = Σ initial_debts.amount + Σ sales.credit − Σ customer_payments.amount − Σ sale_returns.debt_reduced`

| Invariante | Veredicto | Evidencia |
|---|---|---|
| total venta = Σ líneas | **demostrado OK** (servidor recalcula con precio de catálogo o override entero ≥0) | `sales.service.ts:155-200`; tests existentes `fase-m*` pasan |
| saldo venta = total − pagos aplicados | **no representable** (abonos no se ligan a ventas) | D3-F04 |
| saldo cliente = Σ obligaciones pendientes | **demostrado OK en servidor** para el caso mixto (deuda inicial, fiada, parcial, abono, devolución, sobre-abono rechazado, concurrencia) | e2e `demo-d3-e2e.log` I1/I3: debt 5500 = recon 5500 |
| saldo cliente en el dispositivo = servidor | **demostrado roto (transitorio)** | D3-F02 test A/B |
| pago recibido = movimiento financiero | **OK en servidor** (customer_payment + cash_move debt_collect misma TX); **roto en FE ante rechazo** (efectivo recibido sin registro) | e2e I4 (1 pago/1 cash move); D3-F01 |
| deuda reducida = importe aplicado | **OK** (UPDATE con guarda; si no alcanza ⇒ 409, nunca recorte silencioso en servidor). En FE re-apply con piso 0 (F12) | e2e overpay 409 |
| inventario final = inicial + entradas − salidas | **riesgo / no verificado e2e**: stock_moves por venta, devolución, surtir, shrink, preparación; alta de producto con `stock` inicial (verificar en D2/D5). Venta nunca deja stock negativo (`stock >= qty`) | `sales.service.ts:241-255` |

## 5. CASO REAL — "el cliente dice que pagó, la app sigue mostrando la deuda"
No se presupone causa. Ranking por evidencia (sin datos de producción):

| # | Causa | Mecanismo / archivo | ¿Reproducido? | Probabilidad |
|---|---|---|---|---|
| 1 | **Abono offline rechazado y revertido** (CLOSED_DAY porque se sincroniza tras cerrar el día; ABONO_EXCEEDS_DEBT si otro dispositivo redujo la deuda) | D3-F01: `offline-payments.ts:257-260`, `outbox-cleanup.ts:126-149`, `cash.service.ts:367-404` | **Sí** (test local revert + e2e 409) | Alta si se usa offline/cierre de día |
| 2 | **Abono nunca registrado** (el dueño recibió el dinero pero no completó el formulario: botón deshabilitado por "cliente en sincronización", monto > saldo local, error y abandono; o se cobró dentro de una venta pagada en vez de abono) | `abono/page.tsx:85-107,190-219`; `offline-payments.ts:23-33,65-71` | Por código | Media (no medible sin entrevista/datos) |
| 3 | **Abono pendiente descartado** en la bandeja de sync | D3-F07 | Test existente | Media-baja |
| 4 | **Caché/lista desactualizada** (carrera de proyección o detalle sin `useAfterSync`; portal del cliente lee servidor, dueño lee Dexie ⇒ vistas distintas) | D3-F02 | **Sí** (test) | Media-baja, transitoria |
| 5 | **Abono a otro cliente** (homónimos; no hay reverso, D3-F06) | modelo | No (por diseño posible) | Media-baja |
| 6 | **"Pagué ese producto" pero el sistema solo tiene saldo global** — el abono existe y redujo el saldo, pero otra venta fiada posterior mantiene saldo > 0; el cliente interpreta deuda por el producto pagado | D3-F04 | Por diseño | Media |
| 7 | Op encolada nunca sincronizada (dispositivo sin conexión, sesión expirada 401: queda pendiente con efecto visible solo en ese dispositivo) | `pending-debt.ts:26-30` | Código | Baja-media |
| 8 | Idempotencia reutilizada con otro payload | D3-F03 | **Sí** (e2e I2) | Baja con FE actual |
| 9 | Duplicados por doble tap/reintento | requestId + advisory lock | **Descartado** (e2e I4: 1 pago, 1 cash move) | Muy baja |
| 10 | Concurrencia dos dispositivos | advisory lock + guarda | **Descartado** como corrupción (e2e I3: 201/409, invariante OK) | Muy baja |
| 11 | Redondeo/BigInt | enteros COP, `copToJson` safe | Descartado por código | Muy baja |
| 12 | remap localId→serverId | abono bloqueado si el cliente no está sincronizado (`offline-payments.ts:65-71`); remap de payloads `offline-catalog.ts:352-360` | Código | Baja |
| 13 | Recorte silencioso por sobre-abono | servidor rechaza (409), no recorta | e2e | Muy baja |
| 14 | Devolución reduce deuda vs reembolso | `returns.ts`: primero el fiado de esa venta | Código | Baja (confusión de interpretación) |

### SQL de detección (solo lectura; para que Juan/DevOps lo ejecute luego; NO ejecutado en Neon)
```sql
-- (a) Caché vs reconstrucción por cliente (solo filas que no cuadran)
SELECT * FROM (
  SELECT c.id, c.code, c.name, c.debt,
    COALESCE((SELECT SUM(amount) FROM initial_debts d WHERE d.customer_id=c.id),0)
  + COALESCE((SELECT SUM(credit) FROM sales s WHERE s.customer_id=c.id),0)
  - COALESCE((SELECT SUM(amount) FROM customer_payments p WHERE p.customer_id=c.id),0)
  - COALESCE((SELECT SUM(r.debt_reduced) FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=c.id),0) AS reconstruida
  FROM customers c WHERE c.business_id = :biz
) x WHERE x.debt <> x.reconstruida;

-- (b) Historial cronológico del cliente reclamante
SELECT 'inicial' t, amount, NULL::text method, occurred_on, created_at FROM initial_debts WHERE customer_id=:cid
UNION ALL SELECT 'venta '||payment_kind, credit, method, occurred_on, created_at FROM sales WHERE customer_id=:cid
UNION ALL SELECT 'abono', -amount, method, occurred_on, created_at FROM customer_payments WHERE customer_id=:cid
UNION ALL SELECT 'devolucion', -r.debt_reduced, r.method, r.occurred_on, r.created_at FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=:cid
ORDER BY created_at;

-- (c) Abonos sin cash_move o cash_moves debt_collect sin abono (huérfanos)
SELECT p.id FROM customer_payments p LEFT JOIN cash_moves m ON m.ref_type='payment' AND m.ref_id=p.id WHERE p.business_id=:biz AND m.id IS NULL;
SELECT m.id FROM cash_moves m LEFT JOIN customer_payments p ON p.id=m.ref_id WHERE m.business_id=:biz AND m.kind='debt_collect' AND p.id IS NULL;

-- (d) Abonos con el mismo monto en ±2 días a otros clientes (¿cliente equivocado?)
SELECT p.*, c.name FROM customer_payments p JOIN customers c ON c.id=p.customer_id
WHERE p.business_id=:biz AND p.amount=:monto AND p.occurred_on BETWEEN :fecha::date-2 AND :fecha::date+2;

-- (e) Días cerrados con diferencia positiva (efectivo de más = posible abono revertido)
SELECT local_date, expected_efectivo, closing_count, difference FROM cash_sessions
WHERE business_id=:biz AND difference > 0 ORDER BY local_date DESC;

-- (f) Abonos registrados con fecha posterior a la real (sync tardío): created_at vs occurred_on
SELECT id, amount, occurred_on, created_at FROM customer_payments WHERE customer_id=:cid ORDER BY created_at;
```
Detección en el dispositivo del dueño (Dexie, no destructiva): revisar en la bandeja de sync ops `customerPayment:pay` con `status='failed'` y `nextAttemptAt=null` o `payload.optimisticApplied=false` (filas `customerPayments` locales que siguen existiendo tras un rechazo, test `demo-reject-revert.log`: "fila abono local existe: true").

## 6. Caja
- Esperado efectivo = `openingFloat + carriedEfectivo + Σ in Efectivo − Σ out Efectivo` (moves de la sesión o `pendingForSessionId` de ella) — `carry-rules.ts:66-81`. Nequi se acumula aparte y **no** entra en el efectivo esperado. Diferencia = contado − esperado efectivo (`cash.service.ts:227`).
- **Demostrado** (e2e C1): base 5000 + venta 2000 + abonos efectivo 2500+500+4000+100 = **14100**; Nequi 1000 separado; cierre contado 0 ⇒ difference −14100; segundo cierre con otra clave ⇒ **409 SESSION_ALREADY_CLOSED**; abono tras cierre ⇒ **409 CLOSED_DAY**.
- Moves fuera de sesión: `linkForNewMove` (`session-link.ts`) → misma fecha: sesión; una sola abierta de un día anterior: `pendingForSessionId` (y el cierre exige carry: `CARRY_REQUIRED`); si no hay ninguna abierta: `session_id NULL` ⇒ **"movimientos sin asignar"** (`GET cash/unassigned-moves`, `assign`). Riesgo: dinero cobrado sin caja abierta queda fuera de cualquier cierre hasta asignarlo manualmente.
- Una sola sesión abierta (índice + `PENDING_SESSION`) — tests existentes `cash-one-open-migration`, `cash-open-lock`.
- Diferencia ventas vs ingresos vs cobros: venta parcial/fiada no genera caja por el crédito; el abono es cobro (debt_collect) y no es venta; devolución genera salida solo por la parte reembolsada.

## 7. Matriz de idempotencia y concurrencia
| Operación | Único requestId | Mismo requestId, otro payload | Lock | Doble tap UI | Retry tras timeout con commit |
|---|---|---|---|---|---|
| Venta | sí | devuelve la original (sin validar) | advisory + FOR UPDATE | requestId en ref | OK (devuelve existente) |
| Abono | sí (+cash_moves) | **devuelve la original aunque sea otro cliente** (e2e I2) | sí | e2e I4: 1 fila | OK |
| Devolución | sí | original | sí | — | OK |
| Deuda inicial | sí | original | **no** | — | OK |
| Gasto / aporte / retiro | sí | original | sí | — | OK |
| Apertura | sí + un día | devuelve sesión del día | sí | — | OK |
| Cierre | close_request_id | otra clave ⇒ 409 | sí | — | OK |
Dos dispositivos con abonos por el total: uno 201, otro 409; el que recibe 409 offline **revierte** (F01).

## 8. Editabilidad y trazabilidad
- Ventas, líneas, abonos, devoluciones, deudas iniciales, gastos y cash moves: **sin PATCH/DELETE** en el API ⇒ historial append-only (bueno). `PATCH customers` rechaza debt.
- Excepciones: `DELETE /business/data` (reset total, B6); importador CLI (B7); Dexie local (descartar op borra la fila local, F07); edición SQL directa no auditada (sin triggers ni tabla de auditoría).
- Falta reverso/anulación (F06). El estado de cuenta es reconstruible desde movimientos (ledger sin límite: `catalog.service.ts:569-600`).

## 9. Diferencias FE vs BE
- Fecha: FE `todayLocal()` zona del dispositivo; BE zona del negocio y hora de sync (F05).
- `splitReturnSettlement` duplicado FE/BE (comentado como espejo, `returns.ts:12-15`) — no se verificó equivalencia exhaustiva (no verificado).
- Pisos a 0 en FE (F12) vs rechazo 409 en BE.
- Deuda visible: dueño = Dexie proyectado; portal cliente = servidor (`customer-access.service.ts`). Pueden diferir mientras haya ops pendientes o tras F02.

## 10. Pruebas ejecutadas
| Prueba | Estado inicial | Acción | Esperado | Obtenido | Evidencia | Estado |
|---|---|---|---|---|---|---|
| Suite FE | clon limpio, npm ci | `npx vitest run` | todo verde | 151 archivos, 947 tests pasados | `evidence-dev/vitest-root.log` | aprobado |
| Suite BE | PG embebido | `cd backend && npm test` | todo verde | 37 suites pasadas, 1 omitida; 270 pasados, 1 omitido (271) | `evidence-dev/backend-test.log` | aprobado |
| I1 invariante mixto | negocio nuevo, producto stock 100, caja base 5000 | deuda inicial 3000, fiada 5×1000, parcial 3×1000 (1000 Nequi), pagada 2000, abono 2500, devolución 2 uds de la fiada, sobre-abono 999999 | debt = reconstruida; sobre-abono 409 | debt 5500 = recon 5500; devolución debtReduced 2000 refund 0; overpay 409 ABONO_EXCEEDS_DEBT | `demo-d3-e2e.log` | aprobado |
| I2 clave reutilizada | Beto con deuda 4000 | abono Ana 500 con clave K; abono Beto 4000 con K | 422/409 por mismatch | 201 con abono de Ana; Beto sigue 4000 | `demo-d3-e2e.log` | fallido (hallazgo F03) |
| I3 concurrencia | Beto 4000 | 2 abonos simultáneos de 4000 | uno 201, otro 409, invariante OK | 201 / 409; invariante OK | `demo-d3-e2e.log` | aprobado |
| I4 doble tap | Ana con saldo | 2 POST simultáneos misma clave | 1 pago, 1 cash move | 1 / 1; mismo id | `demo-d3-e2e.log` | aprobado |
| C1 caja | sesión abierta | today, cierre, cierre 2, abono | Nequi fuera; 409; CLOSED_DAY | efectivo 14100 nequi 1000; 409 SESSION_ALREADY_CLOSED; 409 CLOSED_DAY | `demo-d3-e2e.log` | aprobado |
| R1 revert por rechazo | Dexie: deuda 6000 tras abono offline 4000 | `cleanupOutboxLocalEffect(reject)` | (comportamiento actual) | deuda 10000, cashMoves 0, fila abono existe | `demo-reject-revert.log` | aprobado (demuestra F01) |
| R2 carrera A | op in_flight, Dexie 6000 | lista: snapshot 10000, op→synced antes de proyectar | 6000 | 10000 | `demo-race-readcache.log` | fallido (F02) |
| R3 carrera B | op in_flight | snapshot ya con abono (6000) | 6000 | 2000 | `demo-race-readcache.log` | fallido (F02) |
| Inventario e2e (inicial+entradas−salidas) | — | — | — | — | — | no ejecutado |

Tests temporales (no commiteados, copiados a `evidence-dev/tests/`): `backend/test/zz-audit-d3.e2e-spec.ts`, `src/data/local/zz-audit-d3-race.test.ts`, `src/data/local/zz-audit-d3-reject.test.ts`.

## 11. Limitaciones
- Sin acceso a datos de producción: la causa del caso real es un ranking por mecanismo, no un diagnóstico.
- No se probó E2E de navegador (Playwright) del flujo offline completo con service worker; se probaron las funciones reales con fake-indexeddb.
- Invariante de inventario y equivalencia FE/BE de `splitReturnSettlement` no verificadas con test propio.
- Revisión de `offline-sales.ts`/`offline-returns.ts` en detalle limitada a los escritores de deuda.
