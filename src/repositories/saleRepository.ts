import { getDb } from "@/storage/db";
import type {
  CreateSaleInput,
  PayMethod,
  PaymentKind,
  Sale,
  SaleLine,
} from "@/domain/types";
import { asCop, mulCop, addCop, subCop } from "@/domain/money";

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
   * Snapshots unitPrice/unitCost on each line. Stock never goes negative.
   */
  async createSale(input: CreateSaleInput): Promise<number> {
    if (!input.lines.length) throw new Error("sale needs at least one line");

    const needsCustomer =
      input.paymentKind === "partial" || input.paymentKind === "credit";
    if (needsCustomer && (input.customerId == null || input.customerId <= 0)) {
      throw new Error("Parcial/Fiada require customer");
    }

    const method: PayMethod = input.method ?? "Efectivo";
    const db = getDb();

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
      ],
      async () => {
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
            throw new Error("line qty must be a positive integer");
          }
          const product = await db.products.get(line.productId);
          if (!product) throw new Error(`product ${line.productId} not found`);
          if (product.stock < line.qty) {
            throw new Error("stock insufficient (stock never negative)");
          }
          const unitPrice = asCop(product.price);
          const unitCost = asCop(product.avgCost);
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
          await db.cashMoves.add({
            amount: amountReceived,
            direction: "in",
            method,
            kind: "sale",
            refType: "sale",
            refId: saleId,
            sessionId: null,
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
}

export const saleRepository = new SaleRepository();
