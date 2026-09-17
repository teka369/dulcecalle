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

Al **abrir**, el fondo es lo que traías al empezar — **no** lo que hay ahora en el bolsillo después de vender. Si ya vendiste hoy y abres después, no cuentes lo vendido otra vez.

### Cierre del día

Si la sesión del día está **cerrada**, se rechaza cualquier operación de ese día:

venta, abono, surtir, merma, gasto, retiro, aporte, y cualquier `cashMove` / movimiento de stock.

**No** aplica a cargas iniciales del sistema: alta de producto con stock y **deuda anterior** de un cliente. Esas no mueven caja.

No hace falta tener la caja abierta para vender: sin sesión, el día se considera editable. El bloqueo aplica cuando ya se cerró.

Surtir con fecha de un día ya cerrado también se rechaza (aunque hoy esté abierto).

La guarda central es `assertDayEditable()` (`src/repositories/dayGuard.ts`).

### Idempotencia

Abonos, ventas, deudas anteriores, **gastos, retiros, aportes y surtir** usan `requestId`.

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

### Deuda anterior (deuda inicial)

Lo que un cliente **ya debía** antes de usar DulceCalle. No es una venta.

Cliente → **Agregar deuda anterior**.

- Sube `customer.debt` (saldo actual / Por cobrar)
- Escribe un registro `initialDebts` (trazable, con `requestId`)
- **No** crea venta, saleLines, inventario, caja, Nequi, Ventas ni Recibido
- **No** cuenta como fiado generado en el período
- Después se puede **Registrar abono** con normalidad (caja + cierre + idempotencia)

Misma `requestId` → no vuelve a sumar. Otra clave → otra carga válida (varias deudas viejas, una por una).

No se carga sola: hay que registrar cada cliente desde la ficha. El demo no mezcla deudas anteriores con ventas de muestra.

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

- **Motivos de inventario (P1):** existe `adjust` en el tipo, pero la UI usa `me_lo_comi` / `regalar` / `perdido`.
- **Backend / sync (P2):** un solo dispositivo. No hay PostgreSQL, cuentas ni sincronización.

### Devoluciones

La venta original **no se edita ni se borra**.

```
Venta (inmutable)
  → Devolución (saleReturns + saleReturnLines)
    → stock vuelve (stockMove reason=devolucion, +qty)
    → caja out kind=devolucion  y/o  baja customer.debt
```

Ventas → ficha de la venta → **Devolver**.

- Parcial o total, nunca más de lo que queda.
- Snapshots de la línea original (`unitPrice` / `unitCost`).
- Pagada Efectivo/Nequi → reembolso por el mismo medio.
- Fiada → baja la deuda (si ya se cobró, el resto sale de caja).
- Parcial (abono + fiado): primero el crédito que queda de ESA venta; el resto es reembolso.
- `requestId` en el repositorio. Día cerrado (hoy) se rechaza. La devolución queda en **hoy**, no reescribe el día de la venta.

**Números**

- **Ventas** = brutas (`sum(sale.saleTotal)`). No se reescriben.
- **Devoluciones** = valor devuelto en el período (a precio histórico).
- **Ganancia aprox** = margen de ventas del período − margen de lo devuelto en el período.
- **Recibido** = entradas (ventas + abonos). El reembolso sale por Caja, no resta Recibido.
- **Por cobrar** = deuda actual (baja si la devolución quita fiado).

### Surtir

Una sola fecha efectiva: **hoy**. Inventario y caja salen juntos. Un día distinto (aunque esté abierto) se rechaza. Un día cerrado también.

### Alta de producto

Stock inicial > 0 exige costo > 0. Sin stock el costo puede ir en 0 y se llena al surtir.

### Integridad de mutaciones

Las páginas no escriben Dexie. Caminos de negocio:

| Qué | Quién escribe | Guarda |
|-----|----------------|--------|
| stock | `createSale`, `surtir`/`applyShrink`/`applyMove`, alta `create` (`inicial`), `createReturn` (`devolucion`) | día cerrado, stock ≥ 0, no parche directo |
| deuda | `createSale` (suma crédito), `recordInitialDebt`, `recordPayment` (resta), `createReturn` (resta) | día cerrado en venta/abono/devolución; deuda ≥ 0 |
| caja | `createSale`, `recordPayment`, `surtir` (compra), `recordExpense`, `ownerAporte/Retiro`, `createReturn` | día cerrado, `assertDayEditable` |
| ventas / líneas | solo `createSale` | `requestId`, pago coherente, stock |
| devoluciones | solo `createReturn` | `requestId`, qty ≤ restante, snapshots |

Excepciones conscientes:

- **Demo seed:** `bulkAdd` de catálogo (puede no tener `inicial`) y reloj de `createdAt` para que Inicio muestre «hoy». No cambia montos de stock/deuda/caja.
- **Alta de cliente** nace en deuda 0. La deuda anterior va por `recordInitialDebt`, no en el create.

## Pendiente consciente

No se agregó: IA, facturación electrónica, nómina, banca, mapas, VIP, auth compleja, ni sync multi-dispositivo.
