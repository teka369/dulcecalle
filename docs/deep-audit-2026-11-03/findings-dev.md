# Hallazgos D3 — Integridad financiera (rol dev)
SHA auditado: `6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c` (main, 2026-10-26 16:30 UTC-5). Evidencia en `evidence-dev/`.

---
## D3-F01 · Abono offline rechazado (409 CLOSED_DAY / ABONO_EXCEEDS_DEBT / 400/403/404/422) se revierte localmente: la deuda reaparece y el efectivo recibido deja de existir en el registro
- **Severidad:** CRÍTICA · **Categoría:** Riesgo financiero
- **Descripción:** Un abono registrado sin conexión aplica optimísticamente `debt − monto` y un `cash_move debt_collect` en Dexie. Al sincronizar, cualquier 400/403/404/409/422 se considera rechazo permanente y se revierte: la deuda vuelve a subir y se borra el movimiento de caja local. El dinero físico ya se recibió, pero el sistema vuelve a mostrar la deuda y no hay ningún registro en servidor del pago. La causa más común del 409 es que el servidor fecha la operación con su hora actual (no la del registro offline) y ese día ya está cerrado, o que el saldo del servidor es menor que el local (otra devolución/abono en otro dispositivo).
- **Evidencia:** `src/data/pwa/offline-payments.ts:88-108` (aplicación optimista), `:257-260` (revert en rechazo), `:177-198` (revertOptimisticPayment: `debt + amount`, borra cashMoves); `src/data/pwa/pending-debt.ts:15-24` (409 = permanente); `src/data/local/outbox-cleanup.ts:126-149`; `backend/src/cash/cash.service.ts:367-369` (occurredOn = ahora del servidor), `:392-404` (409 si debt < amount); `backend/src/shared/errors.ts:32,42` (CLOSED_DAY y ABONO_EXCEEDS_DEBT = 409). Test demo `evidence-dev/demo-reject-revert.log`: "deuda tras rechazo: 10000 cashMoves: 0 fila abono local existe: true". e2e `demo-d3-e2e.log` C1: abono tras cierre → `409 CLOSED_DAY`.
- **Archivos:** offline-payments.ts, pending-debt.ts, outbox-cleanup.ts, cash.service.ts, day-guard.ts
- **Flujo afectado:** abono offline; también ventas fiadas/parciales y devoluciones offline (mismo mecanismo).
- **Causa raíz:** demostrada a nivel de mecanismo: el servidor no acepta la fecha original del evento ni tiene un estado "pago recibido pendiente de aplicar"; el cliente trata el rechazo como "la operación nunca existió".
- **Consecuencias:** exactamente el síntoma del caso real ("pagué y sigue apareciendo la deuda"); descuadre de caja (efectivo de más sin explicación); disputa con el cliente sin evidencia en servidor.
- **Probabilidad:** probable cuando hay uso offline cruzando el cierre del día o dos dispositivos. No hay datos de producción para cuantificar.
- **Solución propuesta:** (1) enviar `occurredAt` del dispositivo y aplicar al día original o a un "pendiente de asignar" en vez de rechazar; (2) un abono rechazado nunca se borra: queda como "dinero recibido sin aplicar" visible y conciliable; (3) aviso bloqueante con monto/cliente al rechazar; (4) para ABONO_EXCEEDS_DEBT, registrar el excedente como saldo a favor.
- **Riesgos de la solución:** cambiar reglas de día cerrado afecta cierres ya conciliados; requiere migración y nuevo estado.
- **Prioridad:** P0 · **Estado de evidencia:** demostrado (mecanismo, test local); su ocurrencia en el caso real: probable/hipótesis.

