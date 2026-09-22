# Product images (Cloudinary)

Offline-first product gallery. PostgreSQL owns the product ↔ image
relation; Cloudinary stores and delivers the bytes. No `imageUrl` blob on
`Product`: one `ProductImage` row per photo.

## Data model

`backend/prisma/schema.prisma` → `product_images`:

- `id`, `businessId`, `productId` (ownership; `@@index([businessId, productId, position])`)
- `publicId` (`@@unique`), `secureUrl` (canonical delivery URL)
- `cloudinaryAssetId` (nullable, informational), `version`, `width`, `height`, `format`, `bytes`
- `position` (0-based gallery order), `isPrimary` (max one per product, enforced transactionally)
- `altText` (nullable), `requestId` (`@@unique([businessId, requestId])` for idempotency)
- `createdAt`, `updatedAt`

Public id format (server-minted, never client-invented):

```
dulcecalle/{businessId}/products/{productId}/{requestId}
```

`parseImagePublicId` rejects anything else, so Business A can never attach,
move or delete an asset scoped to Business B — every service method also
re-validates `product.businessId === ctx.businessId`.

Local mirror: `LocalProduct.images: LocalProductImage[]` (`src/data/local/types.ts`),
populated by `productToLocal` from the server `images` array. Historical
records (sales, payments, cash, stock moves) never embed images.

## Upload strategy: signed browser → Cloudinary (A)

1. Frontend calls `POST /products/:id/image-signature` with `{ requestId }`
   (client-generated UUID v4, also sent as `Idempotency-Key`).
2. Backend (`MediaService.signUpload`) validates product ownership, builds
   `publicId = dulcecalle/{biz}/{product}/{requestId}`, signs
   `{ public_id, timestamp }` with SHA-1 + `CLOUDINARY_API_SECRET`
   (Cloudinary docs: sorted `name=value` pairs joined by `&`, secret
   appended, hex digest), returns `{ cloudName, apiKey, uploadUrl,
   timestamp, signature, publicId, requestId }`.
3. Browser uploads straight to `uploadUrl` (`uploadToCloudinary`,
   XHR for progress). Only signed fields travel; `api_secret` never leaves
   the server, never appears in `NEXT_PUBLIC_*`, Dexie, or logs.
4. Frontend validates the Cloudinary response (`parseUploadResponse`:
   requires `public_id`, `secure_url`, `resource_type === "image"`) and calls
   `POST /products/:id/images` with the metadata + the same `requestId`.
5. Backend (`registerImage`) re-validates: `publicId` parses to
   `(ctx.businessId, productId, requestId)`, `secureUrl` starts with
   `https://res.cloudinary.com/{cloud}/image/upload/` and contains the
   `publicId`, `resourceType` is `image`. Idempotent on
   `(businessId, requestId)`: repeat POST returns the same row. First image
   (or `isPrimary: true`) becomes primary inside the same transaction.

