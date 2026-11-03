# Hallazgos UX — Fase 9 (Designer) · commit 6f8f5ff
Formato BRIEF (ID · Nombre · Severidad · Categoría · Descripción · Evidencia · Archivos · Flujo · Causa raíz · Consecuencias · Probabilidad · Solución · Riesgos · Prioridad · Estado de evidencia).
Entorno: build de producción local (127.0.0.1:8110) + API mock local (fixtures ficticios). Capturas en `ux-shots/`. Nada tocó producción.

## UX-01 · La confirmación de venta registrada nunca se ve
- **Severidad:** ALTA · **Categoría:** Problema UX / Riesgo financiero · **Prioridad:** P1 · **Estado:** demostrado (mock)
- **Descripción:** Al tocar «Registrar», `clear()` vacía el carrito; el efecto de la línea 84 redirige de inmediato a `/ventas/nueva` (desmontando Cobrar y su toast), y 700 ms después a `/`. El toast «Venta registrada» / «Venta guardada en este dispositivo…» no llega a pintarse.
- **Evidencia:** `src/app/ventas/cobrar/page.tsx:84,143-148`; muestreo cada 100 ms durante 3 s tras Registrar: 0 nodos `role=status` con texto (`ux-shots/flows2.json → toastTimeline`); URL `/ventas/cobrar → /ventas/nueva (≈119 ms) → / (≈748 ms)`; capturas `venta-pagada-04-toast-390.png`, `venta-fiada-07-toast-390.png` (Nueva venta vacía, sin mensaje).
- **Flujo:** venta pagada/parcial/fiada (online y offline).
- **Causa raíz:** demostrada en código: la redirección por carrito vacío gana a la del toast.
- **Consecuencias:** la dueña no sabe si quedó registrada (ni si quedó offline); tienta a repetir la venta → duplicados; en fiado no ve a quién se cargó.
- **Solución:** pantalla/hoja de éxito breve en Inicio («Fiado a Luis Gómez · $ 2.000 · Deshacer») o pasar el mensaje como estado a `/`; evitar el rebote por carrito vacío tras éxito.
- **Riesgos:** bajo; cuidar que «Deshacer» sea reverso (no borrado).

## UX-02 · Selector de cliente en Cobrar: homónimos indistinguibles, sin deuda ni código
- **Severidad:** ALTA · **Categoría:** Riesgo financiero / Problema UX · **Prioridad:** P1 · **Estado:** demostrado
- **Descripción:** La hoja «Selecciona cliente» muestra solo `c.name`. Con dos «Ana Pérez» (C1 debe $30.000; C3 al día) aparecen dos filas idénticas. En /clientes sí se muestra el código (C1/C3) y la deuda.
- **Evidencia:** `src/components/customers/CustomerPicker.tsx:29,104`; `flows3-FULL.json → picker: ["Ana Pérez","Luis Gómez","Ana Pérez"]`; `picker-duplicados-390.png` vs `clientes-duplicados-390.png`.
- **Consecuencias:** fiado o parcial cargado al cliente equivocado (raíz plausible de «pagó pero sigue debiendo»).
- **Solución:** mostrar código, teléfono parcial y deuda actual por fila; buscar también por código/teléfono; resaltar el cliente elegido en la barra de acción.

## UX-03 · El nombre del cliente no está en el resumen final de Cobrar ni hay paso de revisión para fiado
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado:** demostrado
- **Descripción:** La barra inferior dice «$ 2.000 · Fiada» sin el cliente; «Registrar» confirma de inmediato (sin resumen). El cliente solo está en la fila del selector, que en parcial queda arriba del campo «Recibido».
- **Evidencia:** `src/app/ventas/cobrar/page.tsx:155-157`; `flows2.json → actionbarFiada`; `venta-parcial-09-parcial-lleno-390.png`.
- **Solución:** resumen «$ 2.000 · Fiada a Luis Gómez (debe $ 20.000 → $ 22.000)» en la barra y en el botón («Fiar a Luis»).

## UX-04 · Inicio muestra «Hoy $184.500» = facturado (incluye fiado) sin separar lo cobrado
- **Severidad:** ALTA · **Categoría:** Problema UX (claridad de dinero) · **Prioridad:** P1 · **Estado:** demostrado
- **Descripción:** El número grande de Inicio y la línea «VENTAS DE HOY» repiten el mismo total (Σ `saleTotal`), que incluye $109.500 fiados en el fixture. No hay «cobrado hoy» ni «en caja» en Inicio; «Por cobrar $ 50.000» al lado es la deuda total de clientes (otra base). En Ventas sí aparece «Recibido $ 75.000 · Fiado $ 109.500».
- **Evidencia:** `src/components/dashboard/InicioDashboard.tsx:195,210,236`; `src/data/pwa/dashboard.ts:331`; `scr-inicio-360.png`; `scr-ventas-360.png`.
- **Consecuencias:** la dueña cree que tiene $184.500 cuando entró mucho menos; dificulta cuadrar caja.
- **Solución:** hero con 3 cifras etiquetadas: «Vendido», «Cobrado (efectivo/Nequi)», «Fiado hoy»; quitar la línea duplicada.

