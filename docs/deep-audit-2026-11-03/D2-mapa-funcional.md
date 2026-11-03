# D2 — Mapa funcional completo (Investigador) · main 6f8f5ff

Escala de estado (BRIEF): **Implementada y verificada** / **Implementada con problemas** / **Parcial** / **Documentada no implementada** / **No implementada** / **Desconocido**.
"Verificada" aquí significa: código leído + prueba ejecutada por mí (unit backend 147/147 con Postgres embebido local) o prueba existente que cubre el caso y que corrí. Lo que solo leí en código sin prueba propia queda, como máximo, en "Implementada con problemas" o con la nota *(sin prueba propia)*. Nada se probó contra producción.

Convención de endpoints: todos bajo `/v1`. Guards globales: `JwtAuthGuard` (salvo `@Public`), `BusinessGuard` (cabecera `X-Business-Id` + membresía), `RolesGuard`, `ThrottlerGuard` 120 req/min (override indicado). Idempotencia: cabecera `Idempotency-Key` → `requestId` único por negocio (`@@unique([businessId, requestId])`) + captura P2002 → devuelve el registro existente.

---
## A. Identidad y negocio
### F01 Registro / login / refresh / logout del dueño
- Propósito: acceso del dueño. UI: `/register`, `/login`, `/acceso-tienda`, logout en `/mas/datos`.
- BE: `POST auth/login` (Public, 10/min), `POST auth/refresh` (Public, 10/min), `POST auth/logout`, `GET me`. JWT acceso 15 min; refresh con `AuthSession` revocable (migración 20261004000000). FE: `AUTH_CLEARED_EVENT` redirige al expirar (commit 90fd4ae).
- Problemas: throttle por IP con `trust proxy=1` (corregido respecto a loop-v1, ver INV-S02); no hay recuperación de contraseña (no encontrada en código).
- Estado: **Implementada con problemas** (sin recuperación de contraseña; sin prueba propia de e2e).
### F02 Negocios y membresías
- `GET businesses`, `POST businesses`; `BusinessMembership` owner/staff.
- Rol `staff` existe en enum y en `@Roles`, pero **no hay endpoint ni UI para invitar/crear staff** (grep). Estado: **Parcial** (multiusuario no implementado).
### F03 Borrado total de datos del negocio
- `DELETE business/data` (`@Roles("owner")`), `business-data.service.ts` borra en transacción todas las tablas del negocio. FE: `/mas/datos` + `business-reset.ts` limpia Dexie.
- Riesgo: irreversible, sin exportación/backup previo en la app. Estado: **Implementada con problemas** (cubierta por `business-data.unit-spec.ts`, aprobada).

## B. Catálogo e inventario
### F04 Productos: crear / editar / listar / ver / archivar
- UI: `/inventario`, `/inventario/nuevo`, `/inventario/[id]`. BE: `GET/POST products`, `GET/PATCH products/:id`, `POST products/:id/archive` (owner). Stock/costo inicial → `StockMove inicial`; `avgCost` costo promedio ponderado; `sellable`, `kind` (standard|combo, migración 20261013150000).
- Validación: DTO class-validator, `MAX_COP_AMOUNT` (6cec276). `listProducts` **sin paginación** (catalog.service.ts:182).
- Estado: **Implementada con problemas** (listas sin límite; precio editable sin historial de precios — el precio histórico sí se conserva en `SaleLine.unitPrice/unitCost`).
### F05 Movimientos de stock (historial de producto)
- `GET products/:id/moves` paginado (`pageProbe`). Razones: inicial, surtir, sale, me_lo_comi, regalar, perdido, devolucion, adjust, preparacion. Estado: **Implementada y verificada** (lectura; `paged-lists` e2e existe, no ejecutado por mí → *parcialmente verificada*).
### F06 Surtir (compra a proveedor)
- UI `/inventario/[id]/surtir`. BE `POST products/:id/surtir` (30/min). Sube stock, recalcula `avgCost`, opcional proveedor, crea `CashMove compra` (out) si se paga (catalog.service.ts ~830). Estado: **Implementada con problemas** (sin prueba propia; corrección offline FIFO de avgCost reciente aaec926 indica fragilidad).
### F07 Merma: me lo comí / regalo / perdido
- UI `/inventario/[id]/me-lo-comi|regalo|perdido`. BE `POST products/:id/shrink`. Solo stock, sin movimiento de dinero (consumo propio no se valoriza como gasto en caja). Estado: **Implementada con problemas** (*sin prueba propia*).
### F08 Preparar / combos
- UI `/inventario/[id]/preparar`. BE `POST/GET preparations`. Combo = `kind=combo`, nunca vendible; costo asignado ≤ valor restante del lote (catalog.service.ts:359-365). Tabla `Preparation`, migraciones 20260923120000/130000. Estado: **Implementada con problemas** (complejidad alta; varias correcciones FIFO en octubre; `combo-kind.e2e-spec` no ejecutado por mí; `production.unit-spec` aprobado).
### F09 Proveedores
- UI `/inventario/proveedores/nuevo|[id]`. BE `GET/POST suppliers`, `GET/PATCH suppliers/:id`, `GET suppliers/:id/surtidas` (take 50). `listSuppliers` sin paginación. Estado: **Implementada con problemas**.
### F10 Imágenes de producto (Cloudinary)
- BE `POST products/:id/image-signature`, `POST/GET products/:id/images`, `PATCH .../reorder`, `PATCH/DELETE .../:imageId`. FE `pendingMedia` (Dexie v7) para subidas offline. Estado: **Implementada y verificada** a nivel unitario (media*.unit-spec aprobadas); integración real con Cloudinary **no verificada**.

