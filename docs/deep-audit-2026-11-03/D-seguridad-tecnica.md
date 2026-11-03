# D — Seguridad técnica y operación (fase 10, rol OPS)
- Repo: teka369/dulcecalle, rama main, SHA **6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c** (commit 2026-10-26 16:30 -05). Clon: `/workspace/deep-audit/ops/dulcecalle`.
- Fecha: 2026-11-03, 09:45–10:10 (hora Bogotá, UTC-5).
- Método: lectura de código (grep/sed con file:line), `npm audit` (raíz y backend, prod y full), `gh api` de solo lectura, y en producción solo GET/HEAD/OPTIONS con curl. **No** se tocó Neon (ni lectura SQL: el esquema se tomó de `backend/prisma/schema.prisma` y migraciones). No se hicieron POST, logins ni pruebas de carga. No se escribieron secretos.
- Hallazgos detallados: `findings-ops.md` (OPS-01…OPS-18). Escala del BRIEF.

## 1. Seguridad de sesión
- **JWT**: access 15 min (`backend/src/app.module.ts:32`), refresh 7 días (`identity/auth-sessions.ts:33`), secretos `JWT_SECRET`/`JWT_REFRESH_SECRET` obligatorios sin fallback (`identity/jwt-secrets.ts`, llamado en `main.ts` y en el módulo) — fail-closed. HECHO.
- Tabla `auth_sessions` (`schema.prisma:542-553`): hash sha256 del refresh, `revokedAt`, `expiresAt`; verificación con `timingSafeEqual` (`auth-sessions.ts` verify). Logout revoca solo la sesión presentada; cambio de PIN revoca sesiones del cliente (`catalog.service.ts:542-550`).
- **Debilidades**: sin rotación del refresh (`identity.service.ts:101`) → OPS-05; el guard de access no consulta la tabla (`jwt.guard.ts:35-45`). Owner y cliente comparten secreto de access, separados por claim `typ` (el guard rechaza `customer`, `refresh`, `customer_refresh`: `jwt.guard.ts:41`) — correcto pero frágil.
- **Almacenamiento en la PWA**: localStorage (`src/data/http/session.ts:17,165`, `customer-session.ts:119`) + CSP con `'unsafe-inline'` → OPS-04 (ALTA).
- **PIN de portal**: 6 dígitos (`customer-access.dto.ts:9`), bcrypt 12, un solo compare por intento con hash dummy, sin enumeración; límites por IP+código y por IP con lock consultivo en Postgres (`portal-throttle.ts`), retraso suave por código (≤4 s) y alerta en log; usa `@Ip()` con `trust proxy` (`customer-access.controller.ts:17`, `http-setup.ts` trustProxyHops por defecto 1) y degrada a por-código si la IP parece privada. Sin bloqueo duro por cliente → OPS-10.
- **Throttling**: global 120/min (`app.module.ts:37`, confirmado en vivo `x-ratelimit-limit: 120`); login dueño y portal 10/min; escrituras 30/min. **DISABLE_THROTTLE ya tiene guarda**: `http-setup.ts:54` solo se honra si `NODE_ENV !== "production"` — hecho previo CORREGIDO. Nota: el storage del throttler es en memoria (una instancia; se resetea en cada reinicio/cold start).
- Registro: no existe ruta `auth/register` en `identity.controller.ts` (solo login/refresh/logout/me/businesses); `IdentityService.register` es código muerto expuesto a nada. `POST /v1/businesses` permite a un usuario autenticado crear negocios (no es escalada).

