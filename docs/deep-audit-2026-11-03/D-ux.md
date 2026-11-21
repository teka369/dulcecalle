# D-ux — Auditoría UX profunda (Fase 9, Designer)

## 1. Método
- **Commit auditado:** `6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c` (origin/main, merge PR #41, 26 oct 2026 16:30 UTC-5). Clon fresco en `/workspace/deep-audit/ux/dulcecalle`, solo lectura (sin cambios, commits ni push).
- **Ejecución:** `NEXT_PUBLIC_API_URL=http://127.0.0.1:8797 next build --webpack` + `next start` en 127.0.0.1:8110. API simulada local (copia de `vp-tools/mockapi.mjs` en `/workspace/deep-audit/ux/tools/mock.mjs`, con modos FULL / EMPTY / CLOSED y un cliente homónimo «Ana Pérez C3»). Sesión falsa en localStorage, SW bloqueado. Nada de producción, datos ficticios.
- **Herramientas:** Playwright (`tools/run.mjs`, `run2.mjs`, `run3.mjs`): flujos tocando la UI como la dueña (conteo de toques), sondas por pantalla (h1, scroll horizontal, contraste AA calculado, objetivos <44 px, controles sin nombre) a 360 y 1440; flujos a 390. Datos: `ux-shots/flows.json`, `flows2.json`, `flows3-*.json`. Envíos al mock registrados en el log del mock.
- **Estado de evidencia:** se marca demostrado / probable / hipótesis en `findings-ux.md`.

## 2. Resumen
La app es sólida en lo básico: navegación clara de 5 pestañas + FAB, h1 único, 0 fallos AA en texto activo, 0 objetivos <44 px salvo uno, sin scroll horizontal, estados vacíos con acción, doble toque en Registrar = 1 solo POST, cierre de caja con diferencia pide confirmación, Estadísticas explica cada cifra. Los riesgos están en **confirmación y prevención de errores con dinero**: la venta registrada no muestra confirmación (UX-01), el selector de cliente no distingue homónimos ni muestra deuda (UX-02), Inicio presenta lo facturado como si fuera el dinero del día (UX-04), y no hay deshacer/anular (UX-08/09).
Hallazgos: **0 CRÍTICA · 3 ALTA · 7 MEDIA · 8 BAJA**.

## 3. Pasos por operación (desde Inicio, 390 px)
| Operación | Toques (escritura) | Medido | Fricción | Propuesta |
|---|---|---|---|---|
| Venta pagada (1 producto, efectivo) | **4** (0) | sí: FAB → producto → Cobrar → Registrar | Excelente. Pero no hay confirmación visible (UX-01) | Hoja de éxito 2 s + «Deshacer» |
| Venta parcial (2 productos) | **10** (2) | sí: FAB, prod, prod, Cobrar, Parcial, Cliente, buscar, elegir, Recibido, Registrar | Cliente sin código/deuda (UX-02); nombre no está en el resumen (UX-03) | Fila con código+deuda; «Recibido» con atajos; resumen con cliente |
| Venta fiada | **7** (0) | sí: FAB, prod, Cobrar, Fiada, Cliente, elegir, Registrar | Igual que parcial; ningún paso de revisión del total que queda debiendo | «Fiar a Luis · debe $20.000 → $22.000» |
| Abono | **5** (1) | sí: Clientes, cliente, Registrar abono, monto, Registrar | Buen contexto («Debe», «Todo $30.000», «Queda debiendo»). No dice a qué venta se aplicó (UX-10); error genérico (UX-11) | Desde Inicio › Fiados pendientes directo a abono (−1); recibo tras abono |
| Devolución | **5** (0) | sí: Ventas, venta, Devolver, +1, Devolver $1.500 | Sin búsqueda para encontrar la venta (UX-13); sin confirmación ni deshacer (UX-08) | Buscar en Ventas; resumen previo |
| Gasto | **5** (2) | parcial: Gastos, Nuevo, monto, concepto, «Confirmar gasto» (el clic final no se ejecutó por selector del script) | Texto explicativo repetido («No es retiro personal» ×2) | Recortar ayuda; atajos de concepto frecuente |
| Surtir / compra | **6** (2) | por pantalla (form verificado; flujo por toques no ejecutado): Inventario, producto, Surtir, cantidad, costo, Confirmar | El acceso rápido «Surtir» cambia a «Stock bajo» y no lleva a surtir (UX-14) | Acceso «Surtir» con buscador directo |
| Abrir caja | **3–4** (1) | pantalla verificada (caja cerrada); toques por inspección: pill «Abrir caja» en Inicio → base → Abrir | Bien. Se puede vender sin abrir (UX-07) | Aviso en Cobrar |
| Cerrar caja | **5** (+1 si diferencia) | sí hasta el CTA: Más, Caja, Cerrar caja, conteo, «¿Cerrar con diferencia?» | CTA en forma de pregunta; no guía qué hacer (UX-15) | «Volver a contar» / «Cerrar con faltante» |

## 4. Claridad del dinero
| Concepto | Dónde aparece | Etiqueta | ¿Se distingue? |
|---|---|---|---|
| Ventas (facturado) | Inicio hero, Ventas, Estadísticas | «Hoy», «Ventas de hoy», «Total listado», «Ventas» | En Inicio **no**: se muestra solo, duplicado, sin cobrado (UX-04) |
| Cobrado | Ventas, Estadísticas | «Recibido» | Sí en Ventas («Recibido $75.000 · Fiado $109.500»), no en Inicio |
| Fiado del período | Ventas | «Fiado» | Se confunde con «Por cobrar» (UX-05) |
| Deuda de clientes | Inicio, Clientes, Estadísticas | «Por cobrar», «Debe», «2 fiados» | Estadísticas lo aclara («No es el fiado generado en el período»); Inicio no |
| Caja (cajón) | Caja, Cerrar | «Efectivo esperado», «Entradas/Salidas», «Contado» | Sí, y separa Nequi («Nequi no cuenta en billetes»), aunque «Total» suma Nequi |
Riesgo: la dueña mira Inicio (pantalla diaria) y ve el facturado como ingreso. Propuesta: tarjeta «Hoy» con tres cifras: Vendido / Cobrado (Efectivo · Nequi) / Fiado, y «Deuda total de clientes» aparte.

## 5. Prevención de errores (olvidar un pago, cliente o venta equivocados)
- **Buscar cliente:** hay búsqueda por nombre (contiene), con foco automático. **Falta:** código, teléfono, deuda; homónimos idénticos (UX-02, demostrado).
- **Nombre visible al cobrar:** sí en la fila del selector; **no** en el resumen ni en el botón (UX-03).
- **Confirmación:** venta y devolución sin resumen previo; cierre de caja con diferencia sí. La confirmación posterior de venta **no se ve** (UX-01).
- **Deshacer / corregir:** no existe deshacer ni anular; solo devolución (UX-08, UX-09).
- **Duplicados:** doble toque en Registrar = 1 POST (demostrado, mockapi.log 14:56:50 UTC = 09:56 UTC-5) gracias a `busy` + `requestIdRef`. Riesgo residual: sin confirmación visible la dueña puede repetir la venta a propósito (UX-01).
- **Olvidar un pago:** el abono no se puede iniciar desde la venta ni desde Cobrar; si el cliente paga una deuda vieja al comprar, hay que ir aparte a Clientes → abono. Propuesta: en Cobrar con cliente que debe, mostrar «Debe $30.000 · ¿Abona también?».
- **Vender con caja cerrada:** permitido sin aviso (UX-07).

## 6. Descubribilidad y pasos innecesarios
- Difícil de encontrar: Surtir (dentro del producto; UX-14), Proveedores (pestaña dentro de Inventario), Gestionar cajas (solo si hay pendientes), Me lo comí/Regalo/Perdido (detalle del producto), Portal y PIN (detalle del cliente/Más), Estadísticas (enlace pequeño en hero o Más).
- Confuso: «Venta rápida · Abre la caja registradora» (UX-06); «Fiados» como acceso y como contador; «Cuenta» en Más lleva a /login.
- Innecesario: línea «Ventas de hoy» que repite el hero; el doble aviso en Gasto; el rebote por `/ventas/nueva` tras registrar.

## 7. ¿Le da información para decidir?
Sí en parte: Estadísticas (Hoy/Semana/Mes) con Recibido por método, Por cobrar, Gasté, Invertí, Ganancia aprox, Valor inventario y Stock bajo, cada una con nota clara; Inicio con Stock bajo y Fiados pendientes; estado de cuenta con saldo corrido. Falta: más vendidos y margen por producto, deudas por antigüedad («debe hace 30 días»), alerta de clientes que superan un tope, sugerencia de qué surtir (UX-18).

## 8. Ideas para el «comprobante de acuerdo» (solo ideas)
- **Cuándo:** opcional en venta Parcial/Fiada y en cada Abono; nunca obligatorio en una venta pagada pequeña. Tras «Registrar», la hoja de éxito (UX-01) ofrece «Enviar comprobante».
- **Contenido:** n.º de venta (DC-000125), fecha/hora, tienda, cliente (nombre + código), productos, Total / Pagado (medio) / Pendiente, saldo total del cliente antes→después, acuerdo (fecha compromiso opcional, nota), estado de sincronización, versión.
- **Compartir:** botón WhatsApp (`navigator.share`, ya usado en Portal), enlace al Portal del cliente con el comprobante, imagen/PDF, QR para mostrar en el mostrador.
- **Estados:** Borrador local → Registrado (sin sincronizar, marcado) → Enviado → Visto por el cliente → Confirmado por el cliente (botón en el portal o PIN) → Saldado / Corregido (reverso enlazado, nunca edición). Mostrar con chips en el estado de cuenta.
- **Aceptación del cliente:** distinguir «el dueño registró» de «el cliente confirmó»; lo más liviano: botón «Estoy de acuerdo» en el enlace del portal o PIN de un solo uso dicho en voz alta. No afirmar validez legal.
- **Abonos:** cada abono genera su propio mini-comprobante («Abonaste $5.000 · quedas debiendo $25.000») enlazado al acuerdo.
- **Anti-olvido:** recordatorio en Inicio de acuerdos vencidos; aviso «este comprobante aún no está en el servidor».

## 9. Recomendaciones priorizadas
1. **P1** Confirmación visible de venta con cliente/modalidad y «Deshacer» (UX-01).
2. **P1** Selector de cliente con código, teléfono y deuda; búsqueda por código (UX-02).
3. **P1** Inicio con Vendido / Cobrado / Fiado separados (UX-04).
4. **P2** Cliente en el resumen/botón de Cobrar y «¿abona también?» si debe (UX-03).
5. **P2** Glosario de dinero único (UX-05) y corregir «Abre la caja registradora» (UX-06).
6. **P2** Aviso de caja cerrada en Cobrar (UX-07).
7. **P2** Resumen/deshacer en devolución y «Corregir venta» por reverso (UX-08/09).
8. **P2** Mostrar a qué venta se aplicó el abono (UX-10).
9. **P3** Búsqueda en Ventas, acceso Surtir directo, pills que no tapen, CTA de cierre claro, errores específicos (UX-11..15).
10. **P4** Ajustes de accesibilidad menores (UX-16/17).

## 10. No verificado
- Comportamiento real del backend (asignación del abono a ventas, idempotencia del reintento tras el error de UX-11, cierre de caja tras «¿Cerrar con diferencia?»): solo mock.
- Flujo offline (venta sin red, outbox, SW real) en esta fase: no ejecutado; ver pasadas previas `loop-v1/designer-pass3.md`.
- Toque final de Gasto y flujo completo de Surtir/Abrir caja por clics: los selectores del script fallaron; los pasos se contaron por pantalla/código.
- Cifras de Estadísticas: provienen del fixture del mock (no coherentes entre sí); solo se evaluaron etiquetas y notas.
- Modo oscuro y otros temas, 768/1024, lectores de pantalla reales, teléfono físico, velocidad en red móvil real (la velocidad percibida no se midió; el indicador «Preparando» quedó fijo con el mock).
- Contraste: solo tema amber claro, medición automática de texto, no de iconos/bordes.
- Portal del cliente: no revisado en esta fase.
