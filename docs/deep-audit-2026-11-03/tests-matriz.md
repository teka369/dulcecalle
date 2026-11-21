# Matriz de pruebas QA — Auditoría profunda DulceCalle (2026-11-03)

Repo `teka369/dulcecalle` main **6f8f5ff1f3c1c9cae4f734dd09a304fb947fa54c** (clon fresco `/workspace/deep-audit/qa/dulcecalle`).
Entorno: backend `dist` local en 127.0.0.1:4291 (launcher `scripts/launch-backend.js`), Postgres embebido local 127.0.0.1:54291 (BD `qa`, migraciones `prisma migrate deploy`), frontend build local (`NEXT_PUBLIC_API_URL=http://127.0.0.1:9/v1`, puerto muerto) en 3291/3292/3293. Nada contra Neon/producción.
Script: `scripts/scenarios.mjs` → `logs/scenarios-run2.log` (ejecución válida) + `logs/scenarios-results.json`. `logs/scenarios-run1.log` = 1ª corrida con bug DEL SCRIPT (comparación bigint string) — descartada, no es evidencia de producto.

Invariantes (columnas), comprobadas por SQL directo tras cada escenario:
- **I1** total venta = Σ líneas y línea = precio×cant; credit = total − recibido
- **I2** `customers.debt` almacenado = Σ initial_debts + Σ sales.credit − Σ customer_payments − Σ sale_returns.debt_reduced
- **I3** `products.stock` = Σ stock_moves.delta (inicial + entradas − salidas)
- **I4** pago recibido = cash_move (sale/debt_collect) con mismo monto/método; sin cash_moves huérfanos
- **I5** caja: efectivo esperado = base + Σ efectivo in − out (Nequi excluido); diferencia = contado − esperado