## 2. Control de acceso
- Guards globales en orden: JwtAuthGuard → BusinessGuard → RolesGuard → ThrottlerGuard (`app.module.ts:53-56`). BusinessGuard exige `X-Business-Id` y membresía `(businessId,userId)` (`tenancy/business.guard.ts:39-55`); el negocio sale del contexto, nunca del cuerpo.
- `@Public`: health, auth/login, auth/refresh, customer-access/login|refresh, y rutas de portal que añaden `@UseGuards(CustomerJwtGuard)`. `@SkipBusiness`: solo me/businesses/logout del dueño (`identity.controller.ts:27-45`). Ningún otro endpoint queda sin protección (grep de decoradores).
- **IDOR**: se revisaron todos los `findUnique/update/delete` (grep completo). Patrón constante: `findFirst({ id, businessId })` y luego `update({ where: { id } })` (p.ej. `catalog.service.ts:218-242,258-262,536-543`, `cash.service.ts:202-228`, `media.service.ts:299-310,361-373`); reordenar imágenes valida el conjunto contra el negocio antes de actualizar (`media.service.ts:325-342`); `sales.service.ts:138-141` valida cliente del negocio antes de `customer.update` (`:297`). Idempotencia siempre por clave compuesta `businessId_requestId`. **No se encontró IDOR.** Riesgo residual: patrón check-then-update fuera de la misma transacción en algunos casos (no explotable entre negocios porque el id es UUID ya validado).
- Portal: CustomerJwtGuard re-lee el cliente con `id + businessId` y rechaza archivados (`customer.guard.ts:48-52`); servicio consulta por `customerAuth` (tests `portal-ledger-scope.unit-spec.ts`). No se halló forma de ver otros clientes.
- Rol owner para `DELETE /v1/business/data` (`business-data.controller.ts:17`).

## 3. Validación del servidor
- ValidationPipe global `whitelist`, `forbidNonWhitelisted`, `transform`, `enableImplicitConversion` (`main.ts`). DTOs con class-validator; montos `@IsInt @Min(0|1) @Max(MAX_COP_AMOUNT=100.000.000)` (`shared/money.ts:9`, `sales.dto.ts:29-31,49-51,68-70`). Montos negativos rechazados.
- El total se recalcula en servidor desde el precio de catálogo, salvo override explícito `unitPrice` (`sale-math.ts:43-51`, `sales.service.ts:187-189`) → OPS-18. Abono > saldo rechazado (`ABONO_EXCEEDS_DEBT`), devolución > vendido rechazada.
- BigInt: COP como bigint, serialización con verificación de entero seguro (`money.ts:39-44`, `shared/bigint.ts`). `qty` sin tope → OPS-12.

## 4. Exposición de información
- Filtro global (`shared/http/http-error.filter.ts`): respuesta `{error:{code,message}}` sin stack; Prisma P2023/P2025/validación mapeados a 400/404. Excepciones desconocidas se loguean completas (`:76`). Log estructurado con userId/businessId/idempotency-key, sin PII sensible. Alerta de portal loguea código de cliente (OPS-16).
- En vivo: `x-powered-by: Express`, sin cabeceras de seguridad (OPS-06). `/v1/health` responde `{"ok":true,"db":"up"}` (aceptable). `/v1/diag/ip` → **404** (eliminado, confirmado). `/v1/sales` sin token → 401 `UNAUTHORIZED`.

