# DulceCalle backend (Fase 6)

NestJS + Prisma + PostgreSQL 16. **Does not replace Dexie.** The PWA stays local-first; this API is a parallel store. No Dexie import, no HTTP adapter, no sync.

Contract: `../DOMAIN.md`, `../BACKEND_ARCHITECTURE.md`, `../DATABASE.md`, `../API_CONTRACT.md`.

## Run locally

```bash
docker compose up -d          # from repo root — PostgreSQL 16
cd backend
cp .env.example .env          # then edit JWT secrets
npm install
npx prisma migrate deploy
npx prisma generate
npm run start:dev             # http://localhost:3000/v1/health
```

Optional fake user (not the owner's books): `npm run seed`  
(`dev@dulcecalle.test` / `devpass12`)

## Tests

```bash
cd backend && npm test
```

Tests boot an embedded PostgreSQL. They do **not** touch IndexedDB.

## Money JSON

COP is `BIGINT` in Postgres / `bigint` in Prisma. HTTP JSON emits a **number** (`"saleTotal": 12500`). Values outside `Number.MAX_SAFE_INTEGER` throw.

## Out of scope (later phases)

Returns, surtir, shrink, expenses API, stats, Dexie migration, PWA adapter, sync.
