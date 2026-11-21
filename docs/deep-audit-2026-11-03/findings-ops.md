# Hallazgos OPS — Seguridad técnica y operación (fase 10)
SHA auditado: `6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c` (main, 2026-10-26 16:30 -05). Fecha: 2026-11-03 (hora Bogotá, UTC-5).
Escala: CRÍTICA / ALTA / MEDIA / BAJA (BRIEF). Estado de evidencia: demostrado / probable / hipótesis. Rutas relativas al repo.

## OPS-01 · Next.js 16.3.5 con avisos CRÍTICOS en npm audit (dependencia de producción)
- Severidad: ALTA · Categoría: Riesgo de seguridad · Prioridad: P1 · Estado: demostrado (versión vulnerable); explotabilidad en Vercel: hipótesis.
- Evidencia: `package.json` → `"next": "16.3.5"`; `npm audit --omit=dev` (raíz): 1 crítica (next 16.0.0–16.4.0), 7 altas (@serwist/build, @serwist/next, @serwist/webpack-plugin, browserslist, sharp, source-map-js, zod), 2 moderadas (glob, minimatch). Avisos de next: RCE en `next/og ImageResponse`, cache poisoning SSG/ISR, fuga de Draft Mode, fuga en rutas de imagen de metadata.
- Impacto: varios avisos aplican a self-hosting o a funciones que la app quizá no usa (no verificado que use next/og); aun así el framework de producción está en rango vulnerable.
- Recomendación: actualizar next a la versión parcheada (≥16.4.x según el aviso) y @serwist/* en una rama, con build + e2e offline. Riesgo: cambios del SW/precache.

## OPS-02 · Dependencias backend con avisos ALTOS (express/multer/body-parser/prisma)
- Severidad: ALTA · Riesgo de seguridad · P1 · demostrado (versiones); explotabilidad: hipótesis.
- Evidencia: `backend/` `npm audit --omit=dev`: 6 altas (@nestjs/platform-express ≤11.2.5, multer ≤2.4.0, body-parser 2.0.0–2.3.0, prisma/@prisma/config 6.13–7.10, deepmerge-ts) y 1 moderada (qs). Full: 1 crítica solo dev (handlebars, vía @nestjs/cli/jest).
- Impacto: body-parser/qs/multer procesan peticiones públicas (login, portal) → posible DoS por parsing.
- Recomendación: subir @nestjs/platform-express, prisma y transitivas; `npm audit fix` en rama + tests.

## OPS-03 · Sin respaldo propio: solo 6 h de PITR de Neon Free y un "borrar datos" irreversible
- Severidad: ALTA · Riesgo de seguridad/datos · P0 · demostrado.
- Evidencia: Neon Free = historia de restauración 6 h (≤1 GB de cambios), 1 snapshot manual, sin backups programados (https://neon.com/docs/introduction/plans, actualizado 2026-10-23). No hay script/endpoint de export ni backup en el repo (grep "backup|respaldo|export" sin resultados funcionales; `backend/ops` no lo contiene). `DELETE /v1/business/data` (`backend/src/business/business-data.controller.ts:17-21`, servicio `business-data.service.ts:155-179`) hace `deleteMany` de ventas, pagos, deudas, caja, clientes, productos.
- Impacto: un error humano, una migración mala o un borrado detectado después de 6 h = pérdida permanente de deudas y ventas. Ya hubo una migración forzada de BD (Render expiró a los 30 días).
- Recomendación: pg_dump diario cifrado (GitHub Action programada con secreto en Actions, retención 30 días, a almacenamiento externo) + export CSV/JSON por negocio desde la app; antes del wipe, generar export y pedir confirmación escrita; snapshot manual Neon antes de cada deploy con migración.

## OPS-04 · Tokens (refresh 7 días) en localStorage con CSP `script-src 'unsafe-inline'`
- Severidad: ALTA · Riesgo de seguridad · P1 · demostrado (almacenamiento y CSP); explotación: hipótesis (no se encontró XSS).
- Evidencia: `src/data/http/session.ts:3,17,165` (`dulcecalle.auth`, setItem con accessToken+refreshToken); `src/data/http/customer-session.ts:119`; CSP en vivo (`curl -I https://dulcecalle.vercel.app/`): `script-src 'self' 'unsafe-inline'`; justificación en `src/security-headers.ts:4-11`.
- Impacto: cualquier XSS (o extensión/dep comprometida) roba el refresh del dueño y opera 7 días como él (ver OPS-05).
- Recomendación: refresh en cookie HttpOnly+Secure+SameSite=Strict en dominio del API (o BFF en Vercel), access solo en memoria; mantener la CSP sin eval; a medio plazo hashes para el script inline propio.

## OPS-05 · Refresh token sin rotación ni detección de reuso; access no se revoca
- Severidad: MEDIA · Riesgo de seguridad · P2 · demostrado.
- Evidencia: `backend/src/identity/identity.service.ts:101` devuelve el mismo `refreshToken`; `auth-sessions.ts:33` refresh 7d; `app.module.ts:32` access 15m; `jwt.guard.ts:35-45` no consulta `auth_sessions` (solo firma y typ). Positivo: sesiones en tabla con hash sha256, comparación timingSafeEqual, revocación en logout y al cambiar PIN (`catalog.service.ts:542-550`).
- Impacto: token robado vale hasta 7 días sin que nadie lo note; tras logout el access sigue 15 min.
- Recomendación: rotar refresh en cada uso (nuevo sid/hash, revocar el anterior, revocar familia si se reusa); endpoint "cerrar todas las sesiones".

## OPS-06 · Backend sin cabeceras de seguridad y con `x-powered-by: Express`
- Severidad: MEDIA (para API JSON el impacto real es bajo) · Riesgo de seguridad · P3 · demostrado.
- Evidencia: `curl -D - https://dulcecalle-teka369.onrender.com/v1/health` → `x-powered-by: Express`, sin HSTS/nosniff/CSP/X-Frame-Options; no hay helmet en `backend/package.json` ni en `main.ts`.
- Recomendación: `app.disable('x-powered-by')` + helmet con defaults (CSP `default-src 'none'` para JSON).

## OPS-07 · Sin monitoreo ni alertas; cold start medido de 62 s
- Severidad: MEDIA · Rendimiento/Operación · P1 · demostrado.
- Evidencia: medición 2026-11-03 09:47 (Bogotá): `/v1/health` 200 en 62,44 s (frío), luego 0,37/0,17/0,17 s. `render.yaml:4-6` documenta sueño a 15 min. Neon Free escala a cero tras 5 min (doc citada). No hay Sentry/uptime/alertas en el repo (grep sin resultados); el único chequeo es `healthCheckPath: /v1/health` de Render.
- Impacto: primera venta tras inactividad espera ~1 min (la outbox lo amortigua); fallos de sync/500 invisibles para el dueño y el dev.
- Recomendación: ver plan en D-seguridad-tecnica.md §12.

## OPS-08 · Migraciones al arrancar, sin down, una con reescritura de datos
- Severidad: MEDIA · Deuda técnica/Operación · P2 · demostrado.
- Evidencia: `render.yaml:15` `startCommand: npx prisma migrate deploy && node dist/main.js`. 12 migraciones, ninguna reversible automáticamente. Reescritura: `20260920120000_customer_code` (UPDATE backfill + `SET NOT NULL` + índice único). Guardas que pueden abortar arranque: `20261007160000_cash_one_open_guard` (RAISE EXCEPTION si hay >1 caja abierta). `20260923130000` DROP NOT NULL (no destructiva).
- Impacto: una migración que falla deja el servicio sin arrancar (caída total) y sin rollback; en free plan con un solo dyno no hay despliegue azul/verde.
- Recomendación: migrar en paso separado (preDeployCommand o job manual) con snapshot Neon previo; escribir SQL de reversa por migración; probar migraciones contra un branch Neon.

## OPS-09 · CI sin build/lint/typecheck y main sin protección
- Severidad: MEDIA · Deuda técnica · P2 · demostrado.
- Evidencia: `.github/workflows/offline-e2e.yml` jobs `postgres`, `client-postgres`, `backend` (solo tests); `gh api repos/teka369/dulcecalle/branches/main/protection` → 404 "Branch not protected". autoDeploy true (`render.yaml`).
- Impacto: un push que rompe el build o los tests llega igual a producción (Vercel y Render despliegan solos).
- Recomendación: job `next build` + `nest build` + eslint + `npm audit --omit=dev --audit-level=high`; checks requeridos en main.

## OPS-10 · PIN de portal de 6 dígitos sin bloqueo por cliente ante ataque distribuido
- Severidad: MEDIA · Riesgo de seguridad · P3 · demostrado (diseño); probabilidad: baja.
- Evidencia: `customer-access.dto.ts:9` `/^\d{6}$/`; bcrypt cost 12 (`catalog.service.ts:541`); límites por IP+código e IP (`portal-throttle.ts` take/IP_CODE_POLICY, 5 intentos/15 min) y `@Throttle 10/min` (`customer-access.controller.ts:15`); por código solo retraso suave ≤4 s y alerta en log (`portal-throttle.ts:20`, `customer-access.service.ts:147`). Diseño explícito para no bloquear al cliente legítimo.
- Impacto: con muchas IPs (IPv6/proxies) el espacio de 10^6 es atacable; el portal solo expone deuda/historial propios (lectura).
- Recomendación: tope duro por código/día con desbloqueo por el dueño, o PIN más largo/alfanumérico; alerta visible al dueño, no solo log.

## OPS-11 · Pérdida de dispositivo: la outbox no sincronizada se pierde
- Severidad: MEDIA · Riesgo de datos · P2 · probable.
- Evidencia: datos offline en IndexedDB (Dexie, `src/data/local/outbox.ts`, `db.ts`); `navigator.storage.persist()` solo por acción explícita (`src/data/pwa/origin-storage.ts:3,132`). No hay copia fuera del dispositivo de lo no sincronizado.
- Impacto: ventas/abonos hechos offline y no sincronizados desaparecen con el teléfono; puede explicar "pagué pero sigue la deuda" si el abono quedó en un dispositivo perdido o limpiado.
- Recomendación: indicador permanente de "N operaciones sin enviar" y antigüedad, pedir persist() al iniciar sesión, export local de la outbox.

## OPS-12 · `qty` sin máximo en DTOs de venta/devolución
- Severidad: BAJA · Bug potencial · P3 · hipótesis.
- Evidencia: `backend/src/sales/sales.dto.ts:24-26` (`@IsInt() @Min(1)` sin `@Max`); `money.ts:39-44` `copToJson` lanza si excede MAX_SAFE_INTEGER. El tope de importe (`MAX_COP_AMOUNT`, `money.ts:9`) aplica a precios, no a qty×precio. El control de stock probablemente lo frena (no probado).
- Recomendación: `@Max` razonable en qty y validar total ≤ tope antes de escribir.

## OPS-13 · Listados sin paginar y estadísticas en memoria
- Severidad: BAJA · Rendimiento · P4 · demostrado.
- Evidencia: `catalog.service.ts:182-189` (productos), `:516-521` (clientes), `:574-590` (libro por cliente carga todas las ventas+líneas+devoluciones), `stats.service.ts:27-60` (findMany por rango y suma en JS). Índices adecuados existen (`schema.prisma:147,174,231-232,324-325,382,422,444-445`).
- Impacto: aceptable para un puesto; crece lineal con el historial.
- Recomendación: agregados SQL (`groupBy/sum`) en stats; paginar libro de cliente.

## OPS-14 · Reintento idempotente no compara el cuerpo
- Severidad: BAJA · Riesgo financiero menor · P3 · demostrado.
- Evidencia: `sales.service.ts:103-107` devuelve la venta existente por `(businessId, requestId)` sin comparar payload (igual en devoluciones `:371-375`, pagos `cash.service.ts:344`).
- Impacto: un bug cliente que reuse la clave con otro contenido devuelve éxito silencioso y la segunda operación no se registra.
- Recomendación: guardar hash del payload y responder 409 si difiere.

## OPS-15 · Enumeración de correos por tiempo en login del dueño
- Severidad: BAJA · Riesgo de seguridad · P4 · demostrado (código).
- Evidencia: `identity.service.ts:69-72` responde sin bcrypt si el usuario no existe. Mitigado por `@Throttle 10/min` (`identity.controller.ts:14`).
- Recomendación: compare contra hash dummy (como ya hace el portal).

## OPS-16 · Logs: código de cliente en alertas y excepción completa en 500
- Severidad: BAJA · Exposición de información · P4 · demostrado.
- Evidencia: `customer-access.service.ts:147-149` loguea `code=` y id de cliente; `http-error.filter.ts:76` `log.error(exception)` (stack en logs de Render, no en respuesta). La respuesta nunca incluye stack (`http-error.filter.ts:90`). No se loguean contraseñas, PIN ni tokens (revisado).
- Recomendación: aceptable; documentar retención de logs.

## OPS-17 · CORS acepta cualquier preview del equipo con credenciales
- Severidad: BAJA · Riesgo de seguridad · P4 · demostrado.
- Evidencia: `backend/src/http-setup.ts:23` regex `dulcecalle-*-teka369s-projects.vercel.app`; en vivo OPTIONS con Origin prod → 204 con ACAO; Origin `https://evil.example` → 404 sin ACAO; `http://localhost:3000` → sin ACAO (prod).
- Impacto: código no revisado de una rama preview puede hablar con el API de producción usando tokens de producción del navegador del dueño (orígenes distintos no comparten localStorage, lo que limita el riesgo).
- Recomendación: apuntar previews a un backend/branch Neon de staging.

## OPS-18 · Precio unitario enviado por el cliente se acepta (por diseño)
- Severidad: BAJA · Riesgo financiero · P4 · demostrado.
- Evidencia: `backend/src/shared/sale-math.ts:43-51` `resolveUnitPrice` usa `unitPrice` del cliente si viene (0..100M); total sí se recalcula en servidor (`sales.service.ts:187-189`).
- Impacto: solo el dueño autenticado vende; precio editable es función de negocio, pero no queda marca de "precio modificado" vs catálogo (no verificado si existe campo).
- Recomendación: guardar `catalogPrice` junto a `unitPrice` para auditoría.
