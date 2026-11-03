# D9 — Cobertura y limitaciones
SHA único en todos los roles: `6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c` (clones frescos en `/workspace/deep-audit/<rol>/dulcecalle`). Sin porcentajes de cobertura: solo lo que consta en los insumos.

## ⚠ Caso real
- **La causa del caso real NO se confirmó con datos de producción.** Ningún rol consultó Neon ni Render (progress-ops.md, D3 §11, tests-matriz). D3 §5 es un ranking de mecanismos; los dos primeros (DC-01 abono offline revertido y DC-04 abono no ligado a la venta) están reproducidos localmente, no en producción.
- **Neon se creó vacío el 2026-10-26** (dato de Juan para esta consolidación; coincide con el commit `0044710` «update render.yaml for Neon», 2026-10-26 13:54 UTC-5, inventario-repo.md:63). Si el incidente fue **antes** de esa fecha, sus datos estaban en la base de Render que se suspendió (OPS-03: «Render expiró a los 30 días») y Neon no los contiene; el SQL de detección de D3 §5 no serviría para ese incidente.

## Áreas cubiertas
| Área | Rol / documento | Cómo |
|---|---|---|
| Estado actual, módulos, 36 funcionalidades, inventario de repo (ramas, PRs, 62 endpoints) | Inv · D1, D2, inventario-repo | Lectura de código |
| Dinero: escritores de `customer.debt`, invariantes, caja, idempotencia, concurrencia, caso real | Dev · D3, findings-dev | Código + e2e propio + vitest propios |
| Escenarios BRIEF 1–17 + R1 | QA · tests-matriz | API real en Postgres embebido + navegador + vitest |
| Seguridad, deps, CORS/CSP, backups, migraciones, cold start | Ops · D-seguridad-tecnica | Código, npm audit, curl GET/HEAD/OPTIONS a prod, gh api lectura |
| UX (9 operaciones, claridad de dinero, accesibilidad) | UX · D-ux, ux-shots | Build prod local + API mock |
| Comprobante de acuerdo, faltantes | PM · D4, D6 | Lectura de código |

## Pruebas ejecutadas (todas locales, nunca Neon)
| Suite | Resultado | Fuente |
|---|---|---|
| FE vitest | 151 archivos / 947 pasados | tests-matriz, progress-dev |
| FE vitest client-pg | 6/6 | tests-matriz |
| FE tsc / eslint / next build | exit 0 | tests-matriz |
| Playwright full / prod config | 69/69 · 3/3 (API mockeada) | tests-matriz |
| BE jest | 270 pasados, 1 omitido (fase69: snapshot privado no disponible) | tests-matriz, progress-dev |
| BE unit (inv) | 147/147 | D1:47 |
| Escenarios API run2 | 76 PASS / 3 FAIL (R1, S17c, S17d); run1 descartada por bug del script | tests-matriz |
| Repros offline QA R2/R3, demos dev (reject-revert, race, e2e D3) | reproducen DC-01, DC-15, DC-07, DC-13 | logs/, evidence-dev/ |
| npm audit raíz y backend | ver DC-03, DC-12 | OPS-01/02 |
| curl a prod (solo lectura) | health 62,44 s en frío (09:47 UTC-5); QA: timeout 20 s | OPS-07, tests-matriz |

## NOT TESTED / no verificado por rol
| Rol | Pendiente |
|---|---|
| Inv | vitest FE, e2e backend, Playwright, LCP, revisión profunda de `src/components`, `src/storage`, import legacy (progress-inv) |
| Dev | Invariante de inventario e2e; Playwright offline; equivalencia FE/BE de `splitReturnSettlement`; `offline-sales.ts`/`offline-returns.ts` en detalle (D3 §11, progress-dev) |
| QA | Dos dispositivos reales con outbox; e2e navegador+SW contra backend real; cachés SW/CatalogReadCache como causa; remap local→servidor de clientes; montos cerca de MAX_COP (tests-matriz §NO EJECUTADO) |
| Ops | Explotabilidad real de avisos next/express; EXPLAIN con datos reales; presencia de DATABASE_URL en Vercel no verificada por MCP; escaneo de secretos no exhaustivo (sin gitleaks) (D-seguridad §Limitaciones) |
| UX | Offline con SW real, modo oscuro, backend real; flujo de surtir por toques; paso siguiente del cierre con diferencia (D-ux §10) |
| PM | No ejecuté tests; Ley 527 citada sin verificar su aplicación; `stats.service.ts` no revisado a fondo (D4/D6) |

## Bloqueos y pendientes reales
1. Datos de producción: necesarios para confirmar el caso real (correr el SQL de D3 §5 en solo lectura, o revisar la bandeja de sync del teléfono del vendedor en busca de abonos `failed`).
2. Fecha del incidente vs 2026-10-26 (ver arriba).
3. Explotabilidad de CVEs: requiere pruebas activas no permitidas.
4. Tests con dos dispositivos reales.
5. Temporales: dev dejó 3 archivos de test sin commit en su clon (progress-dev); QA y Ops limpiaron. Ningún cambio en el repo remoto.
