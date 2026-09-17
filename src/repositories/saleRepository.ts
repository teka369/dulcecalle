import { getDb } from "@/storage/db";
import type {
  CreateReturnInput,
  CreateSaleInput,
  PayMethod,
  PaymentKind,
  Sale,
  SaleLine,
  SaleReturn,
} from "@/domain/types";
import { asCop, mulCop, addCop, subCop } from "@/domain/money";
import { SALE_ERRORS } from "@/domain/sale/validate";
import {
  RETURN_ERRORS,
  returnLineValue,
  splitReturnSettlement,
} from "@/domain/sale/returns";
import { assertDayEditable } from "./dayGuard";

function assertPaymentMath(
  kind: PaymentKind,
  saleTotal: number,
  amountReceived: number,
): { credit: number } {
  const total = asCop(saleTotal);
  const received = asCop(amountReceived);
  if (received < 0 || received > total) {
    throw new Error("amountReceived must be between 0 and saleTotal");
  }

  if (kind === "paid") {
    if (received !== total) {
      throw new Error("paid sale requires amountReceived === saleTotal");
    }
    return { credit: 0 };
  }
  if (kind === "credit") {
    if (received !== 0) {
      throw new Error("credit (fiada) sale requires amountReceived === 0");
    }
    return { credit: total };
  }
  // partial
  if (received <= 0 || received >= total) {
    throw new Error("partial sale requires 0 < amountReceived < saleTotal");
  }
  return { credit: subCop(total, received) };
}

function resolveLineUnitPrice(
  catalogPrice: number,
  override: number | undefined,
): number {
  if (override === undefined) return asCop(catalogPrice);
  if (!Number.isInteger(override) || override < 0) {
    throw new Error(SALE_ERRORS.badPrice);
  }
  return asCop(override);
}

export class SaleRepository {
  async list(): Promise<Sale[]> {
    return getDb().sales.orderBy("createdAt").reverse().toArray();
  }

  async getById(id: number): Promise<Sale | undefined> {
    return getDb().sales.get(id);
  }

  async linesForSale(saleId: number): Promise<SaleLine[]> {
    return getDb().saleLines.where("saleId").equals(saleId).toArray();
  }

  /** Sum of saleTotal across all sales (VENTAS — never mix with caja/fiado). */
  async sumSaleTotals(): Promise<number> {
    const sales = await this.list();
    return sales.reduce((s, sale) => addCop(s, sale.saleTotal), 0);
  }