## UX-05 · Vocabulario de dinero ambiguo entre pantallas
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado:** demostrado (textos)
- **Descripción:** «Por cobrar» (Inicio, Estadísticas) = deuda actual de clientes; «Fiado» (Ventas) = crédito generado por las ventas listadas; «Fiados» es a la vez accesos rápido (→ Clientes) y contador («2 fiados» = deudores); «Recibido» (Ventas/Estadísticas) vs «Entradas» (Caja); «Caja» incluye Nequi en «Total» pero dice «Nequi no cuenta en billetes». Estadísticas ya explica cada cifra con una nota (bien hecho), pero Inicio no.
- **Evidencia:** `scr-inicio-360.png`, `scr-ventas-360.png`, `scr-stats-360.png`, `scr-caja-360.png`.
- **Solución:** glosario único (Vendido / Cobrado / Fiado del día / Deuda de clientes / Efectivo en cajón / Nequi) y usarlo igual en todas las pantallas.

## UX-06 · «Venta rápida · Abre la caja registradora» lleva a Nueva venta
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado:** demostrado
- **Descripción:** El banner de Inicio dice «Abre la caja registradora» pero abre la pantalla de venta, mientras «Caja» en la app es la sesión del cajón (abrir/cerrar). Aparece incluso con caja ya abierta, y con caja cerrada junto al pill «Abrir caja».
- **Evidencia:** `InicioDashboard.tsx:159`; `scr-inicio-360.png`; `closed-inicio-390.png`.
- **Solución:** «Vender · Toca para empezar» o, si la caja está cerrada, un banner real «Abre la caja para cuadrar hoy» → /mas/caja.

## UX-07 · Se puede vender con la caja cerrada sin ningún aviso
- **Severidad:** MEDIA · **Categoría:** Riesgo financiero / UX · **Prioridad:** P2 · **Estado:** demostrado (código) / probable (efecto en caja)
- **Descripción:** Cobrar no consulta el estado de caja (`grep caja|cash` en `cobrar/page.tsx` y `checkout.ts` = 0 referencias a sesión). Con caja cerrada, Inicio sigue ofreciendo «Venta rápida».
- **Evidencia:** `closed-inicio-390.png`, `closed-caja-390.png`; `src/app/ventas/cobrar/page.tsx`.
- **Consecuencias:** ventas en efectivo «fuera de caja» → cierre que no cuadra / «movimientos sin caja» (la app ya tiene Gestionar cajas para eso).
- **Solución:** aviso no bloqueante en Cobrar si Efectivo y caja cerrada: «La caja está cerrada · Abrir con base $…».

## UX-08 · Devolución sin confirmación ni deshacer
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado:** demostrado
- **Descripción:** Un toque en «Devolver $ 1.500» envía el POST `/sales/:id/returns` directamente; no hay deshacer en ninguna parte de la app (grep «Deshacer|undo» = 0).
- **Evidencia:** `src/app/ventas/[id]/devolver/page.tsx:281-284`; `tools/mock.log`/`vp-tools/mockapi.log` POST `/sales/…22/returns` 14:50:46 UTC (09:50 UTC-5); `devolucion-05-confirm-390.png`.
- **Solución:** resumen previo («Vuelven 1 Gomitas · Baja deuda de Ana $1.500 / Devuelves $… en efectivo») o deshacer por 5 s con reverso.

## UX-09 · No existe anular/corregir una venta equivocada desde la UI
- **Severidad:** MEDIA · **Categoría:** Falta de funcionalidad · **Prioridad:** P2 · **Estado:** demostrado (código: sin «Anular»; Venta solo ofrece «Devolver»)
- **Evidencia:** `scr-venta-360.png` (acciones: Devolver); grep «Anular|anular» en app/components = 0.
- **Consecuencias:** para corregir cliente/modalidad equivocados la dueña debe «devolver» (afecta inventario) y re-vender; no se puede reasignar un fiado mal cargado.
- **Solución:** «Corregir venta» = reverso + nueva venta enlazadas, con motivo.

## UX-10 · El abono va al saldo total del cliente; no se ve a qué venta se aplica
- **Severidad:** MEDIA · **Categoría:** Problema UX · **Prioridad:** P2 · **Estado:** demostrado (pantalla) / hipótesis (asignación backend no revisada por UX)
- **Descripción:** «Registrar abono» muestra «Ana Pérez · Debe $30.000» y «Queda debiendo $25.000» (bien), pero no qué venta(s) quedan saldadas. El estado de cuenta usa saldo corrido (bien).
- **Evidencia:** `abono-04-abono-lleno-390.png`, `scr-cliente-360.png`.
- **Solución:** tras el abono, mostrar «Se aplicó a: Venta #001 ($32.000 → $27.000)».