## D3-F02 · Carrera entre refresco de lista de clientes y sync del abono: deuda vieja mostrada (abono invisible) o abono restado dos veces
- **Severidad:** ALTA · **Categoría:** Inconsistencia de datos
- **Descripción:** `CatalogReadCache.list` toma el snapshot del servidor y, después, suma `pendingDebtAdjustment` según el estado actual del outbox. Si el snapshot se leyó antes del commit y el op pasa a `synced` antes de proyectar, se guarda y muestra la deuda vieja (sin el abono). Si el snapshot ya incluye el abono pero el op sigue `in_flight`, se resta dos veces. El valor errado queda persistido en Dexie hasta el siguiente refresco. La página de detalle `/clientes/[id]` y la de abono no usan `useAfterSync` (solo lista, ventas, inventario, gastos, caja, inicio).
- **Evidencia:** `src/data/local/read-cache.ts:280-298`, `:400-407`; `src/data/pwa/pending-debt.ts:10-13,62-108`. Test demo `evidence-dev/demo-race-readcache.log`: "A deuda mostrada: 10000 deuda real servidor post-commit: 6000"; "B deuda mostrada: 2000 deuda real: 6000". `grep useAfterSync` → no aparece en `src/app/clientes/[id]/`.
- **Archivos:** read-cache.ts, pending-debt.ts, offline-history.ts:136-140 (mismo patrón en warmLedgerHistory), offline-catalog.ts:365-370.
- **Flujo afectado:** visualización de saldo tras abono/venta fiada sincronizada.
- **Causa raíz:** demostrada: la proyección no está ligada a la versión del snapshot (sin `version`/`updatedAt` del servidor ni lista de requestIds incluidos).
- **Consecuencias:** el dueño ve deuda que ya no existe (o una menor); transitorio pero persistente en dispositivo hasta otro refresco.
- **Probabilidad:** baja-media (ventana de milisegundos-segundos, más probable en red lenta, con varios ops en cola).
- **Solución propuesta:** que el servidor devuelva por cliente los requestIds aplicados o un `ledgerVersion`; proyectar solo ops no incluidos; refrescar detalle de cliente tras sync.
- **Riesgos de la solución:** bajo; requiere cambio de contrato.
- **Prioridad:** P1 · **Estado de evidencia:** demostrado (test unitario con la clase real); en producción: hipótesis.

## D3-F03 · Idempotencia no valida el payload: misma `Idempotency-Key` con otro cliente/monto devuelve 201 con el abono original
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero
- **Descripción:** Todos los escritores monetarios buscan por `(businessId, requestId)` y devuelven la fila existente sin comparar cliente, monto, método ni la ruta. Un cliente buggy que reutilice la clave (p.ej. el `requestIdRef` de la página de abono se conserva tras un error y se reutiliza si el usuario cambia el monto) recibe "éxito" para una operación que no se aplicó.
- **Evidencia:** `backend/src/cash/cash.service.ts:344-357`; `backend/src/sales/sales.service.ts:103-107,371-375`; `src/app/clientes/[id]/abono/page.tsx:112-119` (requestId persistente entre intentos). e2e I2 (`demo-d3-e2e.log`): segundo POST a Beto (4000 Nequi) con la clave del abono de Ana → `201` con `customerId` de Ana, monto 500; deuda de Beto sigue 4000.
- **Archivos:** cash.service.ts, sales.service.ts, catalog.service.ts (initial debt), abono/page.tsx
- **Flujo afectado:** abono, venta, devolución, deuda inicial, gasto, aportes/retiros.
- **Causa raíz:** demostrada (diseño).
- **Consecuencias:** UI muestra "Abono registrado" sin abono real en ese cliente → deuda sigue (contribuye al caso real solo si el FE reutiliza clave con payload distinto; hoy en el flujo normal el primer intento fallido no crea fila, por lo que el riesgo real es bajo).
- **Probabilidad:** baja con el FE actual.
- **Solución propuesta:** guardar hash del payload y responder 422 `IDEMPOTENCY_MISMATCH` si difiere; regenerar requestId si cambia el payload en UI.
- **Riesgos de la solución:** bajo.
- **Prioridad:** P2 · **Estado de evidencia:** demostrado.

