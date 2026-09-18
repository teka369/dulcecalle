# Dexie → PostgreSQL importer (Fase 6.8 dry-run)

TEST only. Inserts historical rows. Does **not** call `POST /sales`.

```
MIGRATION_ENV=TEST
DATABASE_URL=postgresql://…@127.0.0.1:…/dulcecalle_test
```

Refuses anything that is not a local TEST URL. The PWA stays on Dexie.

See [MIGRATION.md](../../MIGRATION.md) and [IDENTITY.md](../../IDENTITY.md).
