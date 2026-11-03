# D6 — Funcionalidades faltantes (fase de descubrimiento)
Base: `teka369/dulcecalle@6f8f5ff1f3c1`. Solo lectura. Lente: consultor de pequeño comercio callejero (un cajón, Efectivo+Nequi, fiado de confianza, celular barato, señal intermitente).
Complejidad: B/M/A. Valor: B/M/A. Estado de evidencia: [HECHO] verificado en código, [HIPÓTESIS] inferido.

## Ya existe (no reinventar)
Alerta de stock bajo por producto (`Product.lowStockAt`, `schema.prisma:126`; UI `src/app/ventas/nueva/page.tsx:156`) · proveedores y surtidas (`catalog.controller.ts:216-247`) · estadísticas (`stats.controller.ts:11`) · roles owner/staff (`identity/auth.types.ts:6`) · portal cliente con ledger (`customer-access.service.ts:271`) · idempotencia + outbox offline (`src/data/local/outbox.ts:29`) · candado de día cerrado (`shared/day-guard.ts`) · precio y costo históricos en la línea (`SaleLine.unitPrice/unitCost`, `schema.prisma:236-256`).

## Faltantes
| # | Funcionalidad | Problema real del vendedor | Evidencia | Valor | Compl. | Veredicto |
|---|---|---|---|---|---|---|
| F1 | **Reconciliación de deuda** (saldo almacenado vs Σ movimientos) con alerta | "El cliente dice que pagó y la app sigue cobrando": no hay forma de saber si `customer.debt` está bien | `debt` es contador (`schema.prisma:157`) con 4 escritores: `sales.service.ts:299,555`, `cash.service.ts:394`, `catalog.service.ts:718`; no hay chequeo [HECHO] | A | B | **Hacer** |
| F2 | **Historial por cliente con saldo corrido** y comprobante compartible | Cliente niega deuda / dueño necesita mostrar de dónde sale el número | Ledger devuelve listas separadas sin saldo corrido (`catalog.service.ts:569-650`) | A | B | **Hacer** (ver D4) |
| F3 | **Comprobante + confirmación del cliente** | Discusiones de fiado; demostrar deuda saldada | No existe entidad (ver D4 §0) | A | M | **Hacer MVP D4** |
| F4 | **Anular / reversar venta o abono** sin borrar | Venta equivocada o abono mal digitado hoy no tiene salida limpia (solo devolución) | Sin endpoints de anulación (`sales.controller.ts:14-52`, `cash.controller.ts:176`) [HECHO] | A | M | **Hacer** |
| F5 | **Aviso visible de no sincronizado / rechazado + bitácora de descartados** | Vende sin señal, la op falla al sincronizar y nadie se entera; `discard` borra el efecto local | `outbox.ts:192-245`, `outbox-cleanup.ts`; producto.md 2.1 | A | B | **Hacer** |
| F6 | Nota del abono visible al cliente y número de venta legible | "¿Cuál abono?" / "¿qué venta?" | Portal omite `note` de pagos (`customer-access.service.ts:333-339`); venta solo UUID (`schema.prisma:209`) | M | B | **Hacer** |
| F7 | Exportar (CSV) ventas/deudas/caja + respaldo | Pérdida de confianza en la nube, contador, cierre de mes | No hay exportación en `src/app` (solo tests usan Blob) [HECHO por grep] | M | B | **Hacer** (CSV simple) |
| F8 | Imputación de abonos a ventas (FIFO derivado) | "¿Ya pagué la del martes?" | `CustomerPayment.saleId` (`schema.prisma:432`) siempre `null` (`offline-payments.ts:81`) | M | M | **Después** (derivado primero, tabla después) |
| F9 | Vencimiento del fiado + recordatorio por WhatsApp (link manual) | Cobrar a tiempo sin incomodar | No hay `dueDate` en `Sale`/`InitialDebt` | M | B | **Después** |
| F10 | Bitácora de cambios (patch producto/cliente: precio, nombre, PIN) | "¿Quién cambió el precio?" con dos usuarios | Patch sin historial (`catalog.service.ts:217,652`); staff existe | M | M | **Después** |
| F11 | Recuperación por pérdida de dispositivo / cierre de sesión con pendientes | Pendientes del outbox se pierden con el celular | Outbox solo local (Dexie) [HIPÓTESIS sobre ausencia de aviso al salir] | A | M | **Después** (aviso al cerrar sesión: hacer ya) |
| F12 | Rentabilidad por producto / top ventas | Saber qué conviene surtir | Datos existen (`unitCost` en línea); verificar cobertura de `stats.service.ts` | M | B | **Después** |
| F13 | Control de dos operaciones simultáneas multi-dispositivo (aviso de conflicto) | Dos personas cobrando el mismo fiado | Lock por negocio (`day-guard.ts:45`) evita corrupción; sin UX de conflicto | B | M | **Después** |
| F14 | Predicción de agotamiento, análisis de clientes, scoring | — | — | B | A | **No hacer** |
| F15 | Vencimientos/lotes de producto | Dulces sí vencen, pero el volumen es bajo | No hay campos (`schema.prisma`) | B | A | **No hacer** (por ahora) |
| F16 | Cuentas por pagar a proveedores | Fuera de alcance v1 | README Limitaciones, producto.md 3.7 | B | M | **No hacer** |
| F17 | OTP SMS, firma, foto del cliente | Costo/privacidad > valor | D4 §3 | B | M-A | **No hacer** |

## Valor real vs complejidad innecesaria
- Lo que más protege dinero es barato: F1, F5, F6, F2 (consultas y UI sobre datos que ya existen).
- La analítica (F12, F14) no resuelve discusiones de deuda; esperar.
- Sync multi-dispositivo/CxP siguen excluidos por diseño.

## Top priorizado
1. F1 Reconciliación de `customer.debt` con alerta (caso real).
2. F5 Aviso de no sincronizado/rechazado + no borrar en silencio lo descartado.
3. F2+F3 Historial con saldo corrido + comprobante/confirmación MVP (D4).
4. F4 Reversos (anular venta/abono sin borrar).
5. F6+F7 Número de venta, nota de abono en portal, exportación CSV.
