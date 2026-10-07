# Referencia

El índice de una sola caja abierta ya no vive aquí.

La migración que lo aplica es `backend/prisma/migrations/20261007160000_cash_one_open_guard`.
`prisma migrate deploy` la ejecuta. Si un negocio todavía tiene dos cajas abiertas, aborta y no cierra ninguna.

`cash_one_open_guard.sql` queda como copia de referencia.
