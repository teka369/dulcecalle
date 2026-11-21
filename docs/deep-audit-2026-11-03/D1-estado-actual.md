# D1 — Estado actual de DulceCalle (Investigador)

Base auditada: `teka369/dulcecalle`, rama `main`, SHA **6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c** (merge PR #41 `feat/combo-kind-v2`, 2026-10-26 16:30 hora Bogotá, UTC-5). Clon fresco en `/workspace/deep-audit/inv/dulcecalle`, `git status` limpio (0 cambios sin commit). Auditoría solo lectura: sin cambios de código, commits, PRs, deploys ni acceso a producción (Neon/Render/Vercel).

## 1. Explicación para Juan (sin tecnicismos)
DulceCalle es una aplicación para manejar una tienda pequeña de dulces/snacks desde el celular. Sirve para:
- **Vender**: se arma un carrito, se cobra en efectivo o Nequi, se puede vender "fiado" (todo a deber) o con un pago parcial; el saldo pendiente queda como deuda del cliente.
- **Llevar las deudas de los clientes ("fiados")**: cada cliente tiene un código (DC-0001…), una deuda total, y se le registran abonos. Se puede cargar una deuda inicial (lo que ya debía antes de usar la app).
- **Controlar el inventario**: productos con precio, costo promedio, unidades; se "surte" (compra a proveedor), se registra lo que se perdió, se regaló o "me lo comí" (consumo propio), y se "preparan" combos (convertir un paquete en unidades vendibles).
- **Manejar la caja**: abrir caja con una base, registrar aportes, retiros y gastos, y cerrar comparando el efectivo contado contra el esperado. Nequi se lleva aparte y no cuenta como efectivo del cajón.
- **Ver estadísticas**: ventas, ganancias, gastos, deudas por período.
- **Portal del cliente** (`/cliente`): el cliente entra con su código y un PIN de 6 dígitos y ve sus compras, pagos y cuánto debe (sin ver costos de la tienda).
- **Funciona sin internet**: si se cae la conexión, la app guarda las operaciones en el teléfono (una "bandeja de salida") y las envía al servidor cuando vuelve la señal. La pantalla "Sincronización" muestra lo pendiente o lo que falló.

Lo que la app **no** hace hoy (verificado en código): no permite anular/cancelar una venta (solo devolver productos), no permite editar ni revertir un abono, no tiene empleados reales (el rol "staff" existe en el modelo pero no hay forma de invitar a nadie), no exporta datos ni hace copias de seguridad desde la app, no registra comprobantes aceptados por el cliente, y los abonos se aplican a la deuda total del cliente, no a una venta concreta.

## 2. Arquitectura y tecnologías (demostrado en código)
| Capa | Tecnología | Evidencia |
|---|---|---|
| Frontend | Next.js App Router + React, PWA con Serwist (`src/app/sw.ts`: precache, NetworkFirst para documentos, CacheFirst para imágenes, `skipWaiting`) | `next.config.ts`, `src/app/sw.ts` |
| Datos locales | Dexie (IndexedDB) `dulcecalle-local`, esquema **v9** (v1 base+outbox, v2 cacheMeta, v3 cashSessions requestId, v4 customerLedgers, v5 prepState, v6 snapshots, v7 pendingMedia, v8 portalCatalogs, v9 preparations) | `src/data/local/db.ts:57-111` |
| Offline prep | `PREP_VERSION = 11` (el contexto decía 9 → **desactualizado**; subió a 11 en f76d6b1 al añadir `/mas/portal`) | `src/data/pwa/offline-prep.ts:38` |
| Sincronización | Outbox con estados pending/in_flight/synced/failed, dependencias (`dependsOn`), reintento con backoff para errores reintentables, descarte manual con `cleanupOutboxLocalEffect` | `src/data/local/outbox.ts`, `outbox-cleanup.ts`, `src/data/pwa/sync-coordinator.ts`, `sync-leader.ts` |
| Backend | NestJS, prefijo global `/v1`, ValidationPipe `whitelist+forbidNonWhitelisted`, guards globales JWT → Business → Roles → Throttler (120/min por defecto) | `backend/src/main.ts:19-23`, `app.module.ts:36-56` |
| BD | PostgreSQL vía Prisma; dinero en `BigInt` COP enteros; 22 modelos, 7 enums, 12 migraciones | `backend/prisma/schema.prisma` |
| Hosting | Render (web free, Oregon, `prisma migrate deploy` al arrancar, healthcheck `/v1/health`) + Neon Postgres externo; Vercel para el frontend (`dulcecalle.vercel.app`) | `render.yaml` |
| Imágenes | Cloudinary (firma de subida firmada en backend) | `backend/src/catalog/media.service.ts` |
| CI | Un workflow `offline-e2e.yml` (PR y push a main) con Postgres 16 de servicio | `.github/workflows/offline-e2e.yml` |

## 3. Módulos y relaciones
- **identity**: login/refresh/logout del dueño (JWT acceso 15 min + sesiones de refresh en `AuthSession`), `/me`, crear/listar negocios.
- **tenancy**: `BusinessGuard` (cabecera `X-Business-Id` + membresía) y `RolesGuard` (owner/staff).
- **catalog**: productos, movimientos de stock, surtir, merma (shrink: me_lo_comi/regalar/perdido), preparaciones/combos, clientes (código, PIN, deuda inicial, ledger), proveedores, imágenes.
- **sales**: ventas (paid/partial/credit) y devoluciones.
- **cash**: sesiones de caja (abrir/cerrar/continuidad/carry/asignar movimientos pendientes), movimientos, aportes, retiros, gastos, **abonos de clientes** (`POST /customers/:id/payments` vive en cash).
- **stats**: agregados por rango.
- **customer-access**: portal del cliente (login código+PIN, refresh, logout, me, ledger, productos).
- **business**: borrado total de datos del negocio (solo owner).
- **health**; **shared**: dinero, sale-math, returns, day-guard (días cerrados no editables), idempotencia por `requestId`.

Relación clave del dinero: `Sale` (total, recibido, crédito) → `SaleLine` (precio/costo históricos) → `StockMove` (salida) → `CashMove` (entrada si hubo pago) → `Customer.debt += credit`. Abono: `CustomerPayment` → `Customer.debt -= amount` (con guarda `debt >= amount`) → `CashMove debt_collect`. Devolución: `SaleReturn` → reduce deuda hasta el crédito restante de la venta y la deuda del cliente; el resto se reembolsa como `CashMove devolucion`.

## 4. Estado del repositorio
- Rama por defecto `main` @ 6f8f5ff. 46 ramas remotas (+ origin/HEAD) (lista completa en `inventario-repo.md`), muchas ya integradas o obsoletas (feat/s2…s5 de 2026-09-17, audit/*, pages-p1…p6).
- PRs recientes: #41 combos (merged 2026-10-26), #38–#40 loop/v1 (merged 2026-10-26), #36 revert de #35 (cerrado), #32/#33 cash-open-lock y portal-ledger-guard.
- **`specs/` no existe en main** → `specs/AUDIT-STRUCTURAL-V1.md` citado en el encargo no está en esta rama (no verificado dónde vive). La documentación está en la raíz: README, API_CONTRACT, BACKEND_ARCHITECTURE, DATABASE, DOMAIN, IDENTITY, M6, MIGRATION, PREFLIGHT, PRODUCCION, PRODUCT_IMAGES.
- Pruebas: 151 archivos `*.test.ts(x)` frontend (vitest), 38 specs backend, 44 archivos e2e Playwright. **Ejecutado por mí**: 18 suites unitarias backend (`jest --testRegex unit-spec`) con Postgres embebido local → **147/147 aprobadas**. No ejecutados: vitest frontend, e2e backend, Playwright (limitación de tiempo; ver D9 del equipo).

## 5. Limitaciones principales (resumen; detalle en findings-inv.md)
1. La deuda del cliente es un **saldo almacenado** (`customers.debt`) mutado por 4 escritores (venta, deuda inicial, abono, devolución) + borrado total; no hay conciliación automática contra los movimientos, aunque el ledger permite reconstruirla.
2. Abonos no se aplican a ventas (`CustomerPayment.saleId` existe pero el backend nunca lo escribe; `Sale.credit` nunca baja con abonos) → no hay "saldo por venta".
3. Sin anulación de venta, sin edición/reverso de abonos: un error se corrige solo con devolución o no se corrige.
4. Un abono offline que el servidor rechaza (p. ej. `ABONO_EXCEEDS_DEBT`) queda en `failed` sin reintento y su efecto local permanece hasta que el usuario lo descarte → posible divergencia local/servidor (hipótesis relevante para el caso real, ver D3).
5. Listas sin paginación (productos, clientes, proveedores, movimientos de caja por rango, ledger completo, stats).
6. Infra free de Render (arranque en frío ~1 min) y migraciones aplicadas automáticamente al arrancar.
