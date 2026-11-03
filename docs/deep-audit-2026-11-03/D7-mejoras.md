# D7 — Mejoras (consolidado)
Base `6f8f5ff1f3c1`. Solo lo propuesto en los insumos; cada fila cita su fuente. Los arreglos de bugs están en D5/D8; aquí van las mejoras.

## Técnicas
| Mejora | Valor | Fuente |
|---|---|---|
| Hash del payload por Idempotency-Key (409 si difiere) | Cierra éxito falso | DC-13 (D3-F03, F-03, OPS-14) |
| `ledgerVersion` o requestIds aplicados en snapshots; proyectar solo pendientes no incluidos | Evita deuda fantasma | DC-07 (D3-F02) |
| Revertir por deltas sin clamp a 0 | Saldo local correcto | DC-15 (F-04, D3-F12) |
| CHECK `debt >= 0` + endpoint de salud financiera + SQL de detección (D3 §5) | Detecta deriva de caché | DC-20 (INV-03, D3-F09) |
| `clientOccurredAt` acotado | Caja del día real | DC-06 (D3-F05) |
| Agregados SQL en stats y paginación de ledger/listas | Escala en Render free | DC-34 (INV-07, OPS-13) |
| Refresh en cookie HttpOnly / BFF, rotación de refresh | Sesión robusta | DC-11, DC-22 (OPS-04/05) |
| helmet, `x-powered-by` off, `@Max` en qty, hash dummy en login del dueño | Endurecimiento barato | DC-33, DC-42, DC-43 (OPS-06/12/15) |
| Migraciones en paso separado con snapshot previo y SQL de reversa; CI con build/lint/audit; main protegida | Deploy seguro | DC-24, DC-25 (OPS-08/09, INV-14) |
| Monitoreo: uptime en `/v1/health`, Sentry sin PII, alertas de cuota Neon y de deploy fallido | Ver fallos | DC-23 (OPS-07, D-seguridad §12) |
| Previews contra backend/branch Neon de staging | Aísla prod | DC-39 (OPS-17) |
| Actualizar API_CONTRACT y versionar AUDIT-STRUCTURAL | Docs fiables | DC-36, DC-37 (INV-10/11) |

## Funcionales
| Mejora | Fuente |
|---|---|
| Estado «dinero recibido sin aplicar» + saldo a favor | DC-01, DC-17 (D3-F01/F10, F-05) |
| Imputación FIFO visible por venta («Saldada / Pendiente $X») | DC-04 (F-01, INV-02, UX-10) |
| Reversos enlazados (`sale_void`, `payment_reversal`) con motivo | DC-05 |
| Comprobante de acuerdo MVP (número DC-, resumen, hash, link+PIN, marca verbal aparte) | D4 §9 |
| Antes de cerrar caja: sincronizar o avisar pendientes | DC-01 (F-02) |
| Export CSV/JSON por negocio y respaldo diario | DC-02 (OPS-03), D6-F7 |
| Contador permanente de operaciones sin enviar; `persist()` al iniciar | DC-27 (OPS-11) |
| userId en movimientos y alta de staff | DC-21 (INV-08) |
| catalogPrice junto a unitPrice | DC-35 (INV-09, OPS-18) |
| Diferencia `null` en cierres asumidos | DC-18 (INV-05) |
| Después: vencimiento del fiado + recordatorio por WhatsApp manual, margen por producto, antigüedad de deudas | D6-F9/F12, DC-53 |

## Visuales / UX
| Mejora | Fuente |
|---|---|
| Hoja de éxito tras vender («Fiado a Luis · $2.000») | DC-08 (UX-01) |
| Selector con código, teléfono parcial y deuda | DC-09 (UX-02) |
| Barra de Cobrar con cliente y deuda antes→después | DC-28 (UX-03, D4 §2) |
| Inicio: Vendido / Cobrado / Fiado hoy; glosario único | DC-10, DC-29 (UX-04/05) |
| Aviso de caja cerrada en Cobrar; banner correcto | DC-30, DC-31 (UX-06/07) |
| Confirmación o deshacer-con-reverso en devoluciones | DC-32 (UX-08) |
| «Se aplicó a: Venta #…» tras abono; nota del abono en portal | DC-04, DC-54 (UX-10, D4) |
| Errores distinguibles («no enviado» vs «enviado sin confirmar») | DC-46 (UX-11) |
| Pills sin tapar contenido; búsqueda en Ventas; «Surtir» directo; cierre con faltante guiado; objetivos ≥44 px | DC-47..DC-52 (UX-12..17) |

## Comerciales
| Mejora | Argumento | Fuente |
|---|---|---|
| «Comprobante por WhatsApp» como diferencial | Resuelve la discusión de fiado, sin costo de API | D4 §3, D-ux §ideas |
| Respaldo/exportación visible | Confianza para dejar el cuaderno | DC-02, D6-F7 |
| Portal cliente «al día» confiable (sin «A crédito» falso) | El portal ya existe; hoy puede generar desconfianza | DC-04 (F-01) |
| No vender analítica compleja aún | Valor bajo vs complejidad | D6-F14/F15 |
