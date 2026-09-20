# DulceCalle backend (Fase 6 + M1 + M2 auth + M3 PWA HTTP)

NestJS + Prisma + PostgreSQL 16. **Source of truth for the business.** The PWA UI talks HTTP (UUID). Dexie repositories remain for domain tests only. No Dexie import, no sync.

Contract: `../DOMAIN.md`, `../BACKEND_ARCHITECTURE.md`, `../DATABASE.md`, `../API_CONTRACT.md`.

## Render (production)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/teka369/dulcecalle)

Blueprint: [`../render.yaml`](../render.yaml). Creates:

- Web: `dulcecalle-teka369` → `https://dulcecalle-teka369.onrender.com`
- Postgres 16 free: `dulcecalle-db` (expires after **30 days** on the free plan)

JWT secrets are generated on first deploy. CORS allows `https://dulcecalle.vercel.app`.

Health: `GET /v1/health` → `{ ok: true, db: "up" }`.

## Run locally

```bash
docker compose up -d          # from repo root — PostgreSQL 16
cd backend
cp .env.example .env          # then edit JWT secrets — both required
npm install
npx prisma migrate deploy
npx prisma generate
npm run start:dev             # http://localhost:3000/v1/health
```

Optional fake user (not the owner's books): `npm run seed`  
(`dev@dulcecalle.test` / `devpass12`)

## JWT

`JWT_SECRET` (access, 15m) and `JWT_REFRESH_SECRET` (refresh, 7d, claim `typ: "refresh"`) are **required**. There is no fallback. Missing or blank secrets → the process refuses to boot.

`POST /v1/auth/logout` returns `{ ok: true }` and does **not** revoke tokens (stateless JWT, no denylist). The PWA deletes `localStorage["dulcecalle.auth"]`.

## Tests

```bash
cd backend && npm test
```

Tests boot an embedded PostgreSQL. They do **not** touch IndexedDB. `backend/test/setup-env.ts` sets test JWT secrets before `AppModule` loads.

## Money JSON

COP is `BIGINT` in Postgres / `bigint` in Prisma. HTTP JSON emits a **number** (`"saleTotal": 12500`). Values outside `Number.MAX_SAFE_INTEGER` throw.

## Out of scope (later phases)

Settings, memberships admin, wipe, Dexie import, sync.
