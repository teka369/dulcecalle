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