## C. Clientes y deudas
### F11 Clientes: crear / editar / listar / ver
- UI `/clientes`, `/clientes/nuevo`, `/clientes/[id]`. BE `GET/POST customers`, `GET/PATCH customers/:id`. Código secuencial `DC-0001` (`shared/customer-code.ts`) calculado leyendo **todos** los códigos del negocio (catalog.service.ts:485). `listCustomers` sin paginación.
- Estado: **Implementada con problemas**.
### F12 Deuda inicial
- UI `/clientes/[id]/deuda-inicial`. BE `POST customers/:id/initial-debts` (30/min) → `InitialDebt` + `debt increment` (catalog.service.ts:718). Offline: `offline-initial-debt.ts`. Estado: **Implementada con problemas** (no reversible; sin prueba propia).
### F13 Abono (pago de deuda)
- UI `/clientes/[id]/abono`. BE `POST customers/:id/payments` (en **cash.controller**, 30/min). Transacción: lock de día → `CustomerPayment` → `UPDATE customers SET debt=debt-amount WHERE debt>=amount` (rechaza con `ABONO_EXCEEDS_DEBT` si no) → `CashMove debt_collect` enlazado a sesión abierta o pendiente (cash.service.ts:360-430).
- No aplica a una venta (`saleId` nunca se escribe; DOMAIN.md:281 lo reconoce). No hay edición ni reverso de abono.
- Offline: `offline-payments.ts` valida contra la deuda local; rechazo permanente → `failed` sin reintento; efecto local persiste hasta descarte (`outbox.ts:538-556`, `outbox-cleanup.ts:127-143`).
- Estado: **Implementada con problemas** (núcleo atómico correcto; trazabilidad por venta y corrección ausentes; divergencia offline posible).
### F14 Estado de cuenta / ledger del cliente (admin)
- `GET customers/:id/ledger` → deudas iniciales + ventas (con líneas y devoluciones) + pagos, **sin paginación** (catalog.service.ts:576-590). FE `statement.ts`, `offline-statement.ts`, caché `customerLedgers`.
- Permite reconstruir: Σiniciales + Σcredit(ventas) − Σpagos − ΣdebtReduced(devoluciones) = debt. **No existe verificación automática** de esa igualdad en backend. Estado: **Implementada con problemas**.
### F15 PIN de portal
- BE `POST customers/:id/pin` (bcrypt, `pinHash`). UI `/mas/portal` y ficha de cliente. Estado: **Implementada y verificada** a nivel unitario (`portal-login-hardening.unit-spec` aprobado).

## D. Ventas
### F16 Venta (pago inmediato / parcial / fiada)
- UI `/ventas/nueva` → `/ventas/cobrar`; store `src/store/cartStore.ts`. BE `POST sales` (30/min).
- Reglas (`shared/sale-math.ts`): paid ⇒ recibido = total; credit ⇒ recibido = 0; partial ⇒ 0<recibido<total; partial/credit requieren cliente; método obligatorio si recibido>0. Precio de catálogo o override entero ≥0 (`resolveUnitPrice`). Producto insumo/combo no vendible. Stock: `UPDATE ... WHERE stock>=qty` → no se vende más de lo disponible ni archivado. Crea `SaleLine` (nombre, precio y costo históricos), `StockMove sale`, `CashMove sale` si hubo pago, `debt += credit`. Todo en una transacción con lock de día.
- Invariante total = Σ líneas: **demostrado por construcción** (sales.service.ts:189-193). Idempotencia por requestId (consulta previa + P2002).
- Problemas: override de precio sin motivo registrado; sin anulación. Estado: **Implementada con problemas** (*núcleo correcto; sin prueba propia de e2e*).
### F17 Historial y detalle de ventas
- UI `/ventas`, `/ventas/[id]`. BE `GET sales` (paginado), `GET sales/:id`. Offline `offline-history.ts`. Estado: **Implementada con problemas** (sin prueba propia).
### F18 Devolución
- UI `/ventas/[id]/devolver`. BE `GET/POST sales/:id/returns` (30/min). `splitReturnSettlement`: reduce deuda hasta min(valor, crédito restante de la venta, deuda del cliente); el resto es reembolso en caja (`CashMove devolucion`). Repone stock. Estado: **Implementada con problemas** (regla razonable pero el reembolso vs deuda depende del orden de abonos, porque abonos no se asignan a ventas).
### F19 Anulación / cancelación de venta / "venta equivocada"
- No hay endpoint ni UI (grep `cancel|anular|void` sin resultados funcionales). Única vía: devolución total. Estado: **No implementada**.

