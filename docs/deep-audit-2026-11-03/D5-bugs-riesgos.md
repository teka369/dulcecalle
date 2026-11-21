# D5 — Bugs y riesgos (lista única consolidada)
Base `teka369/dulcecalle@6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c`. Consolidado por PM el 2026-11-03 (hora Bogotá, UTC-5) solo con los insumos del equipo; cada hallazgo cita sus IDs originales. Formato del BRIEF.
**Conteo por severidad:** CRÍTICA 1 · ALTA 11 · MEDIA 21 · BAJA 21 · Total 54.
**Conteo por estado principal:** Demostrado 50 · Probable 3 · Hipótesis 1. (Varios demostrados tienen una parte en hipótesis, p. ej. explotabilidad o impacto en producción; se indica en cada uno.)

## Deduplicación y contradicciones entre insumos
| DC | IDs fusionados | Nota |
|---|---|---|
| DC-01 | D3-F01, F-02, F-05, INV-01; relacionado F-07, D3-F05 | |
| DC-02 | OPS-03, INV-06, D3-F08 (parte reset), D6-F7 | |
| DC-04 | D3-F04, F-01, INV-02, UX-10, D4 §5, D6-F8 | |
| DC-05 | D3-F06, F-06, INV-04, UX-09, D6-F4 | |
| DC-09 | UX-02, D3 §5 #5 | |
| DC-13 | D3-F03, F-03, OPS-14 (severidades originales: MEDIA/ALTA/BAJA) | |
| DC-14 | D3-F07, D4 §8, D6-F5 | |
| DC-15 | F-04, D3-F12 | |
| DC-16 | F-07, D3-F11 | |
| DC-20 | INV-03 (ALTA), D3-F09 (MEDIA), D6-F1 | |
| DC-21 | INV-08, D6-F10 | |
| DC-24 | OPS-08, INV-14 | |
| DC-27 | OPS-11, D6-F11, D3 §5 #7 | |
| DC-28 | UX-03, D4 §2 | |
| DC-31 | UX-07, D3 §6 | |
| DC-34 | INV-07 (MEDIA), OPS-13 (BAJA) | |
| DC-35 | INV-09, OPS-18 | |
| DC-39 | INV-13 (probable), OPS-17 (demostrado) | |
| DC-53 | UX-18, D6-F12 | |
| DC-54 | D4 §0, D6-F6 | |

**Contradicciones resueltas:**
- DC-01: INV-01 dice que el efecto local solo se revierte si el usuario descarta; D3-F01 y F-02 demuestran (tests R2 y demo-reject-revert) que se revierte **automáticamente** al recibir el rechazo permanente. Se adopta lo demostrado; INV-01 queda como lectura incompleta.
- DC-13: severidad MEDIA (D3-F03) vs ALTA (F-03) vs BAJA (OPS-14). Se fija MEDIA: defecto demostrado en API, pero improbable con el FE actual.
- DC-05: ALTA (D3-F06, INV-04) vs MEDIA (F-06, UX-09). Se fija ALTA por su papel en correcciones de deuda.
- DC-20: ALTA (INV-03) vs MEDIA (D3-F09). Se fija MEDIA: los tests QA/dev no encontraron desajustes (I2 PASS); la falta de control sigue en P1.
- DC-02 y DC-03: los insumos los clasifican ALTA (OPS-03, OPS-01); la prioridad P0 la fija la consolidación por instrucción de Juan, no cambia la severidad.
- DC-34: MEDIA (INV-07) vs BAJA (OPS-13) → BAJA (OPS midió índices adecuados).

## DC-01 · Abono (y fiado/parcial/devolución) offline rechazado por el servidor se revierte en silencio: la deuda reaparece y el cobro desaparece
- **Severidad:** CRÍTICA · **Categoría:** Riesgo financiero · **Prioridad:** P0 · **Estado de evidencia:** Demostrado (mecanismo); como causa del caso real: probable
- **IDs originales:** D3-F01, F-02, F-05, INV-01; relacionado F-07, D3-F05
- **Descripción:** El abono offline aplica efecto optimista (deuda − monto, cash_move debt_collect). Al sincronizar, cualquier 400/403/404/409/422 se trata como rechazo permanente: se revierte la deuda, se borra el cash move local y la op queda `failed` sin reintento. Causas típicas: 409 CLOSED_DAY (el servidor fecha con su hora y el día ya está cerrado; el cierre online no vacía la cola) y 409 ABONO_EXCEEDS_DEBT.
- **Evidencia:** `src/data/pwa/offline-payments.ts:88-108,177-199,257-260`; `pending-debt.ts:15-24`; `outbox-cleanup.ts:126-149`; `backend/src/cash/cash.service.ts:367-404`; `offline-operations.ts:296-298`. Tests: `evidence-dev/demo-reject-revert.log`, `logs/fe-vitest-qa-repro.log` R2, `logs/r-dayclosed.log`, tests-matriz S15b (fallido).
- **Archivos:** offline-payments.ts, pending-debt.ts, outbox-cleanup.ts, cash.service.ts, day-guard.ts, offline-operations.ts
- **Flujo afectado:** Abono offline → cierre de caja → sync; también ventas fiadas/parciales y devoluciones offline
- **Causa raíz:** Demostrada a nivel de mecanismo: el servidor no acepta la fecha original ni tiene estado «recibido sin aplicar»; el cliente interpreta el rechazo como «nunca existió» (F01, F-02).
- **Consecuencias:** Síntoma exacto del caso real; efectivo en cajón sin registro (descuadre); disputa sin evidencia en servidor.
- **Probabilidad:** Probable con uso offline cruzando el cierre del día o dos dispositivos; no cuantificable sin datos de producción.
- **Solución propuesta:** Enviar `occurredAt` del dispositivo; aceptar abonos de día cerrado en caja pendiente (`pendingForSessionId`) en vez de 409; nunca revertir un cobro sin decisión explícita del dueño; estado «dinero recibido sin aplicar»; bloquear/avisar al cerrar caja con pendientes.
- **Riesgos de la solución:** Cambia reglas de día cerrado y cierres ya conciliados; requiere migración y nuevo estado.