  /**
   * Atomic sale: sale + saleLines + stockMoves + optional cashMoves + debt.
   * Snapshots unitPrice (override or catalog) and unitCost on each line.
   * Changing product.price / avgCost later does NOT rewrite history.
   * Stock never goes negative. Closed day is rejected.
   * Same requestId → returns the existing sale id (no second stock/cash/debt).
   */
  async createSale(input: CreateSaleInput): Promise<number> {
    if (!input.lines.length) throw new Error(SALE_ERRORS.empty);

    const needsCustomer =
      input.paymentKind === "partial" || input.paymentKind === "credit";
    if (needsCustomer && (input.customerId == null || input.customerId <= 0)) {
      throw new Error("Parcial/Fiada require customer");
    }

    const method: PayMethod = input.method ?? "Efectivo";
    if (method !== "Efectivo" && method !== "Nequi") {
      throw new Error("Elige Efectivo o Nequi.");
    }
    const db = getDb();

    await assertDayEditable();

    return db.transaction(
      "rw",
      [
        db.products,
        db.sales,
        db.saleLines,
        db.stockMoves,
        db.cashMoves,
        db.customers,
        db.customerPayments,
        db.cashSessions,
      ],
      async () => {
        await assertDayEditable();

        if (input.requestId) {
          const existing = await db.sales
            .where("requestId")
            .equals(input.requestId)
            .first();
          if (existing?.id != null) return existing.id;
        }

        let saleTotal = 0;
        const prepared: Array<{
          productId: number;
          productName: string;
          qty: number;
          unitPrice: number;
          unitCost: number;
          lineTotal: number;
        }> = [];

        for (const line of input.lines) {
          if (!Number.isInteger(line.qty) || line.qty <= 0) {
            throw new Error(SALE_ERRORS.badQty);
          }
          const product = await db.products.get(line.productId);
          if (!product) throw new Error(`product ${line.productId} not found`);
          if (product.stock < line.qty) {
            throw new Error("stock insufficient (stock never negative)");
          }
          const unitPrice = resolveLineUnitPrice(product.price, line.unitPrice);
          const unitCost = asCop(product.avgCost);
          if (unitCost < 0) throw new Error("unitCost must be ≥ 0");
          const lineTotal = mulCop(unitPrice, line.qty);
          saleTotal = addCop(saleTotal, lineTotal);
          prepared.push({
            productId: product.id!,
            productName: product.name,
            qty: line.qty,
            unitPrice,
            unitCost,
            lineTotal,
          });
        }

        const { credit } = assertPaymentMath(
          input.paymentKind,
          saleTotal,
          input.amountReceived,
        );
        const amountReceived = asCop(input.amountReceived);

        if (needsCustomer) {
          const customer = await db.customers.get(input.customerId!);
          if (!customer) throw new Error("customer not found");
        }

        const saleId = (await db.sales.add({
          createdAt: Date.now(),
          customerId: input.customerId ?? null,
          paymentKind: input.paymentKind,
          saleTotal,
          amountReceived,
          credit,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        })) as number;

        for (const line of prepared) {
          await db.saleLines.add({
            saleId,
            productId: line.productId,
            productName: line.productName,
            qty: line.qty,
            unitPrice: line.unitPrice,
            unitCost: line.unitCost,
            lineTotal: line.lineTotal,
          });

          const product = await db.products.get(line.productId);
          if (!product) throw new Error("product missing mid-txn");
          const nextStock = product.stock - line.qty;
          if (nextStock < 0) {
            throw new Error("stock insufficient (stock never negative)");
          }
          await db.products.update(line.productId, {
            stock: nextStock,
            updatedAt: Date.now(),
          });
          await db.stockMoves.add({
            productId: line.productId,
            delta: -line.qty,
            reason: "sale",
            unitCost: line.unitCost,
            refType: "sale",
            refId: saleId,
            createdAt: Date.now(),
          });
        }

        if (amountReceived > 0) {
          const open = await db.cashSessions
            .filter((s) => s.closedAt == null)
            .first();
          await db.cashMoves.add({
            amount: amountReceived,
            direction: "in",
            method,
            kind: "sale",
            refType: "sale",
            refId: saleId,
            sessionId: open?.id ?? null,
            createdAt: Date.now(),
          });
        }

        if (credit > 0 && input.customerId != null) {
          const customer = await db.customers.get(input.customerId);
          if (!customer) throw new Error("customer not found");
          const newDebt = addCop(customer.debt, credit);
          await db.customers.update(customer.id!, {
            debt: newDebt,
            updatedAt: Date.now(),
          });
        }

        return saleId;
      },
    );
  }