## D3-F04 · Los abonos no se vinculan a ventas: no existe "saldo por venta"; el invariante "saldo venta = total − pagos aplicados" no es representable
- **Severidad:** ALTA · **Categoría:** Falta de funcionalidad
- **Descripción:** `customer_payments.sale_id` existe (opcional) pero el DTO del API no lo acepta y el FE escribe `saleId: null`. Los abonos reducen el saldo global del cliente. El estado de cuenta lista ventas fiadas con su `credit` original y abonos sueltos; no hay forma de decir "esta venta está pagada". Si el cliente dice "pagué el producto X", el sistema no puede mostrarlo ni refutarlo por venta.
- **Evidencia:** `backend/prisma/schema.prisma:426-443` (saleId opcional); `backend/src/catalog/catalog.dto.ts:108-124` (sin saleId); `backend/src/cash/cash.service.ts:378-389` (no se escribe saleId); `src/data/pwa/offline-payments.ts:81`; `src/data/pwa/statement.ts:46-94`.
- **Consecuencias:** disputas por "qué se pagó"; asignación FIFO implícita no explicitada; prueba débil ante el cliente.
- **Solución propuesta:** asignación explícita (o FIFO calculada y mostrada) de abonos a obligaciones; ver D4.
- **Riesgos de la solución:** migración de abonos históricos (asignar FIFO retroactivo).
- **Prioridad:** P1 · **Estado de evidencia:** demostrado.

## D3-F05 · Operaciones offline se fechan con la hora del servidor al sincronizar (no con la del hecho)
- **Severidad:** ALTA · **Categoría:** Error de lógica
- **Descripción:** Ventas, abonos, devoluciones y gastos sincronizados se registran con `occurredOn = now` del servidor. Un abono del lunes sincronizado el martes cae en la caja del martes (o es rechazado si el martes está cerrado — ver F01). El Dexie local usa `todayLocal()` con la zona del dispositivo, distinta potencialmente de la zona del negocio.
- **Evidencia:** `backend/src/sales/sales.service.ts:127-129,381-383`; `backend/src/cash/cash.service.ts:367-369`; `src/data/pwa/offline-payments.ts:35-38,47`.
- **Consecuencias:** cierres de caja descuadrados (efectivo en cajón del día A, registrado en día B), estado de cuenta con fechas distintas a las vividas.
- **Solución propuesta:** aceptar `clientOccurredAt` acotado; política explícita para días cerrados (pendiente de asignar).
- **Prioridad:** P1 · **Estado de evidencia:** demostrado (código).

## D3-F06 · No existe anulación/cancelación de venta ni reverso de abono, gasto o movimiento de caja
- **Severidad:** ALTA · **Categoría:** Falta de funcionalidad
- **Descripción:** No hay endpoints PATCH/DELETE ni "void" para ventas, abonos, gastos, deudas iniciales o cash moves (solo PATCH de producto/cliente/proveedor e imágenes; `PATCH customers` rechaza `debt`). Una venta equivocada solo se corrige con una devolución (que reintegra stock y reduce deuda/reembolsa). Un abono registrado al cliente equivocado o con monto equivocado NO tiene corrección posible salvo crear una "deuda inicial" compensatoria (sin vínculo al error). Los días cerrados bloquean incluso devoluciones.
- **Evidencia:** `grep @Delete|@Patch backend/src` → solo media, products, customers, suppliers, `DELETE business/data`. `backend/src/catalog/catalog.dto.ts:142-144`.
- **Consecuencias:** historial inmutable (bueno) pero correcciones sucias que rompen la trazabilidad semántica; abono al cliente equivocado = deuda que "sigue apareciendo" en el cliente correcto (causa candidata del caso real).
- **Solución propuesta:** movimientos de reverso (`payment_reversal`, `sale_void`) con motivo, enlazados al original, que respeten el día abierto.
- **Prioridad:** P1 · **Estado de evidencia:** demostrado.

## D3-F07 · Descartar un abono pendiente en la bandeja de sync lo elimina sin dejar rastro
- **Severidad:** MEDIA · **Categoría:** Problema UX / Riesgo financiero
- **Descripción:** `outbox.discard` llama `cleanupOutboxLocalEffect(..., "discard")` que revierte la deuda, borra el cash move y borra la fila `customerPayments`. Si el dinero sí se recibió, queda sin registro alguno.
- **Evidencia:** `src/data/local/outbox.ts:188-212`; `src/data/local/outbox-cleanup.ts:126-149`; test existente `r2a-a1-optimistic-revert.test.ts:109`.
- **Solución propuesta:** confirmación con monto/cliente y registro de auditoría local/servidor del descarte.
- **Prioridad:** P2 · **Estado de evidencia:** demostrado (código + test existente).