## E. Caja
### F20 Abrir caja
- UI `/mas/caja`. BE `POST cash/sessions` (30/min). `@@unique([businessId, localDate])` + guarda de una sola caja abierta (migración 20261007160000, `one-open-constraint.unit-spec` aprobado) + advisory lock. Estado: **Implementada y verificada** (unitario).
### F21 Cerrar caja
- UI `/mas/caja/cerrar`. BE `POST cash/sessions/:id/close`. Idempotente por `closeRequestId`. Esperado efectivo calculado (`sessionExpected`), Nequi separado; diferencia = contado − esperado efectivo. Rechaza cierre si hay movimientos pendientes sin asignar (`CARRY_REQUIRED`). Estado: **Implementada con problemas** (sin prueba propia de cierre end-to-end).
### F22 Gestionar cajas pendientes / continuidad / carry / asignar movimientos
- UI `/mas/caja/gestionar`, `/mas/caja/gestionar/[id]`. BE `GET cash/sessions`, `GET cash/sessions/:id`, `GET cash/unassigned-moves`, `POST cash/moves/:id/assign`, `POST cash/sessions/:id/carry` (`cash-manager.service.ts`, tabla `CashCarry`). Modo `assumed` fija `difference=0` con nota (cash-manager.service.ts:322) → **oculta diferencias reales**. Estado: **Implementada con problemas**.
### F23 Aportes y retiros
- UI `/mas/caja/aporte`, `/mas/caja/retiro`. BE `POST cash/aportes`, `POST cash/retiros` (30/min). Estado: **Implementada con problemas** (*sin prueba propia*).
### F24 Gastos
- UI `/mas/gastos`, `/mas/gastos/nuevo`. BE `GET/POST expenses` (paginado en GET). Gasto → `Expense` + `CashMove expense`. Sin edición/borrado. Estado: **Implementada con problemas**.
### F25 Movimientos y caja de hoy
- BE `GET cash/today`, `GET cash/moves` (**sin paginación** por rango, cash.service.ts:295-317). Estado: **Implementada con problemas**.
### F26 Día cerrado no editable
- `shared/day-guard.ts`: `assertDayEditable` + `lockAndAssertDayEditable` en ventas, abonos, etc. Estado: **Implementada con problemas** (*sin prueba propia*; la UX ante rechazo offline depende del outbox).

## F. Estadísticas e inicio
### F27 Estadísticas
- UI `/mas/estadisticas`. BE `GET stats` carga en memoria todas las ventas/pagos/gastos/movimientos/productos/clientes/devoluciones del rango (stats.service.ts:27-60). Snapshot offline (Dexie v6). Estado: **Implementada con problemas** (rendimiento con volumen; definiciones de "ganancia" no verificadas por mí contra D3).
### F28 Inicio / dashboard
- UI `/` (`src/data/pwa/dashboard.ts`). Estado: **Implementada con problemas** (*sin prueba propia*; LCP 4.7 s de loop-v1 **no re-medido**).

## G. Portal del cliente
### F29 Login de portal (código + PIN [+ tienda])
- UI `/cliente/login`. BE `POST customer-access/login` (Public, 10/min) + `PortalLoginThrottle` en BD por ip+código y por tienda; **una sola comparación bcrypt** en todos los casos; sin `businessId` solo acepta si el código resuelve a 1 cliente (take 2) o filtra por tienda (take 50) (customer-access.service.ts:76-150). Fallos globales por código solo generan alerta (no bloqueo) → mitiga el lockout por códigos secuenciales.
- Estado: **Implementada y verificada** (unitario `portal-login-hardening`, `portal-customer-softcap` aprobados).
### F30 Sesión portal (refresh/logout)
- `POST customer-access/refresh` (Public, **sin @Throttle específico**, usa 120/min global), `POST customer-access/logout`. Estado: **Implementada con problemas** (leve).
### F31 Portal: mi cuenta, compras, pagos, productos, perfil
- UI `/cliente`, `/cliente/cuenta`, `/cliente/compras`, `/cliente/compras/[id]`, `/cliente/pagos`, `/cliente/productos`, `/cliente/productos/[id]`, `/cliente/perfil`. BE `GET customer/me`, `GET customer/me/ledger` (`publicCustomerLedger` elimina `unitCost` — verificado customer-access.service.ts:293-340), `GET customer/products`. Cachés Dexie v4/v8.
- Estado: **Implementada y verificada** a nivel unitario (`portal-ledger-scope`, `customer-ledger` aprobados).

