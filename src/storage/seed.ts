import { getDb } from "./db";

/** Demo catalog for onboarding button "Cargar demo". */
export async function loadDemoData(): Promise<void> {
  const db = getDb();
  const count = await db.products.count();
  if (count > 0) {
    return;
  }

  const now = Date.now();
  await db.transaction(
    "rw",
    db.products,
    db.customers,
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

      await db.settings.put({ key: "demoLoaded", value: "1" });
      await db.settings.put({ key: "businessName", value: "DulceCalle" });
    },
  );
}

export async function isDbEmpty(): Promise<boolean> {
  const db = getDb();
  const products = await db.products.count();
  const sales = await db.sales.count();
  return products === 0 && sales === 0;
}
