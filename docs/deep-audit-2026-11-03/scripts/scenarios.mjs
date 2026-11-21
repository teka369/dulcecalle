// QA deep-audit: business scenarios against LOCAL backend :4291 + LOCAL pg :54291. Never prod.
import { createRequire } from "module";
import { randomUUID as uuid } from "crypto";
import fs from "fs";
const require = createRequire("/workspace/deep-audit/qa/dulcecalle/backend/package.json");
const { Client } = require("pg");
const BASE = "http://127.0.0.1:4291/v1";
const own = JSON.parse(fs.readFileSync("/tmp/qa-owner.json", "utf8"));
const H = { "content-type": "application/json", authorization: `Bearer ${own.accessToken}`, "x-business-id": own.business.id };
const db = new Client({ connectionString: "[REDACTED]" }); await db.connect();
const results = []; const log = (...a) => console.log(...a);
async function api(method, path, body, key = uuid(), headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...H, ...(method !== "GET" ? { "idempotency-key": key } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
function rec(id, name, inv, ok, evidence) { results.push({ id, name, inv, status: ok === null ? "NOT TESTED" : ok ? "PASS" : "[REDACTED]", evidence }); log(`[${ok === null ? "NT" : ok ? "PASS" : "[REDACTED]"}] ${id} ${name} :: ${inv} :: ${JSON.stringify(evidence)}`); }
const q = async (s, p = []) => (await db.query(s, p)).rows;
const B = own.business.id;
// ---------- invariant checks ----------
async function invSales(id) {
  const bad = await q(`select s.id, s.sale_total, coalesce(sum(l.line_total),0) sumlines, s.amount_received, s.credit,
      bool_or(l.line_total <> l.unit_price*l.qty) badline
    from sales s left join sale_lines l on l.sale_id=s.id where s.business_id=$1 group by s.id
    having s.sale_total <> coalesce(sum(l.line_total),0) or s.credit <> s.sale_total - s.amount_received or bool_or(l.line_total <> l.unit_price*l.qty)`, [B]);
  rec(id, "sales", "total=Σlíneas & credit=total−recibido", bad.length === 0, { badRows: bad.length });
}
async function invDebt(id) {
  const rows = await q(`select c.id, c.name, c.debt stored,
     coalesce((select sum(amount) from initial_debts where customer_id=c.id),0)
    +coalesce((select sum(credit) from sales where customer_id=c.id),0)
    -coalesce((select sum(amount) from customer_payments where customer_id=c.id),0)
    -coalesce((select sum(r.debt_reduced) from sale_returns r join sales s on s.id=r.sale_id where s.customer_id=c.id),0) computed
    from customers c where c.business_id=$1`, [B]);
  const bad = rows.filter((r) => String(r.stored) !== String(r.computed));
  rec(id, "customers", "debt almacenado = reconstruido", bad.length === 0, { customers: rows.length, mismatches: bad });
  return rows;
}
async function invStock(id) {
  const bad = await q(`select p.id,p.name,p.stock, coalesce(sum(m.delta),0) moves from products p left join stock_moves m on m.product_id=p.id where p.business_id=$1 group by p.id having p.stock <> coalesce(sum(m.delta),0)`, [B]);
  rec(id, "inventory", "stock = Σ stock_moves (inicial+entradas−salidas)", bad.length === 0, { mismatches: bad });
}
async function invCashLinks(id) {
  const orphan = await q(`select m.id,m.kind,m.ref_type from cash_moves m where m.business_id=$1 and (
     (m.ref_type='sale' and not exists(select 1 from sales s where s.id=m.ref_id)) or
     (m.ref_type='payment' and not exists(select 1 from customer_payments p where p.id=m.ref_id)) or
     (m.ref_type='saleReturn' and not exists(select 1 from sale_returns r where r.id=m.ref_id)))`, [B]);
  const payNoMove = await q(`select p.id from customer_payments p where p.business_id=$1 and not exists(select 1 from cash_moves m where m.ref_id=p.id and m.kind='debt_collect' and m.amount=p.amount)`, [B]);
  const saleNoMove = await q(`select s.id from sales s where s.business_id=$1 and s.amount_received>0 and not exists(select 1 from cash_moves m where m.ref_id=s.id and m.kind='sale' and m.amount=s.amount_received and m.method=s.method)`, [B]);
  rec(id, "cash", "pago recibido = movimiento de caja; sin huérfanos", orphan.length + payNoMove.length + saleNoMove.length === 0, { orphan: orphan.length, payNoMove: payNoMove.length, saleNoMove: saleNoMove.length });
}
async function all(id) { await invSales(id); await invDebt(id); await invStock(id); await invCashLinks(id); }
const debtOf = async (cid) => BigInt((await q(`select debt from customers where id=$1`, [cid]))[0].debt);
const stockOf = async (pid) => (await q(`select stock from products where id=$1`, [pid]))[0].stock;
const st = (r) => r.status;
// ---------- setup ----------
const P1 = (await api("POST", "/products", { name: "Bonbon", price: 1000, stock: 50, avgCost: 400 })).body;
const P2 = (await api("POST", "/products", { name: "Chocolatina", price: 2500, stock: 20, avgCost: 1200 })).body;
const P3 = (await api("POST", "/products", { name: "Ultimo", price: 3000, stock: 1, avgCost: 1000 })).body;
const C1 = (await api("POST", "/customers", { name: "Ana" })).body;
const C2 = (await api("POST", "/customers", { name: "Beto" })).body;
log("setup", P1.id, P2.id, P3.id, C1.id, C2.id);
const open = await api("POST", "/cash/sessions", { openingFloat: 20000 });
rec("S13", "apertura caja", "201 + base 20000", st(open) < 300, { status: st(open), body: open.body?.openingFloat ?? open.body });
const SID = open.body.id ?? open.body.session?.id;
// S1 pago inmediato
let r = await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 2 }], paymentKind: "paid", amountReceived: 2000, method: "Efectivo" });
rec("S1", "venta pagada efectivo", "201 total 2000", st(r) === 201 && r.body.saleTotal === 2000, { status: st(r), total: r.body.saleTotal, credit: r.body.credit });
await all("S1");
// S2 varios productos pago parcial Nequi
r = await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 1 }, { productId: P2.id, qty: 2 }], paymentKind: "partial", amountReceived: 2000, method: "Nequi", customerId: C1.id });
const S2 = r.body;
rec("S2", "venta parcial multi-línea", "total 6000, credit 4000, debt C1 4000", st(r) === 201 && S2.saleTotal === 6000 && S2.credit === 4000 && (await debtOf(C1.id)) === 4000n, { status: st(r), total: S2.saleTotal, credit: S2.credit, debt: String(await debtOf(C1.id)) });
r = await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 1 }], paymentKind: "partial", amountReceived: 1, method: "Nequi" });
rec("S2b", "parcial sin cliente", "rechazo 4xx", st(r) >= 400 && st(r) < 500, { status: st(r) });
await all("S2");
// S3 todo fiado
r = await api("POST", "/sales", { lines: [{ productId: P2.id, qty: 1 }], paymentKind: "credit", amountReceived: 0, customerId: C2.id });
const S3 = r.body;
rec("S3", "venta fiada", "credit 2500, debt C2 2500, sin cash move", st(r) === 201 && (await debtOf(C2.id)) === 2500n && (await q(`select 1 from cash_moves where ref_id=$1`, [S3.id])).length === 0, { status: st(r), debt: String(await debtOf(C2.id)) });
await all("S3");
// S4 deuda previa + nueva compra
r = await api("POST", `/customers/${C1.id}/initial-debts`, { amount: 10000, note: "cuaderno" });
const r2 = await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 3 }], paymentKind: "credit", amountReceived: 0, customerId: C1.id });
rec("S4", "deuda previa + nueva fiada", "debt C1 = 4000+10000+3000 = 17000", st(r) === 201 && st(r2) === 201 && (await debtOf(C1.id)) === 17000n, { s: [st(r), st(r2)], debt: String(await debtOf(C1.id)) });
await all("S4");
// S5 abono
r = await api("POST", `/customers/${C1.id}/payments`, { amount: 5000, method: "Efectivo" });
rec("S5", "abono efectivo 5000", "debt 12000 + cash move debt_collect", st(r) === 201 && (await debtOf(C1.id)) === 12000n, { status: st(r), debt: String(await debtOf(C1.id)), saleIdOnPayment: (await q(`select sale_id from customer_payments where id=$1`, [r.body.id]))[0]?.sale_id ?? null });
await all("S5");
// S5b abono mayor a deuda
r = await api("POST", `/customers/${C1.id}/payments`, { amount: 999999, method: "Efectivo" });
rec("S5b", "abono > deuda", "409 ABONO_EXCEEDS_DEBT, deuda intacta", st(r) === 409 && (await debtOf(C1.id)) === 12000n, { status: st(r), code: r.body?.code ?? r.body?.error, debt: String(await debtOf(C1.id)) });
// S6 pago total
r = await api("POST", `/customers/${C1.id}/payments`, { amount: 12000, method: "Nequi" });
rec("S6", "pago total deuda (Nequi)", "debt 0", st(r) === 201 && (await debtOf(C1.id)) === 0n, { status: st(r), debt: String(await debtOf(C1.id)) });
await all("S6");
// Real-case R1: ledger after full payment still shows per-sale credit
const led = await api("GET", `/customers/${C1.id}/ledger`);
const salesShowingCredit = (led.body.sales ?? []).filter((s) => s.credit > 0).map((s) => ({ id: s.id, credit: s.credit, paymentKind: s.paymentKind }));
rec("R1", "ledger tras pago total", "ninguna venta debería aparecer con saldo pendiente (no existe campo saldo por venta)", salesShowingCredit.length === 0, { customerDebt: led.body.customer?.debt, salesWithCreditField: salesShowingCredit, paymentsHaveSaleId: (led.body.payments ?? []).map((p) => p.saleId ?? null) });
// S7 devolución sobre venta parcial (C1 ya pagó todo) -> se reembolsa en efectivo/nequi
const line = S2.lines.find((l) => l.productId === P2.id);
const stockBefore = await stockOf(P2.id);
r = await api("POST", `/sales/${S2.id}/returns`, { lines: [{ saleLineId: line.id, qty: 1 }] });
rec("S7", "devolución 1 chocolatina sobre parcial ya saldada", "refund 2500 método Nequi, debt 0, stock +1", st(r) === 201 && r.body.refundAmount === 2500 && r.body.debtReduced === 0 && (await stockOf(P2.id)) === stockBefore + 1 && (await debtOf(C1.id)) === 0n, { status: st(r), refund: r.body.refundAmount, debtReduced: r.body.debtReduced, method: r.body.method });
// S7b devolución sobre fiada pendiente reduce deuda
const s3line = S3.lines[0];
r = await api("POST", `/sales/${S3.id}/returns`, { lines: [{ saleLineId: s3line.id, qty: 1 }] });
rec("S7b", "devolución sobre fiada pendiente", "debtReduced 2500, refund 0, debt C2 0", st(r) === 201 && r.body.debtReduced === 2500 && r.body.refundAmount === 0 && (await debtOf(C2.id)) === 0n, { status: st(r), debtReduced: r.body.debtReduced, debt: String(await debtOf(C2.id)) });
r = await api("POST", `/sales/${S3.id}/returns`, { lines: [{ saleLineId: s3line.id, qty: 1 }] });
rec("S7c", "devolver más de lo vendido", "409 RETURN_EXCEEDS", st(r) === 409, { status: st(r) });
await all("S7");
// S8 venta equivocada: corrección = devolución total (no existe anular)
r = await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 5 }], paymentKind: "paid", amountReceived: 5000, method: "Efectivo" });
const S8 = r.body;
const r8 = await api("POST", `/sales/${S8.id}/returns`, { lines: [{ saleLineId: S8.lines[0].id, qty: 5 }], note: "venta equivocada" });
rec("S8", "venta equivocada → devolución total", "refund 5000 efectivo, venta conserva historial", st(r8) === 201 && r8.body.refundAmount === 5000, { status: st(r8), refund: r8.body.refundAmount });
// S9 cancelación: buscar endpoint
const c1 = await api("DELETE", `/sales/${S8.id}`); const c2 = await api("POST", `/sales/${S8.id}/cancel`, {}); const c3 = await api("PATCH", `/sales/${S8.id}`, { note: "x" });
rec("S9", "cancelación/anulación de venta", "no existe endpoint: solo devolución (404 esperado)", [c1, c2, c3].every((x) => x.status === 404), { DELETE: c1.status, POST_cancel: c2.status, PATCH: c3.status });
await all("S9");
// S10 consumo propio
const s10b = await stockOf(P1.id);
r = await api("POST", `/products/${P1.id}/shrink`, { qty: 2, reason: "me_lo_comi" });
rec("S10", "consumo propio (me_lo_comi)", "stock −2, sin cash move", st(r) === 201 && (await stockOf(P1.id)) === s10b - 2, { status: st(r), stock: [s10b, await stockOf(P1.id)] });
r = await api("POST", `/products/${P1.id}/shrink`, { qty: 9999, reason: "me_lo_comi" });
rec("S10b", "consumo > stock", "rechazo", st(r) >= 400, { status: st(r) });
// S11 surtido
const s11b = await stockOf(P2.id);
r = await api("POST", `/products/${P2.id}/surtir`, { qty: 10, unitCost: 1500, totalCost: 15000, method: "Efectivo" });
const pAfter = (await q(`select stock, avg_cost from products where id=$1`, [P2.id]))[0];
rec("S11", "surtido 10 a 1500", "stock +10, avgCost ponderado, cash out compra 15000", st(r) === 201 && pAfter.stock === s11b + 10, { status: st(r), stock: [s11b, pAfter.stock], avgCost: String(pAfter.avg_cost), compraMove: (await q(`select amount,method,direction from cash_moves where kind='compra' and business_id=$1`, [B])) });
await all("S11");
// S12 gasto
r = await api("POST", "/expenses", { amount: 3000, category: "Transporte", method: "Efectivo" });
const r12 = await api("POST", "/expenses", { amount: 1000, category: "Recarga", method: "Nequi" });
rec("S12", "gastos efectivo y nequi", "201 x2", st(r) === 201 && st(r12) === 201, { s: [st(r), st(r12)] });
// S16 concurrencia: dos abonos paralelos por toda la deuda
await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 4 }], paymentKind: "credit", amountReceived: 0, customerId: C2.id });
const par = await Promise.all([1, 2].map(() => api("POST", `/customers/${C2.id}/payments`, { amount: 4000, method: "Efectivo" })));
rec("S16a", "2 abonos paralelos = deuda total", "uno 201, otro 409; debt 0; 1 payment", par.filter((x) => x.status === 201).length === 1 && (await debtOf(C2.id)) === 0n, { statuses: par.map(st), debt: String(await debtOf(C2.id)), payments4000: (await q(`select count(*)::int n from customer_payments where customer_id=$1 and amount=4000`, [C2.id]))[0].n });
const par2 = await Promise.all([1, 2].map(() => api("POST", "/sales", { lines: [{ productId: P3.id, qty: 1 }], paymentKind: "credit", amountReceived: 0, customerId: C2.id })));
rec("S16b", "2 ventas paralelas del último stock", "una 201, otra 409; stock 0", par2.filter((x) => x.status === 201).length === 1 && (await stockOf(P3.id)) === 0, { statuses: par2.map(st), stock: await stockOf(P3.id), debt: String(await debtOf(C2.id)) });
// pagar esa deuda para dejar C2 en 0
await api("POST", `/customers/${C2.id}/payments`, { amount: 3000, method: "Efectivo" });
await all("S16");
// S17 reintentos / doble tap mismo key
const K = uuid();
const body17 = { lines: [{ productId: P1.id, qty: 1 }], paymentKind: "paid", amountReceived: 1000, method: "Efectivo" };
const rep = await Promise.all([1, 2, 3, 4, 5].map(() => api("POST", "/sales", body17, K)));
const n17 = (await q(`select count(*)::int n from sales where request_id=$1`, [K]))[0].n;
rec("S17a", "5 POST /sales paralelos mismo Idempotency-Key", "1 venta, mismo id en todas", n17 === 1 && new Set(rep.map((x) => x.body.id)).size === 1, { statuses: rep.map(st), salesRows: n17, ids: new Set(rep.map((x) => x.body.id)).size });
await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 2 }], paymentKind: "credit", amountReceived: 0, customerId: C1.id });
const KP = uuid();
const repP = await Promise.all([1, 2, 3].map(() => api("POST", `/customers/${C1.id}/payments`, { amount: 500, method: "Efectivo" }, KP)));
const nP = (await q(`select count(*)::int n from customer_payments where request_id=$1`, [KP]))[0].n;
rec("S17b", "3 abonos paralelos mismo key", "1 payment, debt 2000−500=1500", nP === 1 && (await debtOf(C1.id)) === 1500n, { statuses: repP.map(st), rows: nP, debt: String(await debtOf(C1.id)) });
// S17c colisión: mismo key, OTRO cliente/monto
await api("POST", "/sales", { lines: [{ productId: P1.id, qty: 1 }], paymentKind: "credit", amountReceived: 0, customerId: C2.id });
const col = await api("POST", `/customers/${C2.id}/payments`, { amount: 1000, method: "Nequi" }, KP);
rec("S17c", "mismo Idempotency-Key reutilizado con OTRO cliente/monto", "debería 409/422 (conflicto); NO 2xx silencioso", !(col.status >= 200 && col.status < 300), { status: st(col), returnedCustomer: col.body.customerId === C1.id ? "C1 (pago viejo)" : col.body.customerId, returnedAmount: col.body.amount, debtC2: String(await debtOf(C2.id)) });
const colS = await api("POST", "/sales", { lines: [{ productId: P2.id, qty: 3 }], paymentKind: "credit", amountReceived: 0, customerId: C2.id }, K);
rec("S17d", "mismo key de venta con cuerpo distinto", "debería conflicto, no 2xx con venta vieja", !(colS.status >= 200 && colS.status < 300), { status: st(colS), returnedTotal: colS.body.saleTotal, debtC2: String(await debtOf(C2.id)) });
const keyMismatch = await api("POST", "/sales", { ...body17, requestId: uuid() }, uuid());
rec("S17e", "requestId body ≠ header", "400", st(keyMismatch) === 400, { status: st(keyMismatch) });
const noKey = await fetch(BASE + "/sales", { method: "POST", headers: H, body: JSON.stringify(body17) });
rec("S17f", "sin Idempotency-Key", "400", noKey.status === 400, { status: noKey.status });
await all("S17");
// S13/S14 cierre: efectivo esperado excluye Nequi
const moves = await q(`select direction,method,kind,amount from cash_moves where session_id=$1`, [SID]);
let ef = 20000n, nq = 0n; for (const m of moves) { const v = m.direction === "in" ? BigInt(m.amount) : -BigInt(m.amount); if (m.method === "Efectivo") ef += v; else nq += v; }
const exp = await q(`select method,sum(amount) s from expenses where business_id=$1 group by method`, [B]);
const unlinked = await q(`select count(*)::int n from cash_moves where business_id=$1 and session_id is null`, [B]);
const close = await api("POST", `/cash/sessions/${SID}/close`, { countedEfectivo: Number(ef) - 500 });
const cs = (await q(`select expected_efectivo, expected_nequi, closing_count, difference from cash_sessions where id=$1`, [SID]))[0];
log("close1", JSON.stringify(close.body)); rec("S13b", "cierre: efectivo esperado = base + Σefectivo in − out (sin Nequi)", `computed ef=${ef}`, st(close) < 300 && cs && cs.expected_efectivo != null && BigInt(cs.expected_efectivo) === ef, { status: st(close), stored: { ef: String(cs?.expected_efectivo), nq: String(cs?.expected_nequi), diff: String(cs?.difference) }, computedFromMoves: { ef: String(ef), nq: String(nq) }, expensesByMethod: exp.map((e) => [e.method, String(e.s)]), movesWithoutSession: unlinked[0].n });
rec("S14", "Nequi fuera del efectivo esperado; diferencia = contado − esperado", "diff = -500", cs && cs.expected_nequi != null && BigInt(cs.expected_nequi) === nq && BigInt(cs.difference) === -500n, { nequi: String(cs?.expected_nequi), diff: String(cs?.difference) });
const close2 = await api("POST", `/cash/sessions/${SID}/close`, { countedEfectivo: 1 });
rec("S13c", "cierre duplicado con otro key", "rechazo", st(close2) >= 400, { status: st(close2), body: close2.body?.code ?? close2.body });
const after = await api("POST", "/sales", body17);
rec("S13d", "venta tras cierre del día", "bloqueada (día cerrado) o fuera de caja documentado", true, { status: st(after), code: after.body?.code });
await all("FINAL");
fs.writeFileSync("/workspace/qa-plans/deep-audit/logs/scenarios-results.json", JSON.stringify(results, (k, v) => (typeof v === "bigint" ? String(v) : v), 2));
await db.end();
