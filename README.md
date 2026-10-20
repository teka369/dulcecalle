# DulceCalle

PWA de ventas para dulcería de barrio (Next.js App Router + NestJS).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/teka369/dulcecalle)

## Stack

- Next.js (App Router) + TypeScript + Tailwind — PWA en [Vercel](https://dulcecalle.vercel.app)
- NestJS 11 + Prisma 6 + PostgreSQL 16 — **fuente de verdad del negocio** (Render: `dulcecalle-teka369`)
- Dexie repositories — **solo tests de dominio** (IDs numéricos). La UI no los usa.
- Capas UI: pages → store → `HttpRepository` → `/v1`
- M6.1: Local Store UUID + Outbox en `src/data/local` (`dulcecalle-local`). Cableado a la UI: es la copia local y la cola de envíos offline.
- M6.2: sesión local sobrevive `NetworkError` (login inicial sigue online). Contrato: [M6.md](M6.md).
- M6.3: cache de lectura del catálogo (productos/clientes/proveedores) en `dulcecalle-local`. PostgreSQL sigue siendo la autoridad.
- M6.4: monitor de conectividad + motor genérico de flush del outbox, con dependencias, reintentos y recuperación de `in_flight`. Desde M6.5 las escrituras de negocio funcionan offline (ver «Offline / PWA»).

Hay que entrar con cuenta. El servidor arranca vacío: productos, clientes y fiados se cargan a mano. Un fiado viejo es **deuda anterior**, nunca una venta.

El dominio congelado está en [DOMAIN.md](DOMAIN.md). Servidor: [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md) · [DATABASE.md](DATABASE.md) · [API_CONTRACT.md](API_CONTRACT.md) · [MIGRATION.md](MIGRATION.md) · [IDENTITY.md](IDENTITY.md) · [M6.md](M6.md).

M3: la PWA habla HTTP (UUID) con el backend Nest + PostgreSQL. Con conexión, cada escritura va directo al servidor; sin conexión se guarda en el outbox local y se envía al volver la conexión. No hay import Dexie→PG. `pwaStorage()` es `"http"`.

- Dev: `NEXT_PUBLIC_API_URL` opcional; si falta, el cliente usa `/v1` (el PWA reescribe a Nest).
- Producción: si falta `NEXT_PUBLIC_API_URL`, el cliente usa `https://dulcecalle-teka369.onrender.com/v1`.
- Vercel Previews: si el preview habla con **otro** backend (staging, un servicio de Render de preview…), define `NEXT_PUBLIC_API_URL` en el entorno *Preview* de Vercel **antes del build**. Además de elegir la API, su origen entra en la CSP `connect-src` (`src/security-headers.ts`); sin ella el navegador bloquea las llamadas a ese backend (solo se permiten `'self'`, la API de producción y Cloudinary). Es una variable de build: cambiarla exige redeploy.

No pongas secrets en `NEXT_PUBLIC_*`.

## Arquitectura

```
UI (App Router pages)
  → store (cart / cash / customer / inventory)
    → HttpRepository (src/data/http)     ← ACTIVO M3–M5
         → NestJS /v1 → Prisma → PostgreSQL
src/data/local (dulcecalle-local, UUID)  ← M6.1, no UI
Dexie repositories (src/repositories)    ← tests de dominio (++id)
```

La lógica de negocio de la UI vive en stores + `src/domain`. Los componentes no escriben IndexedDB.

## Domain rules (separación dura)

| Métrica | Significado |
|---------|-------------|
| **Ventas** | `sum(sale.saleTotal)` |
| **Recibido** | `sum(sale.amountReceived) + sum(customerPayments)` |
| **Fiado / Por cobrar** | `sum(customer.debt)` outstanding **ahora** (no el fiado generado en el período) |
| **Caja (ledger)** | `balance()` = Σ `cashMoves` (no incluye `openingFloat`) |
| **Caja esperado (Efectivo)** | `openingFloat` + Σ cashMoves **Efectivo** del día. Nequi no entra. |
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

Si la sesión del día está **cerrada**, se rechaza cualquier operación económica o de stock de ese día:

venta, abono, surtir, merma, gasto, retiro, aporte, **devolución**, y cualquier `cashMove` / movimiento de stock.

**No** aplica a cargas iniciales del sistema: alta de producto con stock y **deuda anterior** de un cliente. Esas no mueven caja.

No hace falta tener la caja abierta para vender: sin sesión, el día se considera editable. El bloqueo aplica cuando ya se cerró.

Surtir con fecha de un día ya cerrado también se rechaza (aunque hoy esté abierto).

La guarda central es `assertDayEditable()` (`src/repositories/dayGuard.ts`).

### Idempotencia

Abonos, ventas, deudas anteriores, gastos, retiros, aportes, surtir, **merma y devolución** usan `requestId`.

- misma `requestId` → se devuelve el registro existente; no se vuelve a bajar stock, caja ni deuda
- `requestId` distinta → dos operaciones válidas

No basta con deshabilitar el botón. El repositorio es la guarda (doble tap, retry, operación lenta).

### Stock inicial

Alta de producto con `stock > 0` escribe un `stockMove` `reason=inicial` (delta = stock, `unitCost` = `avgCost`). **No** es compra: no hay `cashMove`, no entra en Invertí, no pasa por el cierre del día.

Si las unidades te las regalaron o no sabes el costo, marca **Me lo regalaron / no sé el costo**. Entonces `avgCost` queda en 0 (la ganancia de esa tanda será casi todo el precio). Sin esa marca, stock > 0 sigue exigiendo costo > 0.

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

### Datos: servidor + copia en este teléfono

La fuente de verdad es el **servidor** (Nest + PostgreSQL en Render). Este teléfono guarda una copia en IndexedDB (`dulcecalle-local`) para trabajar sin conexión, más la cola de envíos pendientes (outbox).

- **Más → Datos:** preparar el dispositivo para trabajar sin conexión y cerrar sesión. Cerrar sesión no borra lo que ya está en el servidor.
- **Sincronización** (`/sincronizacion`): lo que falta por enviar, lo que el servidor rechazó (con el motivo, **Corregir** o **Descartar**) y el espacio usado en el teléfono.
- Inicio vacío → **Cargar demo** (sigue existiendo; no se tocó en loop/v1).

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

**No** se muestran Esperado/Contado/Diferencia en Stats — solo enlace **Ir a Caja**. Lecturas vía `GET /v1/stats`.

## Scripts

```bash
npm run dev
npm test
npm run build
```

## Offline / PWA

Serwist precachea el *shell* (HTML/CSS/JS, `/offline`, icons, manifest). El negocio vive en PostgreSQL vía Nest; el service worker no guarda datos de negocio.

Sin conexión (M6.5+): ventas, abonos, deuda inicial, devoluciones, clientes/proveedores nuevos, caja (abrir, aporte, retiro, gasto, cerrar), surtir, mermas y preparaciones se guardan en el outbox de este teléfono y se envían solas al volver la conexión, en orden (FIFO) y con la misma `Idempotency-Key` en cada reintento (nunca se duplican en el servidor). Con varias pestañas abiertas, una sola envía (Web Locks) y las demás se actualizan al terminar.

Si el servidor rechaza una operación de forma definitiva (4xx, p. ej. stock o validación), queda visible en Sincronización con el motivo; las operaciones que dependen de ella esperan, las independientes siguen. Ver [M6.md](M6.md).

## Limitaciones conocidas (P1 / P2)

- **Motivos de inventario (P1):** existe `adjust` en el tipo, pero la UI usa `me_lo_comi` / `regalar` / `perdido`.
- **Backend / sync (P2):** cada teléfono envía su outbox al servidor y lee de ahí; no hay sync directa entre teléfonos ni import Dexie→PG.

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

Stock inicial > 0 exige costo > 0, salvo que marques que te lo regalaron (costo 0 a propósito). Sin stock el costo puede ir en 0 y se llena al surtir.

### Integridad de mutaciones

Las páginas no escriben Dexie. Caminos de negocio (servidor):

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