## D3-F08 · Reset de datos y migración/import escriben `customers.debt` sin movimientos
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero
- **Descripción:** `DELETE /business/data` borra ventas, abonos, deudas, caja y clientes (todo el historial) en una transacción. El importador CLI `migration/importer.ts:192` copia `debt` cacheado del dump; `migration/reconcile.ts:124-136` solo emite un warning `DEBT_MISMATCH` (no bloquea).
- **Evidencia:** `backend/src/business/business-data.service.ts:151-181`; `backend/migration/importer.ts:192`; `backend/migration/reconcile.ts:124-136`.
- **Consecuencias:** saldos importados no reconstruibles si el dump estaba inconsistente.
- **Solución propuesta:** importar como deuda inicial la diferencia o bloquear en mismatch; respaldo obligatorio antes de reset.
- **Prioridad:** P2 · **Estado de evidencia:** demostrado (código).

## D3-F09 · `customers.debt` es una caché sin verificación periódica; el estado de cuenta muestra `total = customer.debt` y el saldo corrido por separado sin compararlos
- **Severidad:** MEDIA · **Categoría:** Deuda técnica
- **Descripción:** Los escritores del servidor son atómicos y el invariante se cumplió en el e2e, pero no hay constraint/trigger ni job que compare caché vs reconstrucción. En `loadHttpStatement` el total es `customer.debt` y el último `runningBalance` se calcula aparte; si divergen (import, edición manual SQL) la UI muestra dos cifras inconsistentes sin alerta.
- **Evidencia:** `src/data/pwa/statement.ts:118-141`; no hay CHECK `debt >= 0` en schema (solo guardas en UPDATE: `cash.service.ts:396-398`, `sales.service.ts:559`).
- **Solución propuesta:** CHECK `debt >= 0`, verificación de invariante en un endpoint de salud financiera y alerta si total ≠ saldo corrido.
- **Prioridad:** P2 · **Estado de evidencia:** demostrado (código); divergencia en producción: no verificado.

## D3-F10 · La validación local del abono usa la deuda cacheada: impide registrar un pago real si la caché está desactualizada a la baja, y no admite saldo a favor
- **Severidad:** MEDIA · **Categoría:** Problema UX
- **Descripción:** `validateAbono`/`validateOfflinePayment` bloquean montos > deuda local; el servidor bloquea > deuda real (409). Si el cliente paga de más o la caché está mal (F02 caso B), el dueño no puede registrar el pago completo y puede optar por "luego", dejando el pago sin registrar.
- **Evidencia:** `src/data/pwa/offline-payments.ts:23-33`; `src/app/clientes/[id]/abono/page.tsx:85-107`; e2e I1 overpay → `409 ABONO_EXCEEDS_DEBT`.
- **Prioridad:** P2 · **Estado de evidencia:** demostrado (código/e2e); impacto en el caso real: hipótesis.

## D3-F11 · Deuda inicial no pasa por day-guard ni advisory lock
- **Severidad:** BAJA · **Categoría:** Deuda técnica
- **Descripción:** `recordInitialDebt` no llama `lockAndAssertDayEditable` (documentado como exento). Es incremento atómico (`increment`), así que no corrompe la caché, pero puede registrarse en días cerrados y no se serializa con abonos concurrentes (sin riesgo de saldo negativo porque solo suma).
- **Evidencia:** `backend/src/catalog/catalog.service.ts:670-720`; `backend/src/shared/day-guard.ts:21`.
- **Prioridad:** P4 · **Estado de evidencia:** demostrado (código).

## D3-F12 · `ensurePaymentOptimistic` re-aplica con piso en 0 (`next < 0 ? 0 : next`) y las reversiones de deuda inicial también: se pierde información silenciosamente
- **Severidad:** BAJA · **Categoría:** Error de lógica
- **Evidencia:** `src/data/pwa/offline-payments.ts:208-211`; `src/data/local/outbox-cleanup.ts` rama initialDebt (`next < 0 ? 0 : next`).
- **Consecuencias:** al re-aplicar/revertir se puede producir un saldo local que no coincide con la suma de movimientos; se corrige con el siguiente refresco del servidor.
- **Prioridad:** P3 · **Estado de evidencia:** demostrado (código); impacto: hipótesis.