## UX-11 · Mensaje de error genérico en abono
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado:** demostrado (con mock que responde 201 sin cuerpo válido) — el POST sí salió
- **Descripción:** Tras enviar, se mostró «Revisa los datos e inténtalo de nuevo.» bajo el monto aunque el servidor (mock) recibió el abono. En real, un error de mapeo tras un POST exitoso induciría a reintentar. El `requestIdRef` debería hacerlo idempotente (no verificado contra backend).
- **Evidencia:** `abono-05-toast-390.png`; POST `/customers/…11/payments` 14:50:36 UTC en mockapi.log.
- **Solución:** distinguir «no se pudo enviar» de «enviado, no pudimos confirmar» y mostrar el estado en Sincronización.

## UX-12 · Pills flotantes de sincronización tapan contenido
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado:** demostrado
- **Descripción:** «✓ En el servidor» y «↻ Preparando» quedan fijos sobre el contenido justo encima de la barra/acción (tapan el título «Fiados pendientes», filas de Estadísticas y el pie del estado de cuenta).
- **Evidencia:** `src/components/shell/PrepIndicator.tsx:54`, `SyncPill.tsx:36`; `scr-inicio-360.png`, `scr-stats-360.png`, `scr-cliente-360.png`, `venta-parcial-09-parcial-lleno-390.png` (tapan la etiqueta «Nota»).
- **Solución:** reservar espacio (padding inferior) o integrar el estado en el encabezado.

## UX-13 · No hay búsqueda en Ventas
- **Severidad:** BAJA · **Categoría:** Falta de funcionalidad · **Prioridad:** P3 · **Estado:** demostrado
- **Descripción:** Ventas tiene filtros Todas/Pagadas/Parcial/Fiadas pero no búsqueda por cliente/producto/monto; encontrar la venta a devolver obliga a desplazarse.
- **Evidencia:** `scr-ventas-360.png`; `src/app/ventas/page.tsx` sin input de búsqueda.

## UX-14 · Acceso rápido cambia de nombre («Surtir» ↔ «Stock bajo») y no lleva a surtir
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado:** demostrado
- **Evidencia:** `InicioDashboard.tsx:23,150`; `scr-inicio-360.png` («Stock bajo») vs `empty-inicio-390.png` («Surtir»); ambos → /inventario. Surtir real = Inventario → producto → Surtir.
- **Solución:** etiqueta estable «Surtir» que abra un buscador de producto directo a `/inventario/:id/surtir`.

## UX-15 · Cerrar caja: el botón es una pregunta
- **Severidad:** BAJA · **Categoría:** Problema UX · **Prioridad:** P3 · **Estado:** demostrado (texto) / no verificado (paso siguiente)
- **Descripción:** Con diferencia, el CTA pasa a «¿Cerrar con diferencia?» y el cuerpo repite la misma pregunta sin explicar qué hacer (contar de nuevo / registrar motivo). Un toque no envió cierre (sin POST de cierre en el log).
- **Evidencia:** `cerrar-caja-05-post-390.png`.
- **Solución:** «Falta $5.000» + botones «Volver a contar» / «Cerrar con faltante $5.000» y nota opcional.

## UX-16 · Enlace «Ana Pérez» en detalle de venta mide 65×20 px
- **Severidad:** BAJA · **Categoría:** Problema UX (accesibilidad) · **Prioridad:** P4 · **Estado:** demostrado
- **Evidencia:** `flows.json → audit["venta@360"].tiny`; `scr-venta-360.png`. Resto de pantallas auditadas: 0 objetivos <44 px, 0 controles sin nombre, 1 h1, sin scroll horizontal (360 y 1440).

## UX-17 · Resumen deshabilitado «0 productos · $ 0» con contraste 1,35:1
- **Severidad:** BAJA · **Categoría:** Mejora opcional · **Prioridad:** P4 · **Estado:** demostrado (medición automática; estado inactivo, WCAG lo exime)
- **Evidencia:** `flows.json → audit["nueva@360"].fails`.

## UX-18 · Estadísticas sin margen por producto ni deudas por antigüedad
- **Severidad:** BAJA · **Categoría:** Falta de funcionalidad · **Prioridad:** P3 · **Estado:** demostrado (pantalla)
- **Descripción:** Estadísticas da Ventas / Recibido / Por cobrar / Gasté / Invertí / Ganancia aprox / Valor inventario (con notas claras), pero no top productos, margen por producto, días de deuda ni clientes con deuda vieja.
- **Evidencia:** `scr-stats-360.png`.
