# D10 — Veredicto general
Base `6f8f5ff1f3c1`. Respuestas a las 10 preguntas del BRIEF, solo con evidencia de los insumos (IDs DC- de D5).

**1. Estado.** Producto funcional y bastante maduro en el servidor: ventas, abonos, devoluciones, caja con Efectivo/Nequi separados, inventario con costo promedio, portal cliente y offline con outbox. Suites verdes (947 vitest, 270 jest, 69+3 Playwright) y 76/79 escenarios API aprobados (tests-matriz). Lo débil está en el borde: el offline al rechazar, la presentación de la deuda y la operación (respaldos, monitoreo, deps).

**2. Confiabilidad para dinero y deudas.** **Servidor: confiable** (I1–I5 sin desajustes, guardas atómicas, doble tap = 1 fila, concurrencia 201/409; D3 §7, tests-matriz FINAL). **Cliente offline y presentación: no confiable todavía**: un abono cobrado puede desaparecer (DC-01, CRÍTICA, demostrado) y compras pagadas siguen mostrándose «A crédito» (DC-04, demostrado). No usar en producción para fiados sin P0-3 y sin respaldos (DC-02).

**3. Cinco mayores riesgos.** DC-01 abono rechazado revertido en silencio · DC-02 sin respaldo + borrado total · DC-04 abono sin ligar a la venta (portal muestra deuda pagada) · DC-03 Next con aviso crítico · DC-05 sin anulación/reverso (con DC-09 homónimos como raíz de cargos al cliente equivocado).

**4. Bien diseñado.** Historial append-only sin PATCH/DELETE en dinero (D3 §8); idempotencia por requestId + advisory lock por negocio; día cerrado inmutable; precio y costo históricos en la línea; Nequi fuera del efectivo esperado; devoluciones con `splitReturnSettlement`; login del portal endurecido (bcrypt único, throttles) y ledger con scope de businessId.

**5. Mal diseñado.** `customer.debt` como caché sin conciliación (DC-20); saldo solo global (DC-04); rechazo = «nunca existió» en el outbox (DC-01, DC-14); fecha del servidor para operaciones offline (DC-06); idempotencia sin hash de payload (DC-13); tokens en localStorage (DC-11).

**6. Complicado de más.** Caja con carry/assign/pendientes y movimientos sin asignar (D3 §6) para un solo cajón; varias correcciones de FIFO en combos/preparación (D2: «Implementada con problemas»); vocabulario de dinero con 5 nombres distintos (DC-29).

**7. Faltante.** Reversos (DC-05), saldo por venta (DC-04), respaldo/export (DC-02), dinero recibido sin aplicar (DC-01), comprobante de acuerdo (D4), monitoreo (DC-23), userId/staff (DC-21), recuperación de contraseña (DC-41). Detalle en D6.

**8. Qué primero.** P0 de D8: respaldo (DC-02) → Next parcheado (DC-03) → abono rechazado sin reversión silenciosa + cierre que avisa pendientes (DC-01). Luego DC-04 y el SQL de invariante (DC-20) para investigar el caso real con datos.

**9. Qué conservar.** Separación ventas/recibido/fiado/caja/inventario; Efectivo+Nequi; combo como tipo; outbox con Idempotency-Key; candado de día cerrado (ajustando su política); estructura append-only; portal cliente existente (base del mecanismo de aceptación de D4).

**10. Preparación para crecer.** Baja-media. Bloqueantes: infra free (cold start 62 s, Neon 6 h PITR; DC-23, DC-02), sin CI de build ni main protegida (DC-25), migraciones al arrancar (DC-24), listados en memoria (DC-34), multiusuario sin trazabilidad (DC-21). El modelo de datos soporta crecer si se añaden imputación y reversos antes de acumular histórico.

**Honestidad:** la causa del caso real no está confirmada con datos de producción (D9). DC-01 y DC-04 son los mecanismos reproducidos que explican el síntoma.
