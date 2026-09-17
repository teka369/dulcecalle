import { getDb } from "@/storage/db";
import type {
  Customer,
  CustomerPayment,
  InitialDebt,
  PayMethod,
} from "@/domain/types";
import { asCop, addCop, subCop } from "@/domain/money";
import { ABONO_ERRORS } from "@/domain/abono";
import { INITIAL_DEBT_ERRORS } from "@/domain/initialDebt";
import { assertDayEditable } from "./dayGuard";

export type CustomerHistoryItem = {
  id: string;
  kind: "abono" | "fiada" | "parcial" | "inicial" | "devolucion";
  amount: number;
  method?: PayMethod;
  createdAt: number;
  label: string;
};

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
    const name = input.name?.trim() ?? "";
    if (!name) throw new Error("Ponle un nombre para guardarlo.");
    const debt = input.debt ?? 0;
    if (debt !== 0) {
      throw new Error(
        "La deuda anterior se registra aparte, no al crear el cliente.",
      );
    }
    asCop(debt);
    const now = Date.now();
    const id = await getDb().customers.add({
      name,
      phone: input.phone,
      debt,
      createdAt: now,
      updatedAt: now,
    });
    return id as number;
  }

  async listPayments(customerId: number): Promise<CustomerPayment[]> {
    const rows = await getDb()
      .customerPayments.where("customerId")
      .equals(customerId)
      .toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Short history: deudas anteriores + abonos + credit/partial sales.
   * Newest first; capped for ficha.
   */
  async listHistory(
    customerId: number,
    limit = 20,
  ): Promise<CustomerHistoryItem[]> {
    const db = getDb();
    const payments = await db.customerPayments
      .where("customerId")
      .equals(customerId)
      .toArray();
    const sales = await db.sales.where("customerId").equals(customerId).toArray();
    const initials = await db.initialDebts
      .where("customerId")
      .equals(customerId)
      .toArray();
    const returns = await db.saleReturns.toArray();

    const items: CustomerHistoryItem[] = [];

    for (const p of payments) {
      items.push({
        id: `pay-${p.id}`,
        kind: "abono",
        amount: p.amount,
        method: p.method,
        createdAt: p.createdAt,
        label: `Abono · ${p.method}`,
      });
    }

    for (const s of sales) {
      if (s.credit <= 0) continue;
      const kind = s.paymentKind === "partial" ? "parcial" : "fiada";
      items.push({
        id: `sale-${s.id}`,
        kind,
        amount: s.credit,
        createdAt: s.createdAt,
        label: kind === "parcial" ? "Parcial (fiado)" : "Fiada",
      });
    }

    for (const d of initials) {
      items.push({
        id: `inicial-${d.id}`,
        kind: "inicial",
        amount: d.amount,
        createdAt: d.createdAt,
        label: "Deuda anterior",
      });
    }

    const saleIds = new Set(
      sales.map((s) => s.id).filter((id): id is number => id != null),
    );
    for (const r of returns) {
      if (!saleIds.has(r.saleId) || r.debtReduced <= 0) continue;
      items.push({
        id: `dev-${r.id}`,
        kind: "devolucion",
        amount: r.debtReduced,
        createdAt: r.createdAt,
        label: "Devolución",
      });
    }

    items.sort((a, b) => b.createdAt - a.createdAt);
    return items.slice(0, limit);
  }

  /**
   * Load a pre-system debt. Increases customer.debt.
   * NOT a sale: no saleLines, stock, cash, ventas, or recibido.
   * Not a caja-day operation (same idea as product stock inicial).
   * Same requestId → returns the existing row (no second increment).
   */
  async recordInitialDebt(input: {
    customerId: number;
    amount: number;
    note?: string;
    requestId?: string;
  }): Promise<number> {
    if (!Number.isInteger(input.amount) || !Number.isFinite(input.amount)) {
      throw new Error(INITIAL_DEBT_ERRORS.empty);
    }
    if (input.amount <= 0) {
      throw new Error(INITIAL_DEBT_ERRORS.notPositive);
    }

    const amount = asCop(input.amount);
    const db = getDb();

    return db.transaction("rw", db.customers, db.initialDebts, async () => {
      if (input.requestId) {
        const existing = await db.initialDebts
          .where("requestId")
          .equals(input.requestId)
          .first();
        if (existing?.id != null) return existing.id;
      }

      const customer = await db.customers.get(input.customerId);
      if (!customer) throw new Error("customer not found");

      const newDebt = addCop(customer.debt, amount);
      await db.customers.update(customer.id!, {
        debt: newDebt,
        updatedAt: Date.now(),
      });

      const id = await db.initialDebts.add({
        customerId: input.customerId,
        amount,
        createdAt: Date.now(),
        note: input.note,
        requestId: input.requestId,
      } satisfies InitialDebt);

      return id as number;
    });
  }

  /**
   * Record an abono against customer debt.
   * Decreases debt (≥ 0), creates customerPayments + cashMoves (debt_collect).
   * Debt collection ≠ new sale. Closed day is rejected.
   * Same requestId → returns the existing payment (no double decrement).
   */
  async recordPayment(input: {
    customerId: number;
    amount: number;
    method: PayMethod;
    saleId?: number | null;
    note?: string;
    requestId?: string;
  }): Promise<number> {
    if (input.method !== "Efectivo" && input.method !== "Nequi") {
      throw new Error(ABONO_ERRORS.noMethod);
    }
    if (!Number.isInteger(input.amount)) {
      throw new Error(ABONO_ERRORS.empty);
    }
    if (input.amount <= 0) {
      throw new Error(ABONO_ERRORS.notPositive);
    }

    const amount = asCop(input.amount);
    const db = getDb();
    await assertDayEditable();

    return db.transaction(
      "rw",
      db.customers,
      db.customerPayments,
      db.cashMoves,
      db.cashSessions,
      async () => {
        await assertDayEditable();

        if (input.requestId) {
          const existing = await db.customerPayments
            .where("requestId")
            .equals(input.requestId)
            .first();
          if (existing?.id != null) return existing.id;
        }

        const customer = await db.customers.get(input.customerId);
        if (!customer) throw new Error("customer not found");
        if (amount > customer.debt) {
          throw new Error(ABONO_ERRORS.exceedsDebt);
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
          requestId: input.requestId,
        } satisfies CustomerPayment);

        const open = await db.cashSessions
          .filter((s) => s.closedAt == null)
          .first();
        await db.cashMoves.add({
          amount,
          direction: "in",
          method: input.method,
          kind: "debt_collect",
          refType: "customerPayment",
          refId: paymentId as number,
          sessionId: open?.id ?? null,
          createdAt: Date.now(),
        });

        return paymentId as number;
      },
    );
  }
}

export const customerRepository = new CustomerRepository();
