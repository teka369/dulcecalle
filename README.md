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

- **Devoluciones (P1):** no hay flujo «el cliente devolvió». Habría que subir stock, ajustar dinero o deuda, y dejar la venta histórica trazable. No se implementó en esta auditoría.
- **Motivos de inventario (P1):** existe `adjust` en el tipo, pero la UI usa `me_lo_comi` / `regalar` / `perdido`. No se migró a damaged/expired/lost para no romper datos.
- **Alta de producto con stock inicial (P1):** el stock de catálogo no genera `stockMove`. Los movimientos posteriores sí. No se puede parchar `product.stock` a mano.
- **Backend / sync (P2):** un solo dispositivo. No hay PostgreSQL, cuentas ni sincronización.
- **Idempotencia de ventas:** el abono sí tiene `requestId`; un doble tap en Confirmar venta aún puede crear dos ventas si se ignora el `busy` de la UI.

## Pendiente consciente

No se agregó: IA, facturación electrónica, nómina, banca, mapas, VIP, auth compleja, ni sync multi-dispositivo.