| # | Escenario | Estado inicial | Acción | Esperado | Obtenido | I1 | I2 | I3 | I4 | I5 | Estado | Evidencia |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Pago inmediato | caja abierta base 20000 | venta 2×1000 paid Efectivo | 201, total 2000 | 201, total 2000, credit 0 | PASS | PASS | PASS | PASS | — | aprobado | run2 `S1` |
| S2 | Varios productos, pago parcial | C1 deuda 0 | 1×1000+2×2500, partial 2000 Nequi | total 6000, credit 4000, deuda 4000 | idem | PASS | PASS | PASS | PASS | — | aprobado | `S2` |
| S2b | Parcial sin cliente | — | partial sin customerId | 4xx | 400 | — | — | — | — | — | aprobado | `S2b` |
| S3 | Todo fiado | C2 deuda 0 | credit 2500 | deuda 2500, sin cash move | idem | PASS | PASS | PASS | PASS | — | aprobado | `S3` |
| S4 | Deuda previa + nueva compra | C1 4000 | initial-debt 10000 + fiada 3000 | 17000 | 17000 | PASS | PASS | PASS | PASS | — | aprobado | `S4` |
| S5 | Abono | C1 17000 | abono 5000 Efectivo | 12000 + debt_collect | 12000; `customer_payments.sale_id = null` | PASS | PASS | PASS | PASS | — | aprobado (ver F-01: abono no se aplica a ninguna venta) | `S5` |
| S5b | Abono > deuda | 12000 | abono 999999 | 409 ABONO_EXCEEDS_DEBT, deuda intacta | idem | — | PASS | — | — | — | aprobado | `S5b` |
| S6 | Pago total de deuda | 12000 | abono 12000 Nequi | 0 | 0 | PASS | PASS | PASS | PASS | — | aprobado | `S6` |
| R1 | Vista tras pago total (caso real) | C1 deuda 0 | GET ledger + portal + vista dueño | ninguna compra marcada como pendiente | ledger: ventas con `credit` 4000/3000; portal “A crédito / Quedó a crédito $3.000” con saldo $0 | — | PASS (dato) | — | — | — | **fallido (UX/datos)** | `R1` run2, `logs/r1-*.png`, `logs/r1-portal-browser.log`, `logs/r1-owner-browser.log` |
| S7 | Devolución sobre parcial ya saldada | C1 0 | devolver 1×2500 | refund 2500 Nequi (método venta), deuda 0, stock +1 | idem | PASS | PASS | PASS | PASS | — | aprobado | `S7` |
| S7b | Devolución sobre fiada pendiente | C2 2500 | devolver 1 | debtReduced 2500, refund 0 | idem | PASS | PASS | PASS | PASS | — | aprobado | `S7b` |
| S7c | Devolver más de lo vendido | — | repetir devolución | 409 | 409 RETURN_EXCEEDS | — | — | — | — | — | aprobado | `S7c` |
| S8 | Venta equivocada | — | venta 5×1000 paid → devolución total | refund 5000, historial conservado | idem | PASS | PASS | PASS | PASS | — | aprobado (corrección solo vía devolución) | `S8` |
| S9 | Cancelación/anulación | — | DELETE / POST cancel / PATCH /sales/:id | no existe (404) | 404/404/404 | PASS | PASS | PASS | PASS | — | aprobado como “no implementado” (F-06) | `S9` |
| S10 | Consumo propio | stock 44 | shrink 2 me_lo_comi | stock 42, sin caja | idem | — | — | PASS | PASS | — | aprobado | `S10` |
| S10b | Consumo > stock | — | shrink 9999 | rechazo | 409 | — | — | — | — | — | aprobado | `S10b` |
| S11 | Surtido | stock 19 avg 1200 | surtir 10 a 1500 Efectivo | stock 29, avg ponderado, cash out 15000 | 29, avg 1303 (19×1200+10×1500)/29=1303.4→1303), compra out 15000 | PASS | PASS | PASS | PASS | — | aprobado | `S11` |
| S12 | Gasto | — | gasto 3000 Efectivo + 1000 Nequi | 201×2 | 201×2 | — | — | — | PASS | (en S13b) | aprobado | `S12` |
| S13 | Apertura caja | sin sesión | open base 20000 | 201 | 201 | — | — | — | — | — | aprobado | `S13` |
| S13b | Cierre: esperado efectivo | sesión con moves | close contado = esperado−500 | esperado = recomputado desde cash_moves | 17500 = 17500, nequi 10500 = 10500, 0 moves sin sesión | — | — | — | — | PASS | aprobado | `S13b` |
| S13c | Cierre duplicado (otra key) | cerrada | close otra vez | rechazo | 409 SESSION_ALREADY_CLOSED | — | — | — | — | PASS | aprobado | `S13c` |
| S13d | Venta tras cierre | día cerrado | venta | bloqueada | 409 | — | — | — | — | — | aprobado (pero ver F-02: también bloquea abonos pendientes) | `S13d`, `logs/r-dayclosed.log` |
| S14 | Cobro Nequi fuera de efectivo | — | idem S13b | Nequi no suma a efectivo; dif = −500 | idem | — | — | — | — | PASS | aprobado | `S14` |
| S15a | Offline (suite existente) | — | Playwright full + prod config (SW real, caja offline, cold load) | verde | 69/69 + 3/3 | — | — | — | — | — | aprobado (fixtures con API mockeada) | `logs/fe-playwright-*.log` |
| S15b | Abono offline rechazado por día cerrado | deuda local 50000 | abono offline 20000 → sync 409 CLOSED_DAY | dinero recibido no debería “desaparecer” | deuda vuelve a 50000, op `failed` permanente, cash move borrado | — | — | — | — | — | **fallido (reproduce caso real)** | `logs/fe-vitest-qa-repro.log` (R2), `logs/r-dayclosed.log` |
| S15c | Fiada offline rechazada + abono offline total | 50000 | fiada 6000 + abono 56000 offline; sync 409 stock y 409 exceso | deuda local 50000 | **56000** (sobrestima 6000) | — | FAIL (local) | — | — | — | **fallido** | `logs/fe-vitest-qa-repro.log` (R3) |
| S16a | 2 abonos paralelos = deuda total | C2 4000 | 2× abono 4000 paralelo | 1×201, 1×409, deuda 0 | [201,409], 0, 1 fila | PASS | PASS | PASS | PASS | — | aprobado | `S16a` |
| S16b | 2 ventas paralelas último stock | stock 1 | 2× fiada paralela | 1×201,1×409, stock 0 | [201,409], 0 | PASS | PASS | PASS | PASS | — | aprobado | `S16b` |
| S17a | Doble tap venta (mismo key ×5 paralelo) | — | 5 POST mismo key | 1 venta | 5×201, 1 fila, 1 id | PASS | PASS | PASS | PASS | — | aprobado | `S17a` |
| S17b | Doble tap abono (mismo key ×3) | C1 2000 | 3 POST | 1 pago, deuda 1500 | idem | PASS | PASS | PASS | PASS | — | aprobado | `S17b` |
| S17c | Key reutilizada, OTRO cliente/monto (abono) | C2 debe 1000 | POST pago C2 1000 con key de pago C1 | conflicto 409/422 | **201** devuelve pago viejo de C1 (500); deuda C2 sigue 1000 | — | PASS | — | — | — | **fallido** (F-03) | `S17c` |
| S17d | Key reutilizada, otro cuerpo (venta) | — | POST venta distinta con key ya usada | conflicto | **201** con venta vieja (total 1000) | — | — | — | — | — | **fallido** (F-03) | `S17d` |
| S17e/f | requestId≠header / sin key | — | — | 400 | 400/400 | — | — | — | — | — | aprobado | `S17e`,`S17f` |
| FINAL | Invariantes globales tras todo | — | SQL | — | 0 desajustes | PASS | PASS | PASS | PASS | PASS | aprobado | run2 `FINAL` |

