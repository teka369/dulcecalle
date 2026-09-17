# DulceCalle

PWA de ventas para dulcería de barrio (Next.js App Router + Dexie).

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Dexie (IndexedDB) — **fuente de verdad**; datos **no** van al Cache API / Cache Storage
- Capas: UI → store → repository → storage

## Domain rules (separación dura)

| Métrica | Significado |
|---------|-------------|
| **Ventas** | `sum(sale.saleTotal)` |
| **Recibido** | `sum(sale.amountReceived) + sum(customerPayments)` |
| **Fiado** | `sum(customer.debt)` outstanding |
| **Caja** | balance de `cashMoves` |
| **Stock** | unidades en `products.stock` |

Nunca mezclar estas cifras en un solo número.


## Estadísticas (S5)

Pantalla **Más → Estadísticas**. Períodos: Hoy · Semana (últimos 7 días) · Mes (calendario local).

| Métrica | Fórmula | ≠ |
|---------|---------|---|
| **Ventas** | `sum(sale.saleTotal)` del período | Recibido, caja, ganancia |
| **Recibido** | `sum(sale.amountReceived) + sum(abonos)` del período (Efectivo/Nequi) | Ventas fiadas, ganancia |
| **Por cobrar** | `sum(customer.debt)` outstanding | Diferencia de caja |
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

## Onboarding

Inicio vacío + botón **Cargar demo**.

## Offline / PWA

Serwist precachea el *shell* (HTML/CSS/JS, `/offline`, icons, manifest). **Dexie (IndexedDB) es la fuente de verdad** de ventas, clientes, stock y caja: esos datos **nunca** van a Cache Storage. El seed demo también vive en Dexie, no en el service worker.
