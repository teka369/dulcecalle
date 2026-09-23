# Producción / Preparaciones

Compra → combo/insumo → preparación → producto terminado → venta/fi ado/devolución.

## Modelo

- **Combo = `Product` con `sellable: false`.** Se compra con el flujo
  existente de surtida (proveedor, costo, caja, idempotencia, offline).
  No aparece en el selector de ventas ni en el catálogo del portal.
- **`Preparation`**: una transformación de un producto origen en N
  unidades de un producto destino. Historial inmutable: no se edita ni se
  borra; los errores se compensan con las herramientas existentes
  (merma sobre el terminado).
- El lote origen **no se descuenta** (su rendimiento total se desconoce
  en la compra); el registro es la traza de consumo. Un combo sin stock
  (>0 requerido) no puede originar preparaciones; un combo agotado se
  archiva con el flujo existente.

## Movimientos

Cada preparación escribe, en la misma transacción:

- destino: `delta +qty`, `reason preparacion`, `unitCost` asignado,
  `refType preparation`, `refId` = preparation id;
- origen: `delta 0`, `reason preparacion`, nota
  `Preparación de N × <destino>`, mismo `refType`/`refId`.

Sin movimientos de caja: el dinero salió en la compra (surtir).

## Costos

El costo es **explícito por preparación** (`unitCost`, 0 = pendiente con
semántica de regalo). El promedio ponderado lo absorbe con la fórmula
existente. El lote conserva su propio valor. **Nunca** se prorratea
automáticamente `$lote / N` (sería falso mientras quede material).

## Reglas

Origen ≠ destino; ambos activos y del mismo negocio; cantidad entera ≥ 1;
origen con stock > 0; día editable. Preparar no toca deuda, totales,
pagos ni ventas históricas. El terminado es un producto normal:
inventario, ventas, fiados, devoluciones, portal, fotos y stock bajo
funcionan sin código especial.

## Offline y sync

`prepararWithOfflineFallback`: online `POST /preparations`; sin conexión,
una transacción Dexie aplica stock/promedio, guarda la fila + movimientos
y encola `preparation:create` (idempotente por `requestId`). El sender la
registra y elimina la fila local (espejo pendiente; el servidor manda).
Historial: servidor online, Dexie offline. La imagen nunca bloquea la
operación financiera.

## API

- `POST /preparations` `{sourceId, targetId, qty, unitCost?, note?}` +
  `Idempotency-Key` (throttle 30/min).
- `GET /preparations?sourceId=&targetId=` (filtros validados, siempre
  acotados al negocio).
- `Product` acepta `sellable` en create/patch; el portal excluye insumos.

## UI

`/inventario/[id]/preparar` (origen fijo, selector de destino vendible,
cantidad, costo opcional con aviso de pendiente, nota). Detalle de
producto: botón Preparar, insignia Insumo, toggle insumo en edición e
historial de preparaciones en ambas direcciones. Ventas solo listan
vendibles.

## Reset

`DELETE /business/data` limpia `preparations` antes que productos
(FKs RESTRICT, orden seguro). Dexie limpia la tabla por negocio.

## Migraciones

- Prisma `20260923120000_preparations`: `sellable` (default true, sin
  cambios de comportamiento), `StockMoveReason.preparacion` (PG12+ admite
  `ADD VALUE` en transacción), tabla `preparations` con FKs RESTRICT.
- Dexie v9: tabla `preparations`. Filas locales sin `sellable` se leen
  como vendibles.

## Limitaciones honestas

- Sin reversa de preparación: se compensa con merma/ajuste existente.
- El "material restante" del combo es cualitativo (unidades ya
  preparadas visibles en su historial), no una cantidad.
- Costo 0 diluye el promedio: es intencional y visible ("Costo
  pendiente").
