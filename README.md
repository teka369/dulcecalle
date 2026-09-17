# DulceCalle

PWA de ventas para dulcería de barrio (Next.js App Router + Dexie).

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Dexie (IndexedDB) — **fuente de verdad**; datos **no** van al Cache API / Cache Storage
- Capas: UI → store → repository → storage

Offline-first. Sin backend ni sincronización entre dispositivos (aún).

## Arquitectura

```
UI (App Router pages)
  → store (cart / cash / customer / inventory)
    → repository (ventas, caja, clientes, inventario, stats)
      → Dexie / IndexedDB
```

La lógica de negocio vive en repositories + `src/domain`. Los componentes no escriben IndexedDB directo.

## Domain rules (separación dura)

| Métrica | Significado |
|---------|-------------|
| **Ventas** | `sum(sale.saleTotal)` |
| **Recibido** | `sum(sale.amountReceived) + sum(customerPayments)` |
| **Fiado / Por cobrar** | `sum(customer.debt)` outstanding **ahora** (no el fiado generado en el período) |
| **Caja (ledger)** | `balance()` = Σ `cashMoves` (no incluye `openingFloat`) |
| **Caja esperado** | `openingFloat` + Σ movimientos del día por método |
| **Stock** | unidades en `products.stock` |

Nunca mezclar estas cifras en un solo número.

### Precio de una venta

Al vender se puede cambiar el precio. La línea guarda **el precio cobrado** (`unitPrice`) y el **costo de ese momento** (`unitCost`). Cambiar el precio o el costo del producto después **no** reescribe ventas históricas.

`lineTotal = unitPrice × qty`  
`ganancia histórica = lineTotal − qty × unitCost`

### Caja

`openingFloat` vive en `cashSessions`, **no** es un `cashMove`.

- `balance()` — ledger de movimientos. Útil para cuadre de flujo (entradas − salidas).
- `expectedBuckets().efectivo` — lo que debería haber en billetes hoy, **incluyendo** el fondo de apertura. Es el «Caja esperado» de Inicio y del cierre.

Cerrar caja cuenta solo Efectivo físico. Nequi se rastrea aparte.

### Cierre del día

Si la sesión del día está **cerrada**, se rechaza cualquier operación de ese día:

venta, abono, surtir, merma, gasto, retiro, aporte, y cualquier `cashMove` / movimiento de stock.

No hace falta tener la caja abierta para vender: sin sesión, el día se considera editable. El bloqueo aplica cuando ya se cerró.

Surtir con fecha de un día ya cerrado también se rechaza (aunque hoy esté abierto).

La guarda central es `assertDayEditable()` (`src/repositories/dayGuard.ts`).

### Idempotencia

Abonos y ventas usan `requestId` (clave de intención, generada en la UI):

- misma `requestId` → se devuelve el registro existente; no se vuelve a bajar stock, caja ni deuda
- `requestId` distinta → dos operaciones válidas

No basta con deshabilitar el botón. El repositorio es la guarda (doble tap, retry, operación lenta).

### Stock inicial

Alta de producto con `stock > 0` escribe un `stockMove` `reason=inicial` (delta = stock, `unitCost` = `avgCost`). **No** es compra: no hay `cashMove`, no entra en Invertí, no pasa por el cierre del día.

`product.stock` sigue siendo la cantidad viva. Los movimientos son el historial de cambios:

- crear producto → `inicial` (si stock > 0)
- después → solo `surtir` / venta / merma

No se puede parchar `product.stock`. `applyMove` rechaza `reason=inicial` (solo nace en el alta).

Productos ya existentes (demo seed / datos pre-P0.5) pueden tener stock sin `inicial`. No se migran. No reconstruyas el stock actual como `sum(stockMoves)` — usa `product.stock`.

### Surtir / costos

Fuente de cálculo:

- solo unitario → total = unitario × cantidad
- solo total → unitario = `round(total / cantidad)`
- ambos y se contradicen → **gana el total** (salida de caja) y el unitario se recalcula

No se guardan tres valores independientes inconsistentes.

### Datos locales y demo

Todo vive en IndexedDB de **este dispositivo**.

- Inicio vacío → **Cargar demo**
- Más → Datos → escribir `BORRAR` → confirmar otra vez → **elimina todos los datos locales**

No hay nube. Borrar es irreversible en este aparato.

## Estadísticas (S5)

Pantalla **Más → Estadísticas**. Períodos: Hoy · Semana (últimos 7 días) · Mes (calendario local).

| Métrica | Fórmula | ≠ |
|---------|---------|---|
| **Ventas** | `sum(sale.saleTotal)` del período | Recibido, caja, ganancia |
| **Recibido** | `sum(sale.amountReceived) + sum(abonos)` del período (Efectivo/Nequi) | Ventas fiadas, ganancia |
| **Por cobrar** | `sum(customer.debt)` outstanding (punto actual) | Fiado generado en el período |
| **Gasté** | `sum(expenses)` del período | Retiro personal |
| **Invertí** | `sum(cashMoves kind=compra)` surtir/compra del período | Gasto, aporte, retiro |
| **Inventario** | `sum(stock × avgCost)` + stock bajo (punto actual) | Efectivo en caja |
| **Ganancia aprox** | `sum(lineTotal − qty×unitCost)` del período (snapshots) | Cierre de caja |

