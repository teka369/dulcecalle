import { getDb } from "./db";
import { saleRepository } from "@/repositories/saleRepository";
import { customerRepository } from "@/repositories/customerRepository";
import { productRepository } from "@/repositories/productRepository";
import { cashRepository } from "@/repositories/cashRepository";

/** Local calendar start-of-day (Inicio filters sales with createdAt >= this). */
export function startOfLocalDay(ms: number = Date.now()): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Demo catalog + today's activity for onboarding "Cargar demo".
 * Seeds sales dated today (local) so Inicio shows non-zero metrics,
 * and leaves ≥1 customer with debt > 0 for Registrar abono.
 */
export async function loadDemoData(): Promise<void> {
  const db = getDb();
  const count = await db.products.count();
  if (count > 0) {
    return;
  }

  const now = Date.now();
  // Midday today — always ≥ startOfLocalDay for Inicio aggregations.
  const todayMs = startOfLocalDay(now) + 12 * 60 * 60 * 1000;

  await db.transaction(
    "rw",
    db.products,
    db.customers,
    db.suppliers,
    db.settings,
    async () => {
      await db.products.bulkAdd([
        {
          name: "Chicle menta",
          category: "Chicles",
          price: 500,
          avgCost: 200,
          stock: 40,
          lowStockAt: 5,
          createdAt: now,
          updatedAt: now,
        },
        {
          name: "Chocolate barra",
          category: "Chocolates",
          price: 2500,
          avgCost: 1500,
          stock: 20,
          lowStockAt: 3,
          createdAt: now,
          updatedAt: now,
        },
        {
          name: "Gomitas oso",
          category: "Gomitas",
          price: 1500,
          avgCost: 800,
          stock: 25,
          lowStockAt: 5,
          createdAt: now,
          updatedAt: now,
        },
        {
          name: "Caramelo duro",
          category: "Caramelos",
          price: 300,
          avgCost: 100,
          stock: 100,
          lowStockAt: 10,
          createdAt: now,
          updatedAt: now,
        },
        // Low-stock demo row so Inicio "Stock bajo" is non-zero.
        {
          name: "Bombón café",
          category: "Bombones",
          price: 800,
          avgCost: 400,
          stock: 2,
          lowStockAt: 5,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.customers.bulkAdd([
        {
          name: "Doña Rosa",
          phone: "3001234567",
          debt: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          name: "Carlos",
          phone: "3109876543",
          debt: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.suppliers.bulkAdd([
        {
          name: "Distribuidora Sol",
          phone: "3015556677",
          notes: "Entrega martes y viernes",
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.settings.put({ key: "demoLoaded", value: "1" });
      await db.settings.put({ key: "businessName", value: "DulceCalle" });
    },
  );

  const products = await productRepository.list();
  const chicle = products.find((p) => p.name === "Chicle menta");
  const chocolate = products.find((p) => p.name === "Chocolate barra");
  const customers = await customerRepository.list();
  const rosa = customers.find((c) => c.name === "Doña Rosa");
  const carlos = customers.find((c) => c.name === "Carlos");

  if (!chicle?.id || !chocolate?.id || !rosa?.id || !carlos?.id) {
    throw new Error("demo seed missing catalog ids");
  }

  // S4: open today's caja so Inicio shows «Caja esperado» after demo.
  await cashRepository.openSession(0);

  // Paid sale today → Hoy vendido > 0
  const paidId = await saleRepository.createSale({
    lines: [{ productId: chicle.id, qty: 4 }],
    paymentKind: "paid",
    amountReceived: 2000,
    method: "Efectivo",
  });
  await db.sales.update(paidId, { createdAt: todayMs });
  const paidCash = await db.cashMoves
    .filter((m) => m.refType === "sale" && m.refId === paidId)
    .first();
  if (paidCash?.id != null) {
    await db.cashMoves.update(paidCash.id, { createdAt: todayMs });
  }
  const paidMoves = await db.stockMoves
    .filter((m) => m.refType === "sale" && m.refId === paidId)
    .toArray();
  for (const m of paidMoves) {
    if (m.id != null) await db.stockMoves.update(m.id, { createdAt: todayMs });
  }

  // Fiada sale today → customer debt > 0 (Registrar abono works)
  const creditId = await saleRepository.createSale({
    lines: [{ productId: chocolate.id, qty: 2 }],
    paymentKind: "credit",
    customerId: rosa.id,
    amountReceived: 0,
  });
  await db.sales.update(creditId, { createdAt: todayMs + 60_000 });
  const creditMoves = await db.stockMoves
    .filter((m) => m.refType === "sale" && m.refId === creditId)
    .toArray();
  for (const m of creditMoves) {
    if (m.id != null) {
      await db.stockMoves.update(m.id, { createdAt: todayMs + 60_000 });
    }
  }

  // Carlos remains zero-debt control (no credit sale).
  void carlos;
}

export async function isDbEmpty(): Promise<boolean> {
  const db = getDb();
  const products = await db.products.count();
  const sales = await db.sales.count();
  return products === 0 && sales === 0;
}

/** Helpers mirroring Inicio aggregations — used by demo regression tests. */
export async function demoInicioSnapshot(): Promise<{
  hoyVendido: number;
  porCobrar: number;
  stockBajo: number;
  customersWithDebt: number;
}> {
  const db = getDb();
  const today = startOfLocalDay();
  const sales = await db.sales.toArray();
  const todays = sales.filter((s) => s.createdAt >= today);
  const hoyVendido = todays.reduce((a, s) => a + s.saleTotal, 0);
  const customers = await db.customers.toArray();
  const porCobrar = customers.reduce((a, c) => a + c.debt, 0);
  const products = await db.products.toArray();
  const stockBajo = products.filter((p) => p.stock <= p.lowStockAt).length;
  const customersWithDebt = customers.filter((c) => c.debt > 0).length;
  return { hoyVendido, porCobrar, stockBajo, customersWithDebt };
}
