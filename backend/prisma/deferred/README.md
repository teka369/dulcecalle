# Migración diferida — no forma parte de este release

`cash_one_open_guard.sql` crea el índice único parcial de una sola caja abierta por negocio.

No está en `prisma/migrations`, así que `prisma migrate deploy` no la ejecuta.

Aplicarla solo después de regularizar todas las cajas desde Gestionar cajas.
Si todavía hay dos abiertas, el script aborta y no cierra ni borra nada.
