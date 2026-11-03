# Hallazgos QA — Auditoría profunda DulceCalle (main 6f8f5ff, 2026-11-03)

Formato del BRIEF. "Demostrado" = reproducido con ejecución real en este entorno local.

---
## F-01 · Compras fiadas/parciales siguen mostrándose “A crédito / Quedó a crédito $X” después de pagar toda la deuda
- **Severidad:** ALTA · **Categoría:** Inconsistencia de datos / Problema UX (riesgo financiero de disputa) · **Prioridad:** P1 · **Estado:** demostrado
- **Descripción:** Un abono (`customer_payments`) sólo descuenta `customers.debt`; nunca se aplica a una venta (`sale_id` siempre null) y `sales.credit` es inmutable. Las vistas por compra muestran `sale.credit` como deuda de esa compra para siempre. El cliente que pagó un producto comprado antes ve esa compra “A CRÉDITO $3.000 · Quedó a crédito $3.000” (en rojo) aunque su saldo sea $0.
- **Pasos (reproducido):** `scripts/r1-portal-setup.mjs` → producto 3000, cliente Rosa, fiada 3000, abono 3000 Efectivo (deuda 3000→0), PIN; `scripts/r1-portal-browser.cjs` login portal → `/cliente`, `/cliente/compras`, `/cliente/compras/<id>`; `scripts/r1-owner-browser.cjs` vista dueño.
- **Esperado:** compra marcada pagada/saldada (o al menos sin indicar deuda pendiente).
- **Obtenido:** Inicio portal: “AL DÍA $0”. Compras: “03/11/2026 · A crédito · $3.000”. Detalle: “A CRÉDITO $3.000 · Pagaste $0 · Quedó a crédito $3.000” (tono danger). Dueño `/ventas/<id>`: “Fiada · Recibido $0 · Fiado $3.000”, mientras `/clientes` dice “Al día”. API ledger tras pago total (escenario R1): ventas con `credit` 4000 y 3000, `payments[].saleId = null`.
- **Evidencia:** `logs/r1-portal-compra-detalle.png`, `logs/r1-portal-compras.png`, `logs/r1-portal-browser.log`, `logs/r1-owner-browser.log`, `logs/scenarios-run2.log` (R1), `logs/r1-portal-setup.log`.
- **Archivos / causa raíz:** `src/components/customer/portal.ts:53-61` (`purchaseLabel/purchaseTone` usan sólo `sale.credit`); `src/app/cliente/compras/[id]/page.tsx:61-72`; `src/app/cliente/compras/page.tsx:58`; `src/app/ventas/[id]/page.tsx:159`; `backend/src/cash/cash.service.ts:378-390` (pago creado sin `saleId`); `backend/prisma/schema.prisma` `CustomerPayment.saleId` nunca escrito; `backend/src/customer-access/customer-access.service.ts` `publicCustomerLedger` expone `credit` sin saldo por venta.
- **Consecuencias:** exactamente el caso real (“pagó y la app sigue mostrando la deuda” de esa compra). Discusión con cliente; el dueño puede cobrar dos veces si mira la venta y no el saldo.
- **Solución propuesta:** calcular saldo por venta (asignación FIFO de abonos/devoluciones a obligaciones, como ya hace `buildDebtStatement` en running balance) y mostrar “Saldada / Pendiente $X”; o mostrar sólo “Se fió $X el día…” sin tono de deuda. **Riesgos:** la asignación FIFO es una convención: documentarla y mostrarla igual en portal y tienda.

## F-02 · Abono pendiente (offline/cola) se descarta en silencio si la caja del día se cerró antes de sincronizar → la deuda “reaparece” aunque el cliente pagó
- **Severidad:** CRÍTICA · **Categoría:** Riesgo financiero / Bug · **Prioridad:** P0 · **Estado:** demostrado (servidor real + capa cliente con fake-indexeddb y API simulada)
- **Pasos:** (a) API real: día cerrado → `POST /customers/:id/payments` = **409 CLOSED_DAY** (`logs/r-dayclosed.log`); `initial-debts` en cambio sigue aceptando (201). (b) Cliente: abono offline 20000 sobre deuda 50000 (local 30000) → sync recibe 409 CLOSED_DAY → `isPermanentDebtRejection` → `revertOptimisticPayment`.
- **Esperado:** el dinero recibido no puede desaparecer; la operación debería quedar pendiente de decisión/reasignación a otra caja, o el servidor aceptarla en la caja siguiente.
- **Obtenido:** deuda local vuelve a 50000, op `failed` con `nextAttemptAt=null` (no reintenta), cash move `debt_collect` borrado, estado de cuenta sin el abono (`logs/fe-vitest-qa-repro.log`, test R2).
- **Cómo se llega en la vida real:** el cierre de caja en línea (`src/data/pwa/offline-operations.ts:296-298`) llama `cash.close` directamente sin vaciar el outbox ni avisar de abonos pendientes; también otro dispositivo puede cerrar la caja. Ej.: cobro con señal mala → abono queda en cola; luego se cierra la caja con señal → el abono sincroniza después → 409 → revertido.
- **Archivos:** `src/data/pwa/pending-debt.ts:15-24` (409 = rechazo permanente); `src/data/pwa/offline-payments.ts:177-199,258-260`; `backend/src/cash/cash.service.ts:369-373` (day-guard en abonos); `backend/src/shared/day-guard.ts`.
- **Consecuencias:** cliente pagó, app muestra deuda, efectivo en el cajón sin registro (descuadre +X en el cierre). Sólo queda rastro en la bandeja de sincronización como fallo.
- **Solución:** antes de cerrar caja, sincronizar/bloquear con pendientes; en servidor, aceptar abonos de día cerrado asignándolos a caja pendiente (ya existe `pendingForSessionId`) en vez de 409; nunca revertir un cobro sin confirmación explícita del dueño. **Riesgos:** cambia reglas de cierre; requiere conciliación.

