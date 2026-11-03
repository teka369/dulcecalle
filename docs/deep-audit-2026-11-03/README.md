# DulceCalle — Auditoría profunda (2026-11-03) · índice
Base `teka369/dulcecalle@6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c`. Solo lectura: sin cambios de código, commits, PRs, deploys ni acceso a Neon.

| # | Documento | Archivo | Autor |
|---|---|---|---|
| D1 | Estado actual | [D1-estado-actual.md](D1-estado-actual.md) | Investigador |
| D2 | Mapa funcional | [D2-mapa-funcional.md](D2-mapa-funcional.md) | Investigador |
| D3 | Integridad financiera (incl. caso real) | [D3-integridad-financiera.md](D3-integridad-financiera.md) | Developer |
| D4 | Comprobante de acuerdo | [D4-comprobante-acuerdo.md](D4-comprobante-acuerdo.md) | PM |
| D5 | Bugs y riesgos (54, deduplicados DC-01..54) | [D5-bugs-riesgos.md](D5-bugs-riesgos.md) | PM (consolidado) |
| D6 | Funcionalidades faltantes | [D6-faltantes.md](D6-faltantes.md) | PM |
| D7 | Mejoras | [D7-mejoras.md](D7-mejoras.md) | PM (consolidado) |
| D8 | Plan P0–P4 | [D8-plan-priorizado.md](D8-plan-priorizado.md) | PM (consolidado) |
| D9 | Cobertura y limitaciones | [D9-cobertura-limitaciones.md](D9-cobertura-limitaciones.md) | PM (consolidado) |
| D10 | Veredicto | [D10-veredicto.md](D10-veredicto.md) | PM (consolidado) |

Insumos: findings-inv/dev/qa/ops/ux, inventario-repo, tests-matriz, D-seguridad-tecnica, D-ux, logs/, evidence-dev/, ux-shots/.

## Decisiones para Juan
1. **Fecha del incidente**: ¿antes o después del 2026-10-26? Si fue antes, los datos estaban en la base de Render suspendida (D9).
2. **Día cerrado**: ¿aceptar abonos tardíos en la caja pendiente/siguiente en vez de rechazarlos? (DC-01, DC-16).
3. **Respaldo**: ¿autorizas pg_dump diario vía GitHub Actions con el secreto de BD, y a dónde? (DC-02).
4. **Imputación de abonos**: ¿FIFO automática o elegir la venta? (DC-04, D4).
5. **Reversos**: ¿se permite anular venta/abono y quién (owner/staff)? (DC-05).
6. **Saldo a favor**: ¿se permite pagar de más? (DC-17).
7. **Confirmación del cliente** en fiado/parcial: ¿obligatoria o sugerida? Formato del número DC- y vigencia del link (D4 §10).
8. **Valor legal**: ¿consultar abogado antes de cualquier copy jurídico? (D4 §4).
9. **Infra**: ¿seguir en free (cold start 62 s, PITR 6 h) o pagar plan? (DC-23, DC-02).
10. **Correr el SQL de detección de D3 §5 en solo lectura sobre Neon** para confirmar el caso real (D9).