## DC-02 · Sin respaldo propio: Neon Free solo 6 h de PITR y `DELETE /v1/business/data` borra todo sin exportación previa
- **Severidad:** ALTA · **Categoría:** Riesgo de seguridad (datos) · **Prioridad:** P0 (por decisión de consolidación; OPS-03 ya era P0) · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-03, INV-06, D3-F08 (parte reset), D6-F7
- **Descripción:** No hay backup programado ni export en la app. El reset de negocio hace deleteMany de ventas, pagos, deudas, caja, clientes y productos en una transacción.
- **Evidencia:** Neon plans (https://neon.com/docs/introduction/plans, citado en D-seguridad-tecnica.md:71); `backend/src/business/business-data.controller.ts:17-21`; `business-data.service.ts:37-181`.
- **Archivos:** business-data.*, (ausencia de) scripts de backup
- **Flujo afectado:** Reset de datos, migraciones, error humano
- **Causa raíz:** Demostrada: ausencia de respaldo y de export (grep sin resultados, OPS-03).
- **Consecuencias:** Error o borrado detectado después de 6 h = pérdida permanente de deudas y ventas.
- **Probabilidad:** No cuantificable; ya hubo una migración forzada de BD (OPS-03).
- **Solución propuesta:** pg_dump diario cifrado (GitHub Action) con retención 30 días fuera de Neon; export CSV/JSON por negocio; export obligatorio + confirmación antes del wipe; snapshot manual antes de cada deploy con migración.
- **Riesgos de la solución:** Manejo de secreto de BD en Actions; costo de almacenamiento.

## DC-03 · Next.js 16.3.5 en rango con aviso CRÍTICO de npm audit (dependencia de producción)
- **Severidad:** ALTA · **Categoría:** Riesgo de seguridad · **Prioridad:** P0 (por decisión de consolidación; OPS-01 decía P1) · **Estado de evidencia:** Demostrado (versión); explotabilidad: hipótesis
- **IDs originales:** OPS-01
- **Descripción:** `npm audit --omit=dev` raíz: 1 crítica (next 16.0.0–16.4.0: RCE en next/og ImageResponse, cache poisoning SSG/ISR, fuga de Draft Mode, fuga en rutas de imagen de metadata), 7 altas (@serwist/*, sharp, zod…), 2 moderadas.
- **Evidencia:** `package.json` (`"next": "16.3.5"`); salida de npm audit en OPS-01.
- **Archivos:** package.json, package-lock
- **Flujo afectado:** Todo el frontend
- **Causa raíz:** Versión vulnerable (demostrado).
- **Consecuencias:** Según el aviso, posible RCE/caché envenenada; varios avisos aplican a self-hosting o a funciones quizá no usadas.
- **Probabilidad:** Explotabilidad en Vercel: hipótesis (no verificado uso de next/og).
- **Solución propuesta:** Subir next a versión parcheada (≥16.4.x según aviso) y @serwist/* en rama con build + e2e offline.
- **Riesgos de la solución:** Cambios en SW/precache rompen offline.

## DC-04 · El abono no se liga a ninguna venta: compras ya pagadas siguen mostrando «A crédito / Quedó a crédito $X»
- **Severidad:** ALTA · **Categoría:** Inconsistencia de datos / Problema UX · **Prioridad:** P1 · **Estado de evidencia:** Demostrado
- **IDs originales:** D3-F04, F-01, INV-02, UX-10, D4 §5, D6-F8
- **Descripción:** `customer_payments.sale_id` existe pero el DTO no lo acepta y el FE envía null; `sales.credit` es inmutable. Portal y vista del dueño pintan el crédito original en tono de deuda aunque el saldo sea $0. No existe saldo por venta.
- **Evidencia:** `schema.prisma:426-443`; `catalog.dto.ts:108-124`; `cash.service.ts:378-390`; `offline-payments.ts:81`; `src/components/customer/portal.ts:53-61`; `src/app/cliente/compras/[id]/page.tsx:61-72`; `src/app/ventas/[id]/page.tsx:159`. Reproducido: tests-matriz R1 (fallido), `logs/r1-portal-compra-detalle.png`.
- **Archivos:** cash.service.ts, catalog.dto.ts, portal.ts, cliente/compras/*, ventas/[id], statement.ts
- **Flujo afectado:** Abono → estado de cuenta / portal
- **Causa raíz:** Demostrada: diseño de saldo global sin imputación.
- **Consecuencias:** Explica el caso real («pagué ese producto y aparece la deuda»); el dueño puede cobrar dos veces si mira la venta.
- **Probabilidad:** Alta en cualquier cliente con fiado + abono (determinista).
- **Solución propuesta:** Imputación FIFO calculada y mostrada («Saldada / Pendiente $X»), igual en portal y tienda; a futuro tabla de aplicación (D4).
- **Riesgos de la solución:** La FIFO es convención: documentarla; migrar histórico.

## DC-05 · No existe anulación ni reverso de venta, abono, gasto o deuda inicial
- **Severidad:** ALTA · **Categoría:** Falta de funcionalidad · **Prioridad:** P1 · **Estado de evidencia:** Demostrado
- **IDs originales:** D3-F06, F-06, INV-04, UX-09, D6-F4
- **Descripción:** Sin PATCH/DELETE/void. Venta equivocada solo se corrige con devolución (mueve stock y caja como devolución real; en Nequi genera salida de dinero que nunca existió). Abono al cliente o monto equivocado no tiene corrección.
- **Evidencia:** `grep @Delete|@Patch backend/src`; S9: DELETE/POST cancel/PATCH → 404; `catalog.dto.ts:142-144`; UI solo «Devolver» (`scr-venta-360.png`).
- **Archivos:** sales.controller.ts, cash.controller.ts, ventas/[id]
- **Flujo afectado:** Venta equivocada, abono equivocado
- **Causa raíz:** Demostrada (ausencia).
- **Consecuencias:** Correcciones sucias que rompen la trazabilidad; abono al cliente equivocado = deuda que sigue en el correcto.
- **Probabilidad:** Media (errores humanos previsibles).
- **Solución propuesta:** Movimientos de reverso (`sale_void`, `payment_reversal`) con motivo, enlazados al original, en día abierto; «Corregir venta» = reverso + venta nueva.
- **Riesgos de la solución:** Diseñar efectos en caja/stock; permisos.

## DC-06 · Operaciones offline se fechan con la hora del servidor al sincronizar
- **Severidad:** ALTA · **Categoría:** Error de lógica · **Prioridad:** P1 · **Estado de evidencia:** Demostrado
- **IDs originales:** D3-F05
- **Descripción:** Ventas, abonos, devoluciones y gastos sincronizados toman `occurredOn = now` del servidor; Dexie usa `todayLocal()` del dispositivo.
- **Evidencia:** `sales.service.ts:127-129,381-383`; `cash.service.ts:367-369`; `offline-payments.ts:35-38,47`.
- **Archivos:** sales.service.ts, cash.service.ts, offline-payments.ts
- **Flujo afectado:** Cualquier operación offline que sincroniza otro día
- **Causa raíz:** Demostrada en código.
- **Consecuencias:** Caja descuadrada (efectivo del día A registrado en B); detonante de DC-01.
- **Probabilidad:** Probable con uso offline nocturno.
- **Solución propuesta:** Aceptar `clientOccurredAt` acotado + política explícita para días cerrados.
- **Riesgos de la solución:** Afecta cierres pasados.

## DC-07 · Carrera entre refresco de clientes y sync: deuda vieja mostrada o abono restado dos veces
- **Severidad:** ALTA · **Categoría:** Inconsistencia de datos · **Prioridad:** P1 · **Estado de evidencia:** Demostrado (unitario); en producción: hipótesis
- **IDs originales:** D3-F02
- **Descripción:** `CatalogReadCache.list` proyecta pendientes del outbox sobre un snapshot sin versión; el detalle de cliente no usa `useAfterSync`.
- **Evidencia:** `read-cache.ts:280-298,400-407`; `pending-debt.ts:10-13,62-108`; `evidence-dev/demo-race-readcache.log` (10000 mostrado vs 6000 real; 2000 vs 6000).
- **Archivos:** read-cache.ts, pending-debt.ts, offline-history.ts, offline-catalog.ts
- **Flujo afectado:** Saldo tras abono/fiado sincronizado
- **Causa raíz:** Demostrada: proyección no ligada a versión del snapshot.
- **Consecuencias:** El dueño ve deuda que ya no existe hasta otro refresco.
- **Probabilidad:** Baja-media (ventana corta, red lenta).
- **Solución propuesta:** Servidor devuelve requestIds aplicados o `ledgerVersion`; refrescar detalle tras sync.
- **Riesgos de la solución:** Bajo; cambio de contrato.

## DC-08 · La confirmación «Venta registrada» nunca se ve
- **Severidad:** ALTA · **Categoría:** Problema UX / Riesgo financiero · **Prioridad:** P1 · **Estado de evidencia:** Demostrado (mock)
- **IDs originales:** UX-01
- **Descripción:** Tras «Registrar», el carrito vacío redirige a /ventas/nueva (~119 ms) y a / (~748 ms); el toast no se pinta.
- **Evidencia:** `src/app/ventas/cobrar/page.tsx:84,143-148`; `ux-shots/flows2.json → toastTimeline`; `venta-pagada-04-toast-390.png`.
- **Archivos:** cobrar/page.tsx
- **Flujo afectado:** Venta pagada/parcial/fiada
- **Causa raíz:** Demostrada en código y mock.
- **Consecuencias:** Tienta a repetir la venta (duplicados); en fiado no se ve a quién se cargó.
- **Probabilidad:** Determinista.
- **Solución propuesta:** Hoja de éxito breve («Fiado a Luis · $2.000») sin rebote por carrito vacío.
- **Riesgos de la solución:** Bajo.

## DC-09 · Selector de cliente en Cobrar: homónimos indistinguibles, sin código ni deuda
- **Severidad:** ALTA · **Categoría:** Riesgo financiero / Problema UX · **Prioridad:** P1 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-02, D3 §5 #5
- **Descripción:** La hoja solo muestra `c.name`; dos «Ana Pérez» aparecen idénticas.
- **Evidencia:** `src/components/customers/CustomerPicker.tsx:29,104`; `picker-duplicados-390.png`.
- **Archivos:** CustomerPicker.tsx
- **Flujo afectado:** Venta fiada/parcial
- **Causa raíz:** Demostrada.
- **Consecuencias:** Fiado cargado al cliente equivocado (causa candidata #5 del caso real, D3 §5).
- **Probabilidad:** Media con clientes homónimos.
- **Solución propuesta:** Mostrar código, teléfono parcial y deuda; buscar por código.
- **Riesgos de la solución:** Bajo.

## DC-10 · Inicio «Hoy $X» = facturado (incluye fiado) sin separar lo cobrado
- **Severidad:** ALTA · **Categoría:** Problema UX (claridad de dinero) · **Prioridad:** P1 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-04
- **Descripción:** El número grande y «VENTAS DE HOY» repiten Σ saleTotal; no hay «cobrado hoy» ni «en caja».
- **Evidencia:** `InicioDashboard.tsx:195,210,236`; `dashboard.ts:331`; `scr-inicio-360.png`.
- **Archivos:** InicioDashboard.tsx, dashboard.ts
- **Flujo afectado:** Inicio
- **Causa raíz:** Demostrada.
- **Consecuencias:** La dueña cree que entró más dinero del real; dificulta cuadrar.
- **Probabilidad:** Determinista.
- **Solución propuesta:** Tres cifras: Vendido / Cobrado / Fiado hoy.
- **Riesgos de la solución:** Bajo.

## DC-11 · Tokens (refresh 7 días) en localStorage con CSP `script-src 'unsafe-inline'`
- **Severidad:** ALTA · **Categoría:** Riesgo de seguridad · **Prioridad:** P1 · **Estado de evidencia:** Demostrado (configuración); explotación: hipótesis
- **IDs originales:** OPS-04
- **Descripción:** Cualquier XSS o extensión comprometida roba el refresh y opera 7 días como el dueño.
- **Evidencia:** `src/data/http/session.ts:3,17,165`; `customer-session.ts:119`; CSP en vivo; `src/security-headers.ts:4-11`.
- **Archivos:** session.ts, customer-session.ts, security-headers.ts
- **Flujo afectado:** Sesión dueño y portal
- **Causa raíz:** Demostrada (almacenamiento y CSP).
- **Consecuencias:** Toma de cuenta.
- **Probabilidad:** Explotación: hipótesis (no se encontró XSS).
- **Solución propuesta:** Refresh en cookie HttpOnly/Secure/SameSite o BFF; access en memoria.
- **Riesgos de la solución:** Cambio de arquitectura de sesión, offline.

## DC-12 · Dependencias backend con avisos ALTOS (platform-express, multer, body-parser, prisma)
- **Severidad:** ALTA · **Categoría:** Riesgo de seguridad · **Prioridad:** P1 · **Estado de evidencia:** Demostrado (versiones)
- **IDs originales:** OPS-02
- **Descripción:** 6 altas y 1 moderada en prod; posible DoS por parsing en endpoints públicos.
- **Evidencia:** `backend/` npm audit (OPS-02).
- **Archivos:** backend/package.json
- **Flujo afectado:** Login, portal, API
- **Causa raíz:** Versiones vulnerables.
- **Consecuencias:** DoS.
- **Probabilidad:** Explotabilidad: hipótesis.
- **Solución propuesta:** Actualizar en rama + tests.
- **Riesgos de la solución:** Regresiones Nest/Prisma.

## DC-13 · Idempotency-Key reutilizada con otro cuerpo devuelve 2xx con la operación vieja
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero · **Prioridad:** P2 · **Estado de evidencia:** Demostrado (API); en UI: hipótesis
- **IDs originales:** D3-F03, F-03, OPS-14 (severidades originales: MEDIA/ALTA/BAJA)
- **Descripción:** Todos los escritores buscan por (businessId, requestId) sin comparar payload. Key de abono de C1 usada para C2 → 201 con C1; deuda C2 intacta. Igual en ventas.
- **Evidencia:** `cash.service.ts:344-357,430-444`; `sales.service.ts:103-107,371-375`; `abono/page.tsx:112-119`; S17c/S17d (fallido), e2e I2 (`demo-d3-e2e.log`).
- **Archivos:** cash.service.ts, sales.service.ts, catalog.service.ts, abono/page.tsx
- **Flujo afectado:** Abono, venta, devolución, gasto, deuda inicial
- **Causa raíz:** Demostrada (diseño).
- **Consecuencias:** UI muestra éxito sin operación real.
- **Probabilidad:** Baja con el FE actual (UUID nuevo por operación).
- **Solución propuesta:** Guardar hash del payload; 409/422 IDEMPOTENCY_MISMATCH; regenerar requestId si cambia el payload.
- **Riesgos de la solución:** Bajo.

## DC-14 · Descartar un abono pendiente lo elimina sin dejar rastro
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero / Problema UX · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** D3-F07, D4 §8, D6-F5
- **Descripción:** `outbox.discard` → `cleanupOutboxLocalEffect` revierte deuda, borra cash move y fila del abono.
- **Evidencia:** `outbox.ts:188-212`; `outbox-cleanup.ts:126-149`; test `r2a-a1-optimistic-revert.test.ts:109`.
- **Archivos:** outbox.ts, outbox-cleanup.ts
- **Flujo afectado:** Bandeja de sincronización
- **Causa raíz:** Demostrada.
- **Consecuencias:** Dinero recibido sin registro (causa #3 del caso real, D3 §5).
- **Probabilidad:** Media-baja.
- **Solución propuesta:** Confirmación con monto/cliente y bitácora del descarte.
- **Riesgos de la solución:** Bajo.

## DC-15 · Reversiones locales con piso en 0 dejan saldo local errado
- **Severidad:** MEDIA · **Categoría:** Bug · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** F-04, D3-F12
- **Descripción:** Revertir venta con `next < 0 ? 0 : next` y luego sumar el abono revertido: deuda local 56000 en vez de 50000.
- **Evidencia:** `outbox-cleanup.ts:89-92`; `offline-payments.ts:177-187,208-211`; `logs/fe-vitest-qa-repro.log` R3; S15c (fallido).
- **Archivos:** outbox-cleanup.ts, offline-payments.ts
- **Flujo afectado:** Rechazos múltiples offline
- **Causa raíz:** Demostrada.
- **Consecuencias:** Deuda mostrada mayor que la real hasta refresco.
- **Probabilidad:** Baja.
- **Solución propuesta:** Revertir por deltas sin clamp o recomputar servidor + pendientes.
- **Riesgos de la solución:** Bajo.

## DC-16 · Cerrar caja bloquea ventas y abonos del resto del día, pero deudas iniciales sí entran (sin lock)
- **Severidad:** MEDIA · **Categoría:** Error de lógica · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** F-07, D3-F11
- **Descripción:** La deuda puede crecer en día cerrado pero no bajar; `recordInitialDebt` no usa day-guard ni advisory lock.
- **Evidencia:** S13d; `logs/r-dayclosed.log` (abono 409, initial-debt 201); `day-guard.ts:21-22`; `catalog.service.ts:670-720`.
- **Archivos:** day-guard.ts, catalog.service.ts
- **Flujo afectado:** Cierre de caja
- **Causa raíz:** Demostrada (exención documentada).
- **Consecuencias:** Ruta directa a DC-01.
- **Probabilidad:** Media.
- **Solución propuesta:** Política única de día cerrado (pendiente de asignar).
- **Riesgos de la solución:** Toca cierres.

## DC-17 · Validación local del abono contra deuda cacheada; no admite pago de más / saldo a favor
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado de evidencia:** Demostrado (código/e2e); impacto: hipótesis
- **IDs originales:** D3-F10
- **Descripción:** Bloquea montos > deuda local; el servidor rechaza > deuda real (409).
- **Evidencia:** `offline-payments.ts:23-33`; `abono/page.tsx:85-107`; e2e I1 overpay 409.
- **Archivos:** offline-payments.ts, abono/page.tsx
- **Flujo afectado:** Abono
- **Causa raíz:** Demostrada.
- **Consecuencias:** El dueño deja el pago «para luego» y queda sin registrar (causa #2 del caso real).
- **Probabilidad:** Media (hipótesis de impacto).
- **Solución propuesta:** Saldo a favor o registrar excedente.
- **Riesgos de la solución:** Cambia modelo de deuda.

## DC-18 · Cierre de cajas «asumidas» fija diferencia 0
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-05
- **Descripción:** closingCount=expected y difference=0 con nota; un faltante real desaparece.
- **Evidencia:** `cash-manager.service.ts:302-323`.
- **Archivos:** cash-manager.service.ts
- **Flujo afectado:** Gestionar cajas pendientes
- **Causa raíz:** Demostrada.
- **Consecuencias:** Reportes de diferencias falsos.
- **Probabilidad:** Media.
- **Solución propuesta:** difference=null («no contada»).
- **Riesgos de la solución:** Bajo.

## DC-19 · Importador copia `customers.debt` sin movimientos; reconcile solo avisa
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** D3-F08 (parte import)
- **Descripción:** `importer.ts:192` copia debt; `reconcile.ts:124-136` solo warning DEBT_MISMATCH.
- **Evidencia:** `backend/migration/importer.ts:192`; `reconcile.ts:124-136`.
- **Archivos:** backend/migration/*
- **Flujo afectado:** Import legacy
- **Causa raíz:** Demostrada.
- **Consecuencias:** Saldos no reconstruibles.
- **Probabilidad:** Desconocida (no se sabe si se usó en prod).
- **Solución propuesta:** Importar la diferencia como deuda inicial o bloquear.
- **Riesgos de la solución:** Bajo.

## DC-20 · `customers.debt` es caché sin verificación periódica ni CHECK debt≥0
- **Severidad:** MEDIA · **Categoría:** Deuda técnica / Riesgo financiero · **Prioridad:** P1 · **Estado de evidencia:** Demostrado (ausencia de control)
- **IDs originales:** INV-03 (ALTA), D3-F09 (MEDIA), D6-F1
- **Descripción:** 4 escritores atómicos; ningún job compara contra Σ movimientos; el estado de cuenta muestra `customer.debt` y saldo corrido sin compararlos.
- **Evidencia:** Escritores: `sales.service.ts:299,553`, `cash.service.ts:392`, `catalog.service.ts:718`; `statement.ts:118-141`. Tests QA: 0 desajustes I2.
- **Archivos:** schema.prisma, statement.ts
- **Flujo afectado:** Todo saldo de cliente
- **Causa raíz:** Demostrada (ausencia).
- **Consecuencias:** Deriva oculta.
- **Probabilidad:** Baja en API (invariante PASS); divergencia en prod: no verificada.
- **Solución propuesta:** CHECK debt≥0, endpoint de salud financiera, alerta si total ≠ saldo corrido; SQL de detección de D3.
- **Riesgos de la solución:** Bajo.

## DC-21 · Rol staff sin alta y sin userId en movimientos
- **Severidad:** MEDIA · **Categoría:** Falta de funcionalidad · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-08, D6-F10
- **Descripción:** No hay trazabilidad de quién registró cada operación.
- **Evidencia:** `auth.types.ts:6`; `roles.guard.ts`; solo 2 endpoints `@Roles("owner")`.
- **Archivos:** identity, tenancy
- **Flujo afectado:** Multiusuario
- **Causa raíz:** Demostrada.
- **Consecuencias:** Sin auditoría con dos usuarios.
- **Probabilidad:** Baja hoy.
- **Solución propuesta:** userId en movimientos; alta de staff.
- **Riesgos de la solución:** Migración.

## DC-22 · Refresh token sin rotación ni detección de reuso; access no revocable
- **Severidad:** MEDIA · **Categoría:** Riesgo de seguridad · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-05
- **Descripción:** Mismo refresh devuelto; jwt.guard no consulta sesiones.
- **Evidencia:** `identity.service.ts:101`; `auth-sessions.ts:33`; `jwt.guard.ts:35-45`.
- **Archivos:** identity/*
- **Flujo afectado:** Sesión
- **Causa raíz:** Demostrada.
- **Consecuencias:** Token robado vale 7 días; 15 min tras logout.
- **Probabilidad:** Hipótesis.
- **Solución propuesta:** Rotación + revocar familia; «cerrar todas las sesiones».
- **Riesgos de la solución:** Bajo-medio.

## DC-23 · Sin monitoreo ni alertas; cold start de 62 s
- **Severidad:** MEDIA · **Categoría:** Rendimiento / Operación · **Prioridad:** P1 · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-07
- **Descripción:** Sin Sentry/uptime; Render free duerme a 15 min, Neon a 5 min.
- **Evidencia:** `/v1/health` 62,44 s (OPS-07, 2026-11-03 09:47 Bogotá); QA timeout 20 s; `render.yaml:4-6`.
- **Archivos:** render.yaml
- **Flujo afectado:** Primera venta del día, sync
- **Causa raíz:** Demostrada.
- **Consecuencias:** Fallos de sync/500 invisibles.
- **Probabilidad:** Alta (cada inactividad).
- **Solución propuesta:** Uptime monitor + Sentry + alertas de cuota.
- **Riesgos de la solución:** Consumo de horas free.

## DC-24 · Migraciones al arrancar, sin reversa, con guardas que abortan el arranque
- **Severidad:** MEDIA · **Categoría:** Deuda técnica / Operación · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-08, INV-14
- **Descripción:** `prisma migrate deploy && node dist/main.js`, autoDeploy; `cash_one_open_guard` RAISE EXCEPTION.
- **Evidencia:** `render.yaml:15`; migraciones 20260920120000, 20261007160000.
- **Archivos:** render.yaml, prisma/migrations
- **Flujo afectado:** Deploy
- **Causa raíz:** Demostrada (config).
- **Consecuencias:** Caída total sin rollback.
- **Probabilidad:** Baja por deploy.
- **Solución propuesta:** Paso de migración separado + snapshot Neon + SQL de reversa.
- **Riesgos de la solución:** Bajo.

## DC-25 · CI sin build/lint/audit y main sin protección
- **Severidad:** MEDIA · **Categoría:** Deuda técnica · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-09
- **Descripción:** Workflow solo tests; branch protection 404; autoDeploy.
- **Evidencia:** `.github/workflows/offline-e2e.yml`; `gh api …/protection` → 404.
- **Archivos:** CI
- **Flujo afectado:** Deploy
- **Causa raíz:** Demostrada.
- **Consecuencias:** Build roto llega a producción.
- **Probabilidad:** Media.
- **Solución propuesta:** Jobs de build/lint/audit requeridos.
- **Riesgos de la solución:** Bajo.

## DC-26 · PIN de portal de 6 dígitos sin bloqueo duro ante ataque distribuido
- **Severidad:** MEDIA · **Categoría:** Riesgo de seguridad · **Prioridad:** P3 · **Estado de evidencia:** Demostrado (diseño)
- **IDs originales:** OPS-10
- **Descripción:** Límites por IP+código; por código solo retraso suave y alerta en log.
- **Evidencia:** `customer-access.dto.ts:9`; `portal-throttle.ts:20`; `customer-access.service.ts:147`.
- **Archivos:** customer-access/*
- **Flujo afectado:** Login portal
- **Causa raíz:** Demostrada (diseño).
- **Consecuencias:** Lectura de deuda/historial ajeno.
- **Probabilidad:** Baja.
- **Solución propuesta:** Tope por código/día con desbloqueo del dueño; alerta visible.
- **Riesgos de la solución:** Bloqueo de cliente legítimo.

## DC-27 · Pérdida de dispositivo: lo no sincronizado se pierde
- **Severidad:** MEDIA · **Categoría:** Riesgo de datos · **Prioridad:** P2 · **Estado de evidencia:** Probable
- **IDs originales:** OPS-11, D6-F11, D3 §5 #7
- **Descripción:** IndexedDB; `persist()` solo por acción explícita; sin copia externa ni aviso al cerrar sesión.
- **Evidencia:** `outbox.ts`, `origin-storage.ts:3,132`.
- **Archivos:** outbox, origin-storage
- **Flujo afectado:** Offline
- **Causa raíz:** Probable.
- **Consecuencias:** Abono hecho offline desaparece con el teléfono (causa #7 del caso real).
- **Probabilidad:** Baja-media.
- **Solución propuesta:** Contador permanente de pendientes, persist() al iniciar, export local.
- **Riesgos de la solución:** Bajo.

## DC-28 · Sin resumen previo en fiado/parcial; el cliente no aparece en la barra de Cobrar
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-03, D4 §2
- **Descripción:** «$2.000 · Fiada» sin nombre; Registrar confirma de inmediato.
- **Evidencia:** `cobrar/page.tsx:155-157`; `venta-parcial-09-parcial-lleno-390.png`.
- **Archivos:** cobrar/page.tsx
- **Flujo afectado:** Fiado/parcial
- **Causa raíz:** Demostrada.
- **Consecuencias:** Fiado al cliente equivocado sin revisión.
- **Probabilidad:** Media.
- **Solución propuesta:** Resumen «Fiada a Luis (debe 20.000 → 22.000)» (D4 §2).
- **Riesgos de la solución:** Un paso más.

## DC-29 · Vocabulario de dinero ambiguo entre pantallas
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-05
- **Descripción:** «Por cobrar», «Fiado», «Fiados», «Recibido», «Entradas» con bases distintas.
- **Evidencia:** `scr-inicio/ventas/stats/caja-360.png`.
- **Archivos:** Varias
- **Flujo afectado:** Lectura de cifras
- **Causa raíz:** Demostrada (textos).
- **Consecuencias:** Confusión al cuadrar.
- **Probabilidad:** Alta.
- **Solución propuesta:** Glosario único.
- **Riesgos de la solución:** Bajo.

## DC-30 · Banner «Venta rápida · Abre la caja registradora» lleva a Nueva venta
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-06
- **Descripción:** Confunde con la sesión de caja.
- **Evidencia:** `InicioDashboard.tsx:159`; `closed-inicio-390.png`.
- **Archivos:** InicioDashboard.tsx
- **Flujo afectado:** Inicio
- **Causa raíz:** Demostrada.
- **Consecuencias:** Ventas sin caja abierta.
- **Probabilidad:** Media.
- **Solución propuesta:** Renombrar o enlazar a /mas/caja.
- **Riesgos de la solución:** Bajo.

## DC-31 · Se puede vender en efectivo con la caja cerrada sin aviso
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero / UX · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-07, D3 §6
- **Descripción:** Cobrar no consulta el estado de caja.
- **Evidencia:** `cobrar/page.tsx`, `checkout.ts` (0 referencias a sesión); `closed-caja-390.png`.
- **Archivos:** cobrar/page.tsx
- **Flujo afectado:** Venta
- **Causa raíz:** Demostrada (código); efecto en caja: probable.
- **Consecuencias:** Movimientos sin asignar; cierres que no cuadran.
- **Probabilidad:** Media.
- **Solución propuesta:** Aviso no bloqueante.
- **Riesgos de la solución:** Bajo.

## DC-32 · Devolución sin confirmación ni deshacer
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-08
- **Descripción:** Un toque envía el POST de devolución.
- **Evidencia:** `ventas/[id]/devolver/page.tsx:281-284`; mockapi.log 09:50 (UTC-5).
- **Archivos:** devolver/page.tsx
- **Flujo afectado:** Devolución
- **Causa raíz:** Demostrada.
- **Consecuencias:** Devoluciones erróneas sin reverso (ver DC-05).
- **Probabilidad:** Media.
- **Solución propuesta:** Resumen previo o deshacer con reverso.
- **Riesgos de la solución:** Bajo.

## DC-33 · Backend sin cabeceras de seguridad y con `x-powered-by: Express`
- **Severidad:** MEDIA · **Categoría:** Riesgo de seguridad · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-06
- **Descripción:** Sin helmet/HSTS/nosniff.
- **Evidencia:** `curl -D - …/v1/health` (OPS-06).
- **Archivos:** main.ts
- **Flujo afectado:** API
- **Causa raíz:** Demostrada.
- **Consecuencias:** Impacto bajo para API JSON.
- **Probabilidad:** Baja.
- **Solución propuesta:** helmet + disable x-powered-by.
- **Riesgos de la solución:** Bajo.

## DC-34 · Listados y estadísticas sin límite (en memoria)
- **Severidad:** BAJA · **Categoría:** Rendimiento · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-07 (MEDIA), OPS-13 (BAJA)
- **Descripción:** findMany sin paginar en productos, clientes, proveedores, ledger y stats.
- **Evidencia:** `catalog.service.ts:182,516,962,574-590`; `stats.service.ts:27-60`.
- **Archivos:** catalog.service.ts, stats.service.ts
- **Flujo afectado:** Listas, stats
- **Causa raíz:** Demostrada (código).
- **Consecuencias:** Crece lineal; riesgo en Render free.
- **Probabilidad:** Impacto: hipótesis.
- **Solución propuesta:** Agregados SQL y paginación.
- **Riesgos de la solución:** Bajo.

## DC-35 · Precio unitario editable sin precio de catálogo ni motivo
- **Severidad:** BAJA · **Categoría:** Riesgo financiero · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-09, OPS-18
- **Descripción:** `resolveUnitPrice` usa el precio enviado; no se guarda catalogPrice.
- **Evidencia:** `sale-math.ts:43-52`; total recalculado `sales.service.ts:187-189`.
- **Archivos:** sale-math.ts
- **Flujo afectado:** Venta
- **Causa raíz:** Demostrada.
- **Consecuencias:** Descuentos y errores indistinguibles.
- **Probabilidad:** Baja.
- **Solución propuesta:** Guardar catalogPrice.
- **Riesgos de la solución:** Bajo.

## DC-36 · API_CONTRACT.md desactualizado (21 de 62 endpoints) y rutas sin prefijo
- **Severidad:** BAJA · **Categoría:** Deuda técnica · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-10
- **Descripción:** Docs vs código.
- **Evidencia:** API_CONTRACT.md; BACKEND_ARCHITECTURE.md `/health` vs `/v1/health`; D2 §diferencias.
- **Archivos:** Docs
- **Flujo afectado:** —
- **Causa raíz:** Demostrada.
- **Consecuencias:** QA/soporte con información errada.
- **Probabilidad:** —
- **Solución propuesta:** Regenerar contrato.
- **Riesgos de la solución:** Bajo.

## DC-37 · `specs/AUDIT-STRUCTURAL-V1.md` no existe en main
- **Severidad:** BAJA · **Categoría:** Deuda técnica (documentación) · **Prioridad:** P4 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-11
- **Descripción:** La auditoría estructural previa no está versionada en main (existe en `/workspace/dulcecalle/specs/` local).
- **Evidencia:** `ls specs` en el clon (INV-11, D1:46).
- **Archivos:** specs/
- **Flujo afectado:** —
- **Causa raíz:** Demostrada.
- **Consecuencias:** Pérdida de contexto.
- **Probabilidad:** —
- **Solución propuesta:** Versionarla.
- **Riesgos de la solución:** Bajo.

## DC-38 · `customer-access/refresh` sin throttle específico
- **Severidad:** BAJA · **Categoría:** Riesgo de seguridad · **Prioridad:** P4 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-12
- **Descripción:** Solo límite global 120/min.
- **Evidencia:** `customer-access.controller.ts:22-26`.
- **Archivos:** customer-access
- **Flujo afectado:** Portal
- **Causa raíz:** Demostrada.
- **Consecuencias:** Bajo (token largo).
- **Probabilidad:** Baja.
- **Solución propuesta:** Throttle dedicado.
- **Riesgos de la solución:** Bajo.

## DC-39 · CORS con credentials acepta cualquier preview de Vercel del equipo contra la API de producción
- **Severidad:** BAJA · **Categoría:** Riesgo de seguridad · **Prioridad:** P4 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-13 (probable), OPS-17 (demostrado)
- **Descripción:** Ramas no revisadas pueden llamar a prod.
- **Evidencia:** `http-setup.ts:23,33,48`; OPTIONS en vivo (OPS-17).
- **Archivos:** http-setup.ts
- **Flujo afectado:** API
- **Causa raíz:** Demostrada.
- **Consecuencias:** Limitado (Bearer, orígenes no comparten localStorage).
- **Probabilidad:** Baja.
- **Solución propuesta:** Previews contra staging/branch Neon.
- **Riesgos de la solución:** Bajo.

## DC-40 · Consumo propio/regalo/pérdida no se valoriza en dinero
- **Severidad:** BAJA · **Categoría:** Falta de funcionalidad · **Prioridad:** P3 · **Estado de evidencia:** Probable
- **IDs originales:** INV-15
- **Descripción:** Shrink solo genera StockMove; no verificado si stats lo resta de utilidad.
- **Evidencia:** `POST products/:id/shrink` (INV-15).
- **Archivos:** catalog.service.ts:865
- **Flujo afectado:** Merma
- **Causa raíz:** Probable.
- **Consecuencias:** Utilidad sobreestimada.
- **Probabilidad:** Desconocida.
- **Solución propuesta:** Verificar stats y restar costo de merma.
- **Riesgos de la solución:** Bajo.

## DC-41 · Sin recuperación de contraseña del dueño
- **Severidad:** BAJA · **Categoría:** Falta de funcionalidad · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** INV-16
- **Descripción:** No hay endpoint.
- **Evidencia:** `identity.controller.ts`.
- **Archivos:** identity
- **Flujo afectado:** Login
- **Causa raíz:** Demostrada.
- **Consecuencias:** Pérdida de acceso al negocio.
- **Probabilidad:** Baja.
- **Solución propuesta:** Flujo de recuperación.
- **Riesgos de la solución:** Bajo.

## DC-42 · `qty` sin máximo en DTOs de venta/devolución
- **Severidad:** BAJA · **Categoría:** Bug potencial · **Prioridad:** P3 · **Estado de evidencia:** Hipótesis
- **IDs originales:** OPS-12
- **Descripción:** qty×precio puede exceder MAX_SAFE_INTEGER y hacer fallar `copToJson`.
- **Evidencia:** `sales.dto.ts:24-26`; `money.ts:9,39-44`.
- **Archivos:** sales.dto.ts
- **Flujo afectado:** Venta
- **Causa raíz:** No probado.
- **Consecuencias:** Error 500.
- **Probabilidad:** Hipótesis (el stock probablemente lo frena).
- **Solución propuesta:** @Max en qty y tope de total.
- **Riesgos de la solución:** Bajo.

## DC-43 · Enumeración de correos por tiempo en login del dueño
- **Severidad:** BAJA · **Categoría:** Riesgo de seguridad · **Prioridad:** P4 · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-15
- **Descripción:** Responde sin bcrypt si el usuario no existe.
- **Evidencia:** `identity.service.ts:69-72`; throttle 10/min.
- **Archivos:** identity.service.ts
- **Flujo afectado:** Login
- **Causa raíz:** Demostrada (código).
- **Consecuencias:** Bajo.
- **Probabilidad:** Baja.
- **Solución propuesta:** Hash dummy.
- **Riesgos de la solución:** Bajo.

## DC-44 · Logs con código de cliente y excepción completa en 500
- **Severidad:** BAJA · **Categoría:** Exposición de información · **Prioridad:** P4 · **Estado de evidencia:** Demostrado
- **IDs originales:** OPS-16
- **Descripción:** No se loguean PIN, contraseñas ni tokens.
- **Evidencia:** `customer-access.service.ts:147-149`; `http-error.filter.ts:76,90`.
- **Archivos:** logs
- **Flujo afectado:** —
- **Causa raíz:** Demostrada.
- **Consecuencias:** Bajo.
- **Probabilidad:** —
- **Solución propuesta:** Documentar retención.
- **Riesgos de la solución:** —

## DC-45 · `DATABASE_URL` de Neon presente en Vercel aunque el frontend no la usa
- **Severidad:** BAJA · **Categoría:** Riesgo de seguridad · **Prioridad:** P3 · **Estado de evidencia:** Probable
- **IDs originales:** D-seguridad-tecnica §6
- **Descripción:** Secreto de BD expuesto en otro proveedor sin necesidad.
- **Evidencia:** D-seguridad-tecnica.md:42 (grep: el FE no la usa; no verificado por MCP).
- **Archivos:** Vercel env
- **Flujo afectado:** —
- **Causa raíz:** Probable.
- **Consecuencias:** Superficie extra.
- **Probabilidad:** Baja.
- **Solución propuesta:** Quitar la integración si no se usa (decisión de Juan; no tocar config en esta auditoría).
- **Riesgos de la solución:** Bajo.

## DC-46 · Error genérico en abono tras POST que sí salió
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado de evidencia:** Demostrado (mock)
- **IDs originales:** UX-11
- **Descripción:** Muestra «Revisa los datos…» aunque el servidor (mock) recibió el abono.
- **Evidencia:** `abono-05-toast-390.png`; mockapi.log 09:50 (UTC-5).
- **Archivos:** abono/page.tsx
- **Flujo afectado:** Abono
- **Causa raíz:** Demostrada con mock.
- **Consecuencias:** Induce a reintentar.
- **Probabilidad:** Baja.
- **Solución propuesta:** Distinguir «no enviado» de «enviado sin confirmar».
- **Riesgos de la solución:** Bajo.

## DC-47 · Pills flotantes de sincronización tapan contenido
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-12
- **Descripción:** Tapan títulos, filas y la etiqueta «Nota».
- **Evidencia:** `PrepIndicator.tsx:54`; `SyncPill.tsx:36`; capturas UX.
- **Archivos:** shell
- **Flujo afectado:** Varias
- **Causa raíz:** Demostrada.
- **Consecuencias:** Lectura dificultada.
- **Probabilidad:** Alta.
- **Solución propuesta:** Reservar espacio.
- **Riesgos de la solución:** Bajo.

## DC-48 · Sin búsqueda en Ventas
- **Severidad:** BAJA · **Categoría:** Falta de funcionalidad · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-13
- **Descripción:** Solo filtros por modalidad.
- **Evidencia:** `src/app/ventas/page.tsx`; `scr-ventas-360.png`.
- **Archivos:** ventas/page.tsx
- **Flujo afectado:** Buscar venta a devolver
- **Causa raíz:** Demostrada.
- **Consecuencias:** Lento.
- **Probabilidad:** —
- **Solución propuesta:** Búsqueda por cliente/producto/monto.
- **Riesgos de la solución:** Bajo.

## DC-49 · Acceso rápido «Surtir» ↔ «Stock bajo» no lleva a surtir
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-14
- **Descripción:** Ambos van a /inventario.
- **Evidencia:** `InicioDashboard.tsx:23,150`.
- **Archivos:** InicioDashboard.tsx
- **Flujo afectado:** Surtir
- **Causa raíz:** Demostrada.
- **Consecuencias:** Pasos extra.
- **Probabilidad:** —
- **Solución propuesta:** Etiqueta estable con buscador directo.
- **Riesgos de la solución:** Bajo.

## DC-50 · Cerrar caja con diferencia: el botón es una pregunta sin guía
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-15
- **Descripción:** «¿Cerrar con diferencia?» sin opciones.
- **Evidencia:** `cerrar-caja-05-post-390.png`.
- **Archivos:** mas/caja/cerrar
- **Flujo afectado:** Cierre
- **Causa raíz:** Demostrada (texto); paso siguiente no verificado.
- **Consecuencias:** Cierres confusos.
- **Probabilidad:** —
- **Solución propuesta:** «Falta $X» + Volver a contar / Cerrar con faltante.
- **Riesgos de la solución:** Bajo.

## DC-51 · Enlace del cliente en detalle de venta mide 65×20 px
- **Severidad:** BAJA · **Categoría:** Problema UX (accesibilidad) · **Prioridad:** P4 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-16
- **Descripción:** Objetivo táctil pequeño.
- **Evidencia:** `flows.json → audit["venta@360"].tiny`.
- **Archivos:** ventas/[id]
- **Flujo afectado:** —
- **Causa raíz:** Demostrada.
- **Consecuencias:** —
- **Probabilidad:** —
- **Solución propuesta:** ≥44 px.
- **Riesgos de la solución:** —

## DC-52 · Resumen deshabilitado «0 productos · $0» con contraste 1,35:1
- **Severidad:** BAJA · **Categoría:** Mejora opcional · **Prioridad:** P4 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-17
- **Descripción:** Estado inactivo (WCAG lo exime).
- **Evidencia:** `flows.json → audit["nueva@360"].fails`.
- **Archivos:** ventas/nueva
- **Flujo afectado:** —
- **Causa raíz:** Demostrada.
- **Consecuencias:** —
- **Probabilidad:** —
- **Solución propuesta:** Subir contraste.
- **Riesgos de la solución:** —

## DC-53 · Estadísticas sin margen por producto ni deudas por antigüedad
- **Severidad:** BAJA · **Categoría:** Falta de funcionalidad · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** UX-18, D6-F12
- **Descripción:** Solo totales.
- **Evidencia:** `scr-stats-360.png`.
- **Archivos:** mas/estadisticas
- **Flujo afectado:** Stats
- **Causa raíz:** Demostrada.
- **Consecuencias:** Decisiones de surtido a ciegas.
- **Probabilidad:** —
- **Solución propuesta:** Top/margen y antigüedad de deuda.
- **Riesgos de la solución:** Bajo.

## DC-54 · La nota del abono no se muestra en el portal del cliente
- **Severidad:** BAJA · **Categoría:** Problema UX / trazabilidad · **Prioridad:** P3 · **Estado de evidencia:** Demostrado
- **IDs originales:** D4 §0, D6-F6
- **Descripción:** `publicCustomerLedger` omite `note` de pagos.
- **Evidencia:** `customer-access.service.ts:333-339`.
- **Archivos:** customer-access.service.ts
- **Flujo afectado:** Portal
- **Causa raíz:** Demostrada.
- **Consecuencias:** «¿Cuál abono?»
- **Probabilidad:** —
- **Solución propuesta:** Exponer la nota.
- **Riesgos de la solución:** Bajo.