Throttling: signature/register/delete endpoints `30 req/min` per IP.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/products/:id/image-signature` | body `{ requestId }`, idempotent key honored |
| POST | `/products/:id/images` | body `RegisterProductImageDto`, idempotent on `requestId` |
| GET | `/products/:id/images` | position order |
| PATCH | `/products/:id/images/reorder` | body `{ imageIds }`: exact full set, applied atomically |
| PATCH | `/products/:id/images/:imageId` | `{ isPrimary?, altText? }`; setting primary clears others in one transaction |
| DELETE | `/products/:id/images/:imageId` | destroys the Cloudinary asset server-side, then deletes the row |
| GET | `/customer/products` | portal storefront: `{ id, name, price, available, images[] }` — no cost/supplier/ids |

`GET /products` and `GET /products/:id` include `images[]` ordered by
`(position, createdAt)`; no extra round-trip needed for admin screens.

## Primary & order invariants

- At most one `isPrimary = true` per product (transaction clears + sets).
- First registered image is primary automatically.
- Deleting the primary promotes the lowest-position survivor; empty gallery
  has no primary.
- Reorder requires the exact id set once each, else `VALIDATION`.

## Delete lifecycle (no false atomicity)

`MediaService.removeImage`: destroy on Cloudinary first (signed
`POST …/image/destroy`, `invalidate: true`), then delete the row, then
promote. Cloudinary answers HTTP 200 with a JSON body in all normal cases:

- `{ result: "ok" }` → delete row.
- `{ result: "not found" }` → asset already gone → still delete row (converges).
- any other `result`, non-200 status, malformed JSON, or transport failure →
  throw `No se pudo eliminar la imagen.`, row kept for retry.

Covered by `backend/src/catalog/media.unit-spec.ts` (mocked Prisma + fetch).

## Orphans

- Upload OK + register never sent / failed → asset exists on Cloudinary with
  no DB row. Bounded by design: the `publicId` embeds the `requestId`, so a
  retry with the same key reuses the same asset instead of creating another.
  There is no background sweeper (no workers/Redis by design); the retry path
  is the reconciliation path.
- DB row exists + asset deleted externally → renders the Dulce Calle
  placeholder (`ProductImageView` error fallback); deleting the row then
  converges via the `not found` branch above.

## Offline-first

Cloudinary needs connectivity, so offline photos are explicit pending work,
never fake success:

- `pendingMedia` (Dexie v7, `LocalPendingMedia`): the Blob + metadata.
  Never in the outbox payload (outbox rows stay small JSON).
- `addProductImages`: online per-file `signature → upload → register` with
  `{ uploaded[], failed[] }` partial results (`4/5 cargadas. Reintenta las
  fallidas.`); transport failure per file → `queuePendingMedia` + one
  `productImage:create` outbox op per photo, result `{ mode: "offline",
  queued }`.
- `syncPendingProductImages` (wired into `syncAllPending` after products,
  before operations): re-signs with the stored `requestId` (same `publicId`),
  uploads the Blob, registers, deletes the Blob, refreshes the local product
  mirror. Missing blob → permanent `failed` (`nextAttemptAt: null`,
  `Descarta la operación`), never an infinite retry.
- Blobs require the product to exist in the local store first (cross-tenant
  queue attempts throw `El producto no está disponible sin conexión.`).
- Limits: 8 photos/product, 5 MB/file (JPG/PNG/WebP, MIME+extension match),
  32 MB total pending blobs. Quota exceeded throws before queueing.
- `setPrimaryImage` / `reorderProductImages` / `queueImageRemove` work online
  immediately and enqueue `productImage:patch` / `productImage:remove` on
  `NetworkError` only; Sync Center labels them `Foto de producto` with
  `Subiendo foto` / `Actualizando foto` / `Eliminando foto` details.
- Business reset (`clearLocalBusinessData`) wipes `pendingMedia` for the
  business so orphan blobs can never resurrect deleted products; portal
  catalog snapshots are keyed by `customerId` and only the wiped business'
  customers are invalidated.

## Preparation & Service Worker

- `media:thumbs` prep task (`PREP_VERSION = 2`): prefetches each prepared
  business' primary `thumb` variant into the `cloudinary-images` Cache
  Storage (best-effort, reported as `N/M miniaturas`, never fails the run).
- SW (`src/app/sw.ts`): `CacheFirst` for `res.cloudinary.com` only
  (`maxEntries: 100`, `maxAgeSeconds: 30d`, statuses `[0, 200]`). No business
  data in Cache Storage; `/api/*` stays `NetworkOnly`.

## Delivery

`src/data/media/urls.ts`: one transformation segment after `/upload/`,
never double-transformed:

- `thumb`: `w_160,h_160,c_fill,q_auto,f_auto` (lists, grids, prep)
- `card`: `w_640,c_limit,q_auto,f_auto` (detail headers)
- `detail`: `w_1200,c_limit,q_auto,f_auto` (gallery)

`ProductImageView` (admin + portal): lazy by default, loading shimmer,
official `DulceCalle.png` placeholder on missing/error, never a raw URL or
broken icon. `ProductImageManager` (admin detail + create flow): picker with
drag&drop, previews, per-file progress/error/retry, portada/move/delete with
confirm, pending-upload list with discard.

## Customer portal

`/cliente/productos` (grid) and `/cliente/productos/:id` (gallery + price +
Disponible/Agotado). `loadCachedCustomerCatalog` mirrors the M6.10 ledger
honesty rules: online refreshes the `portalCatalogs` snapshot (Dexie v8,
keyed by `customerId`); only `NetworkError` serves cache with
`Sin conexión · Mostrando catálogo de la última actualización`; HTTP errors
rethrow; logout deletes the catalog + ledger rows. Customers never see
`publicId`, cost, supplier, `lowStockAt`, or sync internals.

## Configuration (owner action required)

Server-only (`backend/.env`, placeholders in `backend/.env.example`):

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

All three required; image endpoints return `Imágenes no configuradas en el
servidor.` without them. Never use `NEXT_PUBLIC_*` for any of these. Values
come from Cloudinary Console → Settings → API Keys.

## Migrations

- Prisma `20260923000000_product_images` creates `product_images` + indexes;
  product FK is `RESTRICT` (archive, never hard-delete, keeps history).
- Dexie v7 adds `pendingMedia`; v8 adds `portalCatalogs`. The v3→current
  migration test asserts data preservation + both tables writable.

## Troubleshooting

- `Imágenes no configuradas en el servidor.` → set the three env vars,
  restart the backend.
- `4/5 fotos cargadas` → per-file error shown; failed tiles keep a
  `Reintentar` button; nothing is marked uploaded until registered.
- `Esta imagen no se pudo subir.` → Cloudinary rejected the upload (status
  in the API error); check size/type, retry.
- `No se pudo eliminar la imagen.` → Cloudinary destroy failed; row kept,
  Sync Center / detail shows the error, retry later.
- `Sin espacio para más fotos pendientes.` → 32 MB pending cap; connect and
  sync to drain, or discard pending uploads.