  async listReturns(saleId: number): Promise<SaleReturn[]> {
    const rows = await getDb().saleReturns.where("saleId").equals(saleId).toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async returnedQtyByLine(saleId: number): Promise<Map<number, number>> {
    const db = getDb();
    const returns = await db.saleReturns.where("saleId").equals(saleId).toArray();
    const qty = new Map<number, number>();
    for (const r of returns) {
      if (r.id == null) continue;
      const lines = await db.saleReturnLines.where("returnId").equals(r.id).toArray();
      for (const l of lines) {
        qty.set(l.saleLineId, (qty.get(l.saleLineId) ?? 0) + l.qty);
      }
    }
    return qty;
  }

  async getReturnable(saleId: number): Promise<{
    sale: Sale;
    lines: Array<SaleLine & { returnedQty: number; remaining: number }>;
    remainingValue: number;
  } | undefined> {
    const sale = await this.getById(saleId);
    if (!sale) return undefined;
    const lines = await this.linesForSale(saleId);
    const returned = await this.returnedQtyByLine(saleId);
    let remainingValue = 0;
    const mapped = lines.map((l) => {
      const returnedQty = returned.get(l.id!) ?? 0;
      const remaining = l.qty - returnedQty;
      remainingValue = addCop(remainingValue, mulCop(l.unitPrice, Math.max(0, remaining)));
      return { ...l, returnedQty, remaining };
    });
    return { sale, lines: mapped, remainingValue };
  }

  /**
   * Return part or all of a sale. Original sale is never edited.
   * Stock comes back (reason=devolucion). Cash refund and/or debt drop
   * use the historical line snapshots. Closed day (today) is rejected.
   * Same requestId → existing return, no second effects.
   */
  async createReturn(input: CreateReturnInput): Promise<number> {
    if (!input.lines.length) throw new Error(RETURN_ERRORS.empty);

    await assertDayEditable();
    const db = getDb();

    return db.transaction(
      "rw",
      [
        db.sales,
        db.saleLines,
        db.saleReturns,
        db.saleReturnLines,
        db.products,
        db.stockMoves,
        db.cashMoves,
        db.customers,
        db.cashSessions,
      ],
      async () => {
        await assertDayEditable();

        if (input.requestId) {
          const existing = await db.saleReturns
            .where("requestId")
            .equals(input.requestId)
            .first();
          if (existing?.id != null) return existing.id;
        }

        const sale = await db.sales.get(input.saleId);
        if (!sale) throw new Error(RETURN_ERRORS.saleNotFound);

        const saleLines = await db.saleLines.where("saleId").equals(input.saleId).toArray();
        const lineById = new Map(saleLines.map((l) => [l.id!, l]));

        const priorReturns = await db.saleReturns
          .where("saleId")
          .equals(input.saleId)
          .toArray();
        const alreadyReturned = new Map<number, number>();
        let alreadyDebtReduced = 0;
        for (const r of priorReturns) {
          alreadyDebtReduced = addCop(alreadyDebtReduced, r.debtReduced);
          if (r.id == null) continue;
          const rLines = await db.saleReturnLines
            .where("returnId")
            .equals(r.id)
            .toArray();
          for (const rl of rLines) {
            alreadyReturned.set(
              rl.saleLineId,
              (alreadyReturned.get(rl.saleLineId) ?? 0) + rl.qty,
            );
          }
        }

        const prepared: Array<{
          saleLineId: number;
          productId: number;
          qty: number;
          unitPrice: number;
          unitCost: number;
        }> = [];
        let returnValue = 0;

        for (const row of input.lines) {
          if (!Number.isInteger(row.qty) || row.qty <= 0) {
            throw new Error(RETURN_ERRORS.badQty);
          }
          const line = lineById.get(row.saleLineId);
          if (!line) throw new Error(RETURN_ERRORS.lineNotFound);
          const used = alreadyReturned.get(row.saleLineId) ?? 0;
          if (used + row.qty > line.qty) {
            throw new Error(RETURN_ERRORS.exceeds);
          }
          prepared.push({
            saleLineId: row.saleLineId,
            productId: line.productId,
            qty: row.qty,
            unitPrice: line.unitPrice,
            unitCost: line.unitCost,
          });
          returnValue = addCop(returnValue, returnLineValue(line.unitPrice, row.qty));
        }

        if (prepared.length === 0 || returnValue < 0) {
          throw new Error(RETURN_ERRORS.empty);
        }

        let customerDebt = 0;
        if (sale.customerId != null) {
          const customer = await db.customers.get(sale.customerId);
          if (!customer) throw new Error("customer not found");
          customerDebt = customer.debt;
        }

        const { debtReduced, refundAmount } = splitReturnSettlement({
          returnValue,
          saleCredit: sale.credit,
          alreadyDebtReduced,
          customerDebt,
        });

        let method: PayMethod | null = null;
        if (refundAmount > 0) {
          const moves = await db.cashMoves.toArray();
          const saleMove = moves.find(
            (m) => m.kind === "sale" && m.refId === sale.id,
          );
          method = saleMove?.method ?? "Efectivo";
        }

        const now = Date.now();
        const returnId = (await db.saleReturns.add({
          saleId: input.saleId,
          createdAt: now,
          refundAmount,
          debtReduced,
          method,
          note: input.note,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        })) as number;

        for (const row of prepared) {
          await db.saleReturnLines.add({
            returnId,
            saleLineId: row.saleLineId,
            productId: row.productId,
            qty: row.qty,
            unitPrice: row.unitPrice,
            unitCost: row.unitCost,
          });

          const product = await db.products.get(row.productId);
          if (!product) throw new Error(`product ${row.productId} not found`);
          await db.products.update(product.id!, {
            stock: product.stock + row.qty,
            updatedAt: now,
          });
          await db.stockMoves.add({
            productId: row.productId,
            delta: row.qty,
            reason: "devolucion",
            unitCost: row.unitCost,
            refType: "saleReturn",
            refId: returnId,
            createdAt: now,
          });
        }

        if (refundAmount > 0 && method) {
          const open = await db.cashSessions
            .filter((s) => s.closedAt == null)
            .first();
          await db.cashMoves.add({
            amount: refundAmount,
            direction: "out",
            method,
            kind: "devolucion",
            refType: "saleReturn",
            refId: returnId,
            sessionId: open?.id ?? null,
            createdAt: now,
          });
        }

        if (debtReduced > 0) {
          if (sale.customerId == null) throw new Error("customer not found");
          const customer = await db.customers.get(sale.customerId);
          if (!customer) throw new Error("customer not found");
          const next = subCop(customer.debt, debtReduced);
          if (next < 0) throw new Error("debt must be ≥ 0");
          await db.customers.update(customer.id!, {
            debt: next,
            updatedAt: now,
          });
        }

        return returnId;
      },
    );
  }
}

export const saleRepository = new SaleRepository();