## 5. CORS y CSP (en vivo, 2026-11-03 ~09:47 Bogotá)
| Prueba | Resultado |
|---|---|
| OPTIONS `/v1/sales` Origin `https://dulcecalle.vercel.app` | 204, `access-control-allow-origin` = prod, credentials true, headers `Authorization,Content-Type,Idempotency-Key,X-Business-Id` |
| OPTIONS `/v1/health` Origin `https://evil.example` | 404, sin ACAO (bloqueado) |
| GET Origin `http://localhost:3000` | sin ACAO (localhost bloqueado en prod) |
- Previews del equipo permitidas por regex (`http-setup.ts:23`) → OPS-17. `CORS_ORIGIN` añade orígenes extra.
- Vercel (HEAD `/`): CSP `default-src 'self'; script-src 'self' 'unsafe-inline'; … object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, `x-frame-options: DENY`, `nosniff`, `referrer-policy: strict-origin-when-cross-origin`, HSTS 2 años preload. Debilidad: `'unsafe-inline'` en script-src (decisión documentada en `src/security-headers.ts:4-11`) — no protege contra XSS inyectado; combinado con tokens en localStorage → OPS-04. Nota: `access-control-allow-origin: *` en el HTML estático de Vercel (inocuo para contenido público).

## 6. Secretos y variables
- Backend lee: `DATABASE_URL` (Prisma), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN`, `PORT`, `NODE_ENV`, `TRUST_PROXY_HOPS`, `DISABLE_THROTTLE`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Frontend: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DATA_BACKEND`, `NODE_ENV`. Vercel tiene además `DATABASE_URL`/`DATABASE_URL_UNPOOLED` (integración Neon) que el frontend **no usa** (grep) — exposición innecesaria del secreto de BD en otro proveedor (BAJA, recomendación: quitar la integración del proyecto Vercel si no se usa; no verificado por MCP en esta fase).
- `render.yaml`: JWT con `generateValue`, `DATABASE_URL sync:false` (sin valor). `backend/.env.example` solo valores locales de ejemplo. Único `.env*` versionado: `backend/.env.example`.
- Escaneo ligero de historial (476 commits, `git log -p --all -G` con patrones AKIA/sk_live/ghp_/URL Neon con contraseña/clave privada/api_secret): **sin coincidencias**. No es un escaneo exhaustivo (no se usó gitleaks/trufflehog).

## 7. Dependencias (`npm audit`, 2026-11-03)
| Ámbito | Crítica | Alta | Moderada | Baja |
|---|---|---|---|---|
| raíz `--omit=dev` | 1 (next) | 7 (@serwist/build, @serwist/next, @serwist/webpack-plugin, browserslist, sharp, source-map-js, zod) | 2 (glob, minimatch) | 0 |
| raíz completo | 3 (next, vitest, tinypool) | 8 (+vite) | 18 (eslint/typescript-eslint, @vitest/mocker…) | 0 |
| backend `--omit=dev` | 0 | 6 (@nestjs/platform-express, multer, body-parser, prisma, @prisma/config, deepmerge-ts) | 1 (qs) | 0 |
| backend completo | 1 (handlebars, dev) | 6 | 30 (jest, @nestjs/cli, ts-jest, fast-uri…) | 3 |
Todas con fix disponible. → OPS-01, OPS-02.

## 8. Migraciones Prisma
12 migraciones (`backend/prisma/migrations`): init, customer_code, customer_supplier_request_id, cash_session_request_id, product_images, preparations, preparation_pending_cost, portal_pin_and_sessions, cash_pending_manager, cash_continuity, cash_one_open_guard, product_kind.
- Aditivas (seguras): la mayoría (CREATE TABLE/INDEX, ADD COLUMN con DEFAULT).
- Reescritura de datos: `20260920120000_customer_code` (UPDATE de backfill + `SET NOT NULL` + UNIQUE).
- Relaja restricción: `20260923130000` (`unit_cost DROP NOT NULL`).
- Guarda que aborta: `20261007160000_cash_one_open_guard` (RAISE si >1 caja abierta, luego índice único parcial).
- Ningún DROP TABLE/COLUMN. No hay migraciones "down" (Prisma no las soporta). `migrate deploy` corre en cada arranque (`render.yaml:15`) → OPS-08.

## 9. Índices y rendimiento
Índices compuestos por `businessId` en todas las tablas de negocio: ventas `(businessId,occurredOn)`, `(businessId,customerId)`; stock moves `(businessId,occurredOn)`, `(businessId,productId,createdAt)`; pagos, gastos, cash moves por fecha; `(businessId,debt)` en clientes (`schema.prisma:145-537`). Cubren las consultas calientes. No se observó N+1 (relaciones con `include`). Listados de productos/clientes y libro de cliente sin paginar; stats suma en JS → OPS-13. Sin `EXPLAIN` sobre datos reales (no se consultó Neon).

## 10. Cold start y PWA
- `/v1/health` 2026-11-03 ~09:46 Bogotá: **62,44 s** (frío), 0,37 s, 0,17 s, 0,17 s. Peor que los ~42 s previos. Render Free duerme tras 15 min (`render.yaml:5`); Neon Free suspende a los 5 min.
- Service worker en vivo `/sw.js` 51.602 B, ~26 entradas de precache detectadas (conteo aproximado por regex), `skipWaiting` + `clientsClaim` (activación inmediata de nuevas versiones), `navigationPreload`, `NetworkFirst` para navegación; `reloadOnOnline:false` (`next.config.ts`). Revisión de precache = SHA de git. Riesgo: skipWaiting puede mezclar assets de versiones durante una actualización (hipótesis, no reproducido). No se midió el peso total de primera carga (no verificable sin navegador instrumentado en esta fase).

## 11. Backups y recuperación (Neon Free)
Fuente: https://neon.com/docs/introduction/plans (actualizado 2026-10-23): Free = restauración instantánea (PITR) hasta **6 horas** limitada a 1 GB de cambios, **1 snapshot manual**, backups programados no disponibles, 10 ramas/proyecto, 1 GB de almacenamiento, 100 CU-h/mes (si se agotan, el compute se suspende hasta el siguiente ciclo), monitoreo 1 día, sin SLA.
- En el repo: no existe backup/export a nivel de app (`backend/ops`, `backend/migration` son de migración inicial, no de respaldo). Existe un borrado total por negocio (`DELETE /v1/business/data`). → OPS-03 (P0).
- Dispositivo perdido: lo no sincronizado en la outbox Dexie se pierde; lo sincronizado se recupera desde el servidor al iniciar sesión en otro dispositivo. → OPS-11.

## 12. Monitoreo y alertas
Existe: health de Render (`/v1/health` con ping a BD), logs de Render/Vercel, logs estructurados del filtro de errores, alerta en log por PIN fallidos. Falta: monitor externo de uptime, tracking de errores (frontend y backend), alertas de cuota Neon (CU-h/almacenamiento), alerta de fallos de sync de outbox, alertas de despliegue fallido.
**Plan concreto**: (1) UptimeRobot/Better Stack gratis sobre `/v1/health` cada 5 min con alerta a correo/Telegram (también mitiga el sueño en horario de venta; ojo: consume horas de Render free y CU-h de Neon — limitar a horario de atención). (2) Sentry free en Next y Nest (sin PII, `beforeSend` que quite tokens). (3) Revisión semanal del panel de uso de Neon y alerta manual al 80 % de CU-h/almacenamiento. (4) Notificaciones de deploy fallido de Render/Vercel al correo. (5) En la app, contador visible de operaciones pendientes/rechazadas en la outbox.

## 13. Idempotencia financiera
- Todos los POST que mueven dinero o stock exigen `Idempotency-Key` UUID y, si el cuerpo trae `requestId`, debe coincidir (`shared/idempotency.ts`, controladores sales/cash/catalog/media).
- Restricciones únicas `@@unique([businessId, requestId])` en: Sale, SaleReturn, StockMove, CashSession (+`closeRequestId`), CashMove, CashCarry, Expense, CustomerPayment, InitialDebt, Preparation, ProductImage, Product, Customer, Supplier (`schema.prisma`). `requestId` es nullable salvo en CashCarry, pero los controladores siempre lo rellenan desde la cabecera.
- Carreras: lectura previa + transacción con lock consultivo por negocio + captura de P2002 y relectura (`sales.service.ts:311`, `:574`; 14 sitios con P2002). Un POST reintentado devuelve el mismo registro: **no hay doble cobro ni doble movimiento de stock** por reintento con la misma clave (demostrado por código; no se ejecutaron tests en esta fase).
- Modelos que mueven dinero sin requestId propio: SaleLine y SaleReturnLine (hijas, se crean en la misma transacción del padre — sin riesgo). Ninguno de los modelos de primer nivel carece de la restricción.
- Debilidad: no se compara el payload en el replay → OPS-14. Además las operaciones de corrección (PATCH productos/clientes/proveedores, PIN, wipe) no son idempotentes por clave, pero son idempotentes por naturaleza.

## Lista priorizada de remediación
1. **P0** OPS-03: backup diario externo (pg_dump) + export por negocio; snapshot antes de migraciones; confirmar/exportar antes del wipe.
2. **P1** OPS-01/OPS-02: actualizar next, @serwist, @nestjs/platform-express, prisma; añadir `npm audit --audit-level=high` en CI.
3. **P1** OPS-04: sacar el refresh de localStorage (cookie HttpOnly) y endurecer CSP.
4. **P1** OPS-07: uptime monitor + Sentry + alertas de cuota.
5. **P2** OPS-05: rotación de refresh con detección de reuso.
6. **P2** OPS-08/OPS-09: migraciones fuera del arranque, CI con build/lint, protección de main.
7. **P2** OPS-11: indicador de pendientes y persist() de almacenamiento.
8. **P3** OPS-06, OPS-10, OPS-12, OPS-14.
9. **P4** OPS-13, OPS-15, OPS-16, OPS-17, OPS-18; quitar `DATABASE_URL` de Vercel si no se usa.

## Limitaciones / no verificable
- Explotabilidad real de los avisos de next/express en este despliegue: no verificada (requiere pruebas activas no permitidas).
- Uso de `next/og` y peso total de primera carga: no medidos.
- Integración Neon en Vercel: no se consultó el MCP de Vercel (se tomó el dato del contexto); no confirmado por mí.
- Rendimiento con datos reales (EXPLAIN): no ejecutado para no tocar Neon.
- No se ejecutaron suites de tests en esta fase (solo análisis estático + audit + curl).
