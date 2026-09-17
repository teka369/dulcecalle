import { getDb } from "@/storage/db";
import type { Customer, CustomerPayment, PayMethod } from "@/domain/types";
import { asCop, addCop, subCop } from "@/domain/money";

export class CustomerRepository {
  async list(): Promise<Customer[]> {
    return getDb().customers.orderBy("name").toArray();
  }

  async getById(id: number): Promise<Customer | undefined> {
    return getDb().customers.get(id);
  }

  async withDebt(): Promise<Customer[]> {
    const all = await this.list();
    return all.filter((c) => c.debt > 0);
  }

  async totalDebt(): Promise<number> {
    const all = await this.list();
    return all.reduce((sum, c) => addCop(sum, c.debt), 0);
  }

  async create(
    input: Omit<Customer, "id" | "createdAt" | "updatedAt" | "debt"> & {
      debt?: number;
    },
  ): Promise<number> {
    const debt = input.debt ?? 0;
    if (debt < 0) throw new Error("debt must be ≥ 0");
    asCop(debt);
    const now = Date.now();
    const id = await getDb().customers.add({
      name: input.name,
      phone: input.phone,
      debt,
      createdAt: now,
      updatedAt: now,
    });
    return id as number;
  }

  /**
   * Record an abono against customer debt.
   * debt is never allowed to go negative.
   */
  async recordPayment(input: {
    customerId: number;
    amount: number;
    method: PayMethod;
    saleId?: number | null;
    note?: string;
  }): Promise<number> {
    const amount = asCop(input.amount);
    if (amount <= 0) throw new Error("payment amount must be > 0");

    const db = getDb();
    return db.transaction(
      "rw",
      db.customers,
      db.customerPayments,
      db.cashMoves,
      async () => {
        const customer = await db.customers.get(input.customerId);
        if (!customer) throw new Error("customer not found");
        if (amount > customer.debt) {
          throw new Error("payment exceeds debt");
        }
        const newDebt = subCop(customer.debt, amount);
        if (newDebt < 0) throw new Error("debt must be ≥ 0");

        await db.customers.update(customer.id!, {
          debt: newDebt,
          updatedAt: Date.now(),
        });

        const paymentId = await db.customerPayments.add({
          customerId: input.customerId,
          amount,
          method: input.method,
          saleId: input.saleId ?? null,
          createdAt: Date.now(),
          note: input.note,
        } satisfies CustomerPayment);

        await db.cashMoves.add({
          amount,
          direction: "in",
          method: input.method,
          kind: "abono",
          refType: "customerPayment",
          refId: paymentId as number,
          sessionId: null,
          createdAt: Date.now(),
        });

        return paymentId as number;
      },
    );
  }
}

export const customerRepository = new CustomerRepository();
