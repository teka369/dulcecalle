# Hallazgos — Investigador · main 6f8f5ff
Formato BRIEF. "demostrado" = visto en código en esta SHA; "probable"/"hipótesis" = requiere prueba. Ninguna prueba contra producción.

## Re-chequeo de hallazgos de loop-v1 (investigador.md)
| Hallazgo previo | Estado en 6f8f5ff | Evidencia |
|---|---|---|
| CORS regex `dulcecalle-*.vercel.app` + credentials | **Corregido**: regex limitada a `dulcecalle-[a-z0-9-]+-teka369s-projects.vercel.app`; credentials sigue true | backend/src/http-setup.ts:21-34,48 |
| Throttler por IP del proxy (sin trust proxy) | **Corregido en código**: `trust proxy` = 1 (configurable) | http-setup.ts:14-18,39. Efecto real en Render **no verificado** |
| Lockout de portal por códigos secuenciales | **Mitigado**: throttles por ip+código y por tienda; contador global solo alerta | customer-access.service.ts:96-150 |
| Login portal sin businessId hace bcrypt sobre todas las tiendas | **Corregido**: 1 bcrypt por intento, take 2 / 50 | customer-access.service.ts:76-142 |
| Faltan headers de seguridad frontend | **Corregido**: CSP + headers en next.config | src/security-headers.ts, next.config.ts:36-39 |
| findMany sin límite | **Sigue presente** (ver INV-07) | — |
| LCP 4.7 s | **No re-medido** | — |

## Hallazgos

### INV-01 · Abono offline rechazado deja deuda local reducida (divergencia local/servidor)
Severidad ALTA · Riesgo financiero / Inconsistencia de datos · Archivos: src/data/pwa/offline-payments.ts:23-80, src/data/local/outbox.ts:538-556, outbox-cleanup.ts:127-143, backend/src/cash/cash.service.ts:392-404 · Flujo: abono (F13), offline (F33).
Descripción: el abono offline se valida contra la deuda **local** y aplica efecto optimista. Si el servidor lo rechaza con error no reintentable (p. ej. `ABONO_EXCEEDS_DEBT` porque la deuda servidor es menor, o día cerrado), queda `failed` con `nextAttemptAt=null`; el efecto local sólo se revierte si el usuario lo descarta. Hasta entonces el teléfono muestra un saldo distinto del servidor/portal.
Consecuencia: el dueño puede creer que registró un pago que el servidor nunca aceptó, y el portal del cliente seguiría mostrando la deuda → **hipótesis plausible para el caso real** (no demostrada sin datos).
Probabilidad: no cuantificable sin datos. Solución: aviso persistente y bloqueante en ficha de cliente cuando hay operaciones `failed` que tocan su deuda; distinguir visualmente "registrado localmente" vs "aceptado". Riesgos: ruido de UX. Prioridad P1 · Evidencia: **demostrado (mecanismo)** / hipótesis (como causa del caso).

### INV-02 · Abonos no se aplican a ventas; `Sale.credit` nunca baja; columna `customer_payments.sale_id` muerta
Severidad ALTA · Falta de funcionalidad / Inconsistencia de datos · schema.prisma (CustomerPayment.saleId), cash.service.ts:378-390 (no escribe saleId), DOMAIN.md:281.
No existe "saldo por venta"; el portal muestra el `credit` original de cada compra aunque ya se haya abonado: `src/app/cliente/compras/[id]/page.tsx:61-72` pinta "Quedó a crédito $X" en tono `danger` y la lista `/cliente/compras` (page.tsx:58, `src/components/customer/portal.ts:53-61`) etiqueta "A crédito"/"Venta parcial" para siempre. **Relevante para el caso real**: una compra ya pagada sigue apareciendo como a crédito (aunque la deuda total sí baje). Las devoluciones calculan deuda reducible con el crédito original de la venta (sales.service.ts:403-460) sin saber si se pagó.
Consecuencia: discusiones "ya pagué esa compra"; trazabilidad débil. Solución: asignación FIFO de abonos a obligaciones (tabla de aplicación), o al menos mostrar saldo agregado y no por compra. Riesgos: migración de histórico. P1 · **demostrado**.

### INV-03 · Deuda del cliente es saldo almacenado sin conciliación automática
Severidad ALTA · Riesgo financiero · Escritores de `customers.debt`: sales.service.ts:299 (+credit), catalog.service.ts:718 (+deuda inicial), cash.service.ts:392 (−abono), sales.service.ts:553 (−devolución), business-data.service.ts (borrado total), catalog.service.ts:497 (creación 0). Lectores: ledger, portal, stats.
Ningún job/endpoint verifica debt = Σinitials + Σcredit − Σpayments − ΣdebtReduced. Los cuatro escritores están en transacciones con guardas (`debt>=amount`), lo que reduce el riesgo, pero cualquier deriva (import legacy `legacyDexieId`, fallo manual) quedaría oculta. Solución: verificación de invariante (consulta SQL de solo lectura + alerta). P1 · **demostrado** (ausencia de conciliación).