## Conteo (filas de escenario, sin contar las 4×N comprobaciones de invariantes)
- Corrida API (`scenarios-run2.log`): **76 PASS / 3 FAIL** líneas (FAIL = R1, S17c, S17d). Todas las comprobaciones de invariantes I1–I4 (11 puntos × 4) = PASS; I5 PASS.
- Repro offline (vitest temporal, eliminado tras uso; copia en `scripts/zz-qa-audit-tmp.test.ts.txt`): R2 confirmado (test verde que afirma el comportamiento dañino), R3 falla la expectativa correcta (56000 vs 50000).
- Navegador real contra backend local (proxy Playwright → :4291, hosts Render/Vercel abortados, 0 fugas): R1 portal y vista dueño.

## NO EJECUTADO / BLOQUEADO
- **Dos dispositivos reales simultáneos con outbox** (multi-device offline → sync cruzado): NO TESTED — sólo simulado a nivel de unidad (R3) y API (S16); requeriría dos perfiles de navegador con SW y backend real, no alcanzado en el tiempo.
- **E2E offline del navegador contra backend real** (Playwright existentes usan API mockeada vía `context.route`): los 72 tests pasan pero NO prueban el backend real; el flujo offline→sync contra Nest real se cubrió con vitest+mocks (R2/R3) y API directa, no con navegador+SW+backend real.
- **Caches SW/CatalogReadCache obsoletas** como causa del caso real: NOT TESTED en navegador; sólo revisión de código (no se encontró evidencia demostrada).
- **Mapeo ID local→servidor de clientes** con abono: no ejecutado; el código bloquea abono sobre cliente no sincronizado (`offline-payments.ts` PENDING_CUSTOMER_MESSAGE) — revisión de código, no prueba.
- **Precisión monetaria con montos cercanos a MAX_COP**: NOT TESTED.
- `GET https://dulcecalle-teka369.onrender.com/v1/health`: timeout 20 s (exit 28, probable cold start de Render) — sin respuesta, nada concluido.

## Suites existentes (logs/*.log, `exit=` al final de cada log)
| Suite | Comando | Resultado |
|---|---|---|
| FE npm ci | `npm ci` | exit 0 |
| FE tsc | `npx tsc --noEmit` | exit 0 |
| FE eslint | `npx eslint --max-warnings=0` | exit 0 |
| FE vitest | `npx vitest run` | 151 files / 947 tests passed |
| FE vitest client-pg | `npx vitest run -c vitest.client-pg.config.ts` | 4 files / 6 tests passed |
| FE next build | `npm run build` (default) y con `NEXT_PUBLIC_API_URL=http://127.0.0.1:9/v1` | exit 0 / exit 0 |
| Playwright full | `E2E_PORT=3291 npx playwright test` | 69 passed (4.6 min) |
| Playwright prod cfg | `E2E_PORT=3292 npm run test:e2e:prod` | 3 passed (1.7 min) |
| BE npm ci / tsc / eslint / build | — | exit 0 ×4 |
| BE jest | `npx jest --runInBand --forceExit` | 37 suites passed, 1 skipped; 270 passed, 1 skipped (fase69 snapshot privado no disponible) |