**No** se muestran Esperado/Contado/Diferencia en Stats — solo enlace **Ir a Caja**. Lecturas 100% Dexie (offline).

## Scripts

```bash
npm run dev
npm test
npm run build
```

## Offline / PWA

Serwist precachea el *shell* (HTML/CSS/JS, `/offline`, icons, manifest). **Dexie (IndexedDB) es la fuente de verdad** de ventas, clientes, stock y caja: esos datos **nunca** van a Cache Storage. El seed demo también vive en Dexie, no en el service worker.

## Limitaciones conocidas (P1 / P2)

- **Devoluciones (P1):** no implementadas. Diseño mínimo abajo. No hay UI ni tablas todavía.
- **Motivos de inventario (P1):** existe `adjust` en el tipo, pero la UI usa `me_lo_comi` / `regalar` / `perdido`. No se migró a damaged/expired/lost para no romper datos.
- **Backend / sync (P2):** un solo dispositivo. No hay PostgreSQL, cuentas ni sincronización.

### Devoluciones — diseño mínimo (P1, no construir aún)

La venta original **no se edita ni se borra**. Siempre queda trazable.

```
Venta (inmutable)
  → Devolución (nuevo registro, ref a la venta)
    → stock vuelve (stockMove reason=devolucion, +qty)
    → dinero o deuda se ajusta
```

**Alcance**

| Caso | Qué pasa |
|------|----------|
| Total | se devuelven todas las líneas / qty pendientes |
| Parcial | algunas líneas o qty; nunca más de lo vendido menos lo ya devuelto |
| Pagada Efectivo | `cashMove` `kind=devolucion` `direction=out` método Efectivo |
| Pagada Nequi | igual, método Nequi |
| Fiada | baja `customer.debt` (nunca < 0). Sin caja |
| Parcial (abono + fiado) | primero reduce la deuda de esa venta; si el valor devuelto supera lo que aún debía, el resto sale de caja por el método original |

**Snapshots:** qty × `saleLine.unitPrice` y `saleLine.unitCost` de la venta original. Nunca el precio/costo actual del catálogo.

**Tablas futuras (cuando se implemente)**

- `saleReturns`: `saleId`, `createdAt`, `requestId` (idempotente), `refundAmount`, `debtReduced`, `method`
- `saleReturnLines`: `returnId`, `saleLineId`, `qty`, `unitPrice`, `unitCost`

**Impacto en números (cada métrica aparte)**

- **Ventas brutas:** siguen siendo `sum(sale.saleTotal)` — la venta no se reescribe
- **Ventas netas / stats:** `ventas − sum(return lines)` en el período de la devolución (o métrica Devoluciones aparte). Decisión de producto al implementar: restar vs. mostrar línea propia
- **Ganancia:** restar `qty × (unitPrice − unitCost)` de los snapshots devueltos
- **Caja:** solo si hubo plata recibida que se devuelve (`cashMove` out)
- **Por cobrar:** baja si la venta tenía crédito vigente; clamp a 0
- **Stock:** `product.stock += qty` vía `stockMove` (misma guarda de día cerrado y stock ≥ 0)
- **Cierre del día:** una devolución en día cerrado se rechaza igual que una venta

**Fuera de alcance P1:** nota crédito fiscal, factura electrónica, cambio por otro producto, devolución sin ticket.

### Integridad de mutaciones

Las páginas no escriben Dexie. Caminos de negocio:

| Qué | Quién escribe | Guarda |
|-----|----------------|--------|
| stock | `saleRepository.createSale`, `inventoryRepository.surtir/applyShrink/applyMove`, alta `productRepository.create` (`inicial`) | día cerrado, stock ≥ 0, no parche directo |
| deuda | `createSale` (suma crédito), `customerRepository.recordPayment` (resta) | día cerrado, deuda ≥ 0, abono ≤ deuda, `requestId` |
| caja | `createSale`, `recordPayment`, `surtir` (compra), `recordExpense`, `ownerAporte/Retiro` | día cerrado, `assertDayEditable` |
| ventas / líneas | solo `createSale` | `requestId`, pago coherente, stock |

Excepciones conscientes:

- **Demo seed:** `bulkAdd` de catálogo (puede no tener `inicial`) y reloj de `createdAt` para que Inicio muestre «hoy». No cambia montos de stock/deuda/caja.
- **Alta de cliente** acepta `debt` en el API; la UI siempre crea en 0.

## Pendiente consciente

No se agregó: IA, facturación electrónica, nómina, banca, mapas, VIP, auth compleja, ni sync multi-dispositivo.