### INV-04 · No se puede anular una venta ni revertir/editar un abono o gasto
Severidad ALTA · Falta de funcionalidad · Sin endpoints (grep). Venta equivocada → solo devolución (que mueve caja/stock como devolución real). Abono mal registrado (monto o cliente) → sin corrección posible salvo borrado total del negocio. P1 · **demostrado**.

### INV-05 · Cierre de caja modo "assumed" fija diferencia 0
Severidad MEDIA · Riesgo financiero · backend/src/cash/cash-manager.service.ts:302-323. Al cerrar cajas pendientes como "asumidas", `closingCount=expected` y `difference=0n` con nota; un faltante real desaparece de los reportes de diferencias. Solución: guardar diferencia como `null` ("no contada") en vez de 0 y excluir de totales. P2 · **demostrado**.

### INV-06 · Borrado total del negocio sin backup/exportación previa
Severidad MEDIA · Riesgo de datos · backend/src/business/business-data.service.ts:37-160, `DELETE /v1/business/data` (owner). Irreversible, sin exportación en la app. P2 · **demostrado**.

### INV-07 · Listados y agregados sin límite (persiste de loop-v1)
Severidad MEDIA · Rendimiento · catalog.service.ts:182 (products), :516 (customers), :962 (suppliers), :576-590 (ledger completo con líneas y devoluciones), :485 (lee todos los códigos para generar uno), cash.service.ts:312 (moves por rango), stats.service.ts:27-60 (todo el rango en memoria). Con Render free, rangos largos pueden agotar memoria/tiempo. P3 · **demostrado** (código); impacto **hipótesis**.

### INV-08 · Rol staff sin alta; todo usuario de un negocio es owner de facto
Severidad MEDIA · Falta de funcionalidad · auth.types.ts:6, roles.guard.ts, solo 2 endpoints `@Roles("owner")`. No hay trazabilidad de "quién" registró cada operación (ninguna tabla de movimientos guarda userId). P2 · **demostrado**.

### INV-09 · Override de precio de venta sin motivo ni registro diferenciado
Severidad BAJA · Riesgo financiero · shared/sale-math.ts:44-52; SaleLine guarda unitPrice pero no el precio de catálogo ni motivo. Descuentos/errores indistinguibles. P3 · **demostrado**.

### INV-10 · API_CONTRACT.md desactualizado (21 de 62 endpoints) y docs con rutas sin prefijo
Severidad BAJA · Deuda técnica · API_CONTRACT.md, BACKEND_ARCHITECTURE.md (`GET /health` vs `/v1/health`). P3 · **demostrado**.

### INV-11 · `specs/AUDIT-STRUCTURAL-V1.md` ausente en main
Severidad BAJA · Deuda técnica (documentación) · `ls specs` → no existe. La auditoría estructural previa no está versionada en main (puede estar en otra rama; no verificado). P4 · **demostrado**.

### INV-12 · `customer-access/refresh` sin throttle específico
Severidad BAJA · Riesgo de seguridad · customer-access.controller.ts:22-26 (solo límite global 120/min). Token de refresh largo y aleatorio → riesgo bajo. P4 · **demostrado**.

### INV-13 · CORS con `credentials: true` y previews del equipo permitidos en producción
Severidad BAJA · Riesgo de seguridad · http-setup.ts:23,33,48. Cualquier preview de Vercel del equipo (incluidas ramas no revisadas) puede hacer peticiones con credenciales a la API de producción. La autenticación usa Bearer (no cookies; no verificado exhaustivamente), lo que reduce el impacto. P3 · **probable**.

### INV-14 · Migraciones aplicadas automáticamente en cada arranque de producción
Severidad BAJA · Riesgo operativo · render.yaml `startCommand: npx prisma migrate deploy && node dist/main.js`, `autoDeploy: true`. Un merge a main con migración defectuosa se aplica a Neon sin paso manual. P3 · **demostrado** (config).

### INV-15 · Consumo propio/regalo/pérdida no se valorizan en dinero
Severidad BAJA · Falta de funcionalidad · `POST products/:id/shrink` solo StockMove (unitCost guardado, sin CashMove/Expense). Correcto para caja, pero las estadísticas deben restarlo de utilidad (no verificado en stats). P3 · **probable**.

### INV-16 · Sin recuperación de contraseña del dueño
Severidad BAJA · Falta de funcionalidad · identity.controller.ts (sin endpoint). Pérdida de contraseña = pérdida de acceso. P3 · **demostrado**.

## Conteo
CRÍTICA 0 · ALTA 4 (INV-01..04) · MEDIA 4 (INV-05..08) · BAJA 8 (INV-09..16). Total 16.
No encontré evidencia de CRÍTICA (p. ej. doble cobro o deuda reducida sin pago demostrados); eso no significa que no existan: no ejecuté e2e ni pruebas de concurrencia.