## H. Offline / PWA / sincronización
### F32 Service worker y preparación offline
- `src/app/sw.ts` (Serwist; precache `__SW_MANIFEST`, NetworkFirst "documents", CacheFirst imágenes, fallback de entidad), `offline-prep.ts` `PREP_VERSION=11`, `/offline`. Estado: **Implementada con problemas** (*sin prueba propia*; muchas iteraciones recientes).
### F33 Outbox y sincronización
- `outbox.ts` (pending→in_flight→synced|failed; backoff solo si reintentable; 403/reintentable detiene la ronda; dependencias `dependsOn`; descarte con limpieza local y marcado de dependientes), `sync-coordinator.ts`, `sync-leader.ts` (un líder entre pestañas), UI `/sincronizacion`.
- Problema: rechazos permanentes quedan `failed` y el efecto optimista local sigue visible (deuda/stock/caja locales ≠ servidor) hasta acción manual. Estado: **Implementada con problemas**.
### F34 Persistencia de almacenamiento / visibilidad
- `src/storage`, `origin-storage.ts`. Estado: **Desconocido** (no revisado en profundidad).
### F35 Importación desde la app legacy (Dexie `dulcecalle` → servidor)
- `legacyDexieId` en todas las tablas, `ImportIdMap`, `backend/migration/`, `MIGRATION.md`, `PREFLIGHT.md`. Estado: **Desconocido** (no revisado en profundidad; e2e `fase68.import` no ejecutado).

## I. Apariencia
### F36 Temas / apariencia
- UI `/mas/apariencia`, `src/theme`. Estado: **Implementada con problemas** (*sin prueba propia*; designer de loop-v1 cubrió contraste).

## J. Funciones documentadas o esperadas no presentes
| Función | Estado | Evidencia |
|---|---|---|
| Anular venta | No implementada | sin endpoint |
| Editar/revertir abono o gasto | No implementada | sin PATCH/DELETE |
| Staff / multiusuario | Parcial | enum + guard, sin alta |
| Aplicar abono a una venta | No implementada (columna muerta `customer_payments.sale_id`) | DOMAIN.md:281; cash.service.ts:378-390 |
| Exportación / backup | No implementada | sin código |
| Comprobante aceptado por el cliente | No implementada | — (ver D4) |
| Recuperar contraseña | No implementada | sin endpoint |
| `specs/AUDIT-STRUCTURAL-V1.md` | Documento ausente en main | `ls specs` falla |

## K. Discrepancias docs ↔ UI ↔ FE ↔ BE ↔ BD
1. `API_CONTRACT.md` documenta 21 endpoints; el backend expone **62** (faltan en el contrato: auth/*, me, businesses, products GET/PATCH/archive/moves/images*, customers GET/PATCH/pin, suppliers*, cash/sessions GET, unassigned-moves, assign, carry, customer-access/*, customer/*, business/data, preparations GET). 
2. `BACKEND_ARCHITECTURE.md` cita `GET /health`; real es `GET /v1/health` (prefijo global, main.ts:19; render.yaml usa `/v1/health`).
3. `CustomerPayment.saleId` existe en BD/Prisma pero ni DTO ni servicio lo escriben (columna muerta; DOMAIN lo admite como "usually null").
4. Rol `staff` en BD/código sin flujo de alta en UI/BE.
5. `PREP_VERSION`: contexto previo decía 9; código = 11.
6. Abonos documentados en dominio "clientes", implementados en `cash.controller` (organizativo, no funcional).
7. `render.yaml` fija `CORS_ORIGIN=https://dulcecalle.vercel.app` (redundante con `PROD_ORIGIN` en código).

## Resumen de conteos
- Rutas frontend (`page.tsx`): **48** (admin 39, portal `/cliente/*` 9). `route.ts`: 0.
- Endpoints backend: **62** (catalog 22 + media 6, cash 14, sales 5, identity 6, customer-access 6, stats 1, business 1, health 1 → ver inventario).
- Entidades Prisma: **22 modelos**, 7 enums. Migraciones: **12**. Dexie: versión 9, 21 tablas.
- Funcionalidades F01–F36 por estado: Implementada y verificada 6 (F05 parcial, F10, F15, F20, F29, F31) · Implementada con problemas 26 · Parcial 1 (F02) · No implementada 1 (F19, + 6 faltantes en tabla J) · Desconocido 2 (F34, F35) · Documentada no implementada 0 · *(F03 cuenta como "con problemas")*.