## F-03 · Idempotency-Key reutilizada con cuerpo distinto devuelve 2xx con la operación vieja (sin detectar conflicto)
- **Severidad:** ALTA · **Categoría:** Riesgo financiero / Error de lógica · **Prioridad:** P1 · **Estado:** demostrado
- **Pasos:** S17c: key de un abono de C1 (500) reutilizada para abono de C2 (1000 Nequi) → **201** con `customerId` de C1 y monto 500; deuda C2 sigue 1000. S17d: key de venta usada para otra venta (3× producto, fiada a C2) → **201** con la venta vieja (total 1000).
- **Esperado:** 409/422 “key reutilizada con otro contenido”.
- **Evidencia:** `logs/scenarios-run2.log` S17c/S17d.
- **Archivos:** `backend/src/cash/cash.service.ts:344-357` y `:430-444`; `backend/src/sales/sales.service.ts:103-107`, `:296-309`, `:371-375` (búsqueda sólo por `businessId+requestId`, sin comparar cliente/monto/líneas). Igual patrón en gastos/movimientos (`cash.service.ts:482-485, 566-569`).
- **Consecuencias:** si un cliente (bug de UI, reuso de requestId tras restaurar borrador, retry con payload editado) reutiliza la key, la UI recibe “éxito” pero el abono de C2 nunca se registra → “pagó y sigue debiendo”. **Probabilidad:** no demostrada en la UI actual (genera UUID nuevo por operación) → hipótesis para el caso real, defecto demostrado en API.
- **Solución:** guardar hash del cuerpo con la key y responder 409 si difiere; validar al menos customerId/amount. **Riesgos:** bajos.

## F-04 · Limpieza de rechazos offline sobrestima la deuda local (clamp a 0 + reversión posterior)
- **Severidad:** MEDIA · **Categoría:** Bug / Inconsistencia de datos · **Prioridad:** P2 · **Estado:** demostrado (vitest, Dexie fake)
- **Pasos:** deuda 50000; offline fiada 6000 (56000) y abono 56000 (0); sync: venta 409 INSUFFICIENT_STOCK, abono 409 ABONO_EXCEEDS_DEBT.
- **Esperado:** deuda local 50000. **Obtenido:** **56000** (`logs/fe-vitest-qa-repro.log` R3).
- **Causa raíz:** `src/data/local/outbox-cleanup.ts:89-92` revierte la venta con `next < 0 ? 0 : next` (pierde 6000 al estar la deuda local en 0) y luego `offline-payments.ts:177-187` suma 56000.
- **Consecuencias:** el dispositivo muestra deuda mayor que la real hasta que un refresco del servidor la sobrescriba; además el abono de 56000 (dinero recibido) queda rechazado (ver F-02: dinero cobrado sin registro).
- **Solución:** revertir por deltas sin clamp intermedio (o recomputar desde servidor + pendientes). 

## F-05 · Dinero cobrado en una operación rechazada no tiene destino (abono rechazado ⇒ efectivo sin registro)
- **Severidad:** ALTA · **Categoría:** Riesgo financiero / Falta de funcionalidad · **Prioridad:** P1 · **Estado:** probable (deriva de F-02/F-04 demostrados)
- Cualquier rechazo permanente (400/403/404/409/422) de un abono borra su cash move local y la deuda vuelve; no existe flujo de “cobro recibido pendiente de aplicar” ni reasignación. `pending-debt.ts:15-24`, `offline-payments.ts:258`. Solución: estado “recibido sin aplicar” visible en caja y cliente.

## F-06 · No existe anulación de venta; sólo devolución
- **Severidad:** MEDIA · **Categoría:** Falta de funcionalidad · **Prioridad:** P3 · **Estado:** demostrado (S9: DELETE/POST cancel/PATCH → 404)
- Venta equivocada se corrige con devolución total (S8 OK, conserva historial y reembolsa). Riesgo: una venta equivocada pagada en Nequi se “reembolsa” como salida Nequi aunque nunca existió dinero; no hay motivo “error de registro” separado de “devolución”.

## F-07 · Cerrar la caja bloquea todo registro del resto del día (ventas y abonos), pero no las deudas iniciales
- **Severidad:** MEDIA · **Categoría:** Error de lógica / UX · **Prioridad:** P2 · **Estado:** demostrado (S13d venta 409; abono 409 CLOSED_DAY; initial-debt 201 — `logs/r-dayclosed.log`)
- Inconsistencia: una deuda puede crecer en día cerrado pero no bajar. Combinado con F-02 es la ruta más directa al caso real. `backend/src/shared/day-guard.ts:22` (exención documentada para deudas iniciales).

## Observaciones sin hallazgo (verificadas)
- Invariantes I1–I5 se mantuvieron en todos los escenarios API (0 desajustes stored vs computed en `customers.debt`, stock, caja).
- Concurrencia: dos abonos paralelos por la deuda total → 201/409 (guard `debt >= amount` atómico, `cash.service.ts:392-399`); dos ventas del último stock → 201/409.
- Doble tap mismo key (5 ventas / 3 abonos paralelos) → 1 fila.
- Nequi excluido del efectivo esperado; diferencia = contado − esperado; cierre duplicado 409.
