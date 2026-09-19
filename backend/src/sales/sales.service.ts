import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { addCop, asCop, copToJson, mulCop } from "../shared/money";
import { occurredOnDate, dateKey } from "../shared/clock";
import { assertDayEditable, lockAndAssertDayEditable } from "../shared/day-guard";
import { assertPaymentMath, resolveUnitPrice } from "../shared/sale-math";
import { splitReturnSettlement } from "../shared/returns";
import type { BusinessContext } from "../identity/auth.types";
import type { CreateReturnDto, CreateSaleDto } from "./sales.dto";

function saleJson(s: {
  id: string;
  customerId: string | null;
  paymentKind: string;
  method: string | null;
  saleTotal: bigint;
  amountReceived: bigint;
  credit: bigint;
  note: string | null;
  occurredOn: Date;
  createdAt: Date;
  lines?: Array<{
    id: string;
    productId: string;
    productName: string;
    qty: number;
    unitPrice: bigint;
    unitCost: bigint;
    lineTotal: bigint;
  }>;
}) {
  return {
    id: s.id,
    customerId: s.customerId,
    paymentKind: s.paymentKind,
    method: s.method,
    saleTotal: copToJson(s.saleTotal),
    amountReceived: copToJson(s.amountReceived),
    credit: copToJson(s.credit),
    note: s.note,
    occurredOn: dateKey(s.occurredOn),
    createdAt: s.createdAt,
    lines: s.lines?.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      qty: l.qty,
      unitPrice: copToJson(l.unitPrice),
      unitCost: copToJson(l.unitCost),
      lineTotal: copToJson(l.lineTotal),
    })),
  };
}

function returnJson(r: {
  id: string;
  saleId: string;
  refundAmount: bigint;
  debtReduced: bigint;
  method: string | null;
  note: string | null;
  occurredOn: Date;
  createdAt: Date;
  lines?: Array<{
    id: string;
    saleLineId: string;
    productId: string;
    qty: number;
    unitPrice: bigint;
    unitCost: bigint;
  }>;
}) {
  return {
    id: r.id,
    saleId: r.saleId,
    refundAmount: copToJson(r.refundAmount),
    debtReduced: copToJson(r.debtReduced),
    method: r.method,
    note: r.note,
    occurredOn: dateKey(r.occurredOn),
    createdAt: r.createdAt,
    lines: r.lines?.map((l) => ({
      id: l.id,
      saleLineId: l.saleLineId,
      productId: l.productId,
      qty: l.qty,
      unitPrice: copToJson(l.unitPrice),
      unitCost: copToJson(l.unitCost),
    })),
  };
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ctx: BusinessContext, dto: CreateSaleDto, requestId: string) {
    const existing = await this.prisma.sale.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
      include: { lines: true },
    });
    if (existing) return saleJson(existing);

    if (!dto.lines?.length) {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.emptySale);
    }

    const needsCustomer =
      dto.paymentKind === "partial" || dto.paymentKind === "credit";
    if (needsCustomer && !dto.customerId) {
      throw new AppError(ERROR_CODES.VALIDATION, "Parcial/Fiada require customer");
    }

    const amountReceived = asCop(dto.amountReceived);
    if (amountReceived > 0n) {
      if (dto.method !== "Efectivo" && dto.method !== "Nequi") {
        throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.noMethod);
      }
    }
    const method = amountReceived > 0n ? dto.method! : null;

    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    const productIds = [...new Set(dto.lines.map((l) => l.productId))].sort();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);

        if (dto.customerId) {
          const customer = await tx.customer.findFirst({
            where: { id: dto.customerId, businessId: ctx.businessId },
          });
          if (!customer) {
            throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
          }
        }

        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            businessId: ctx.businessId,
            archivedAt: null,
          },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        let saleTotal = 0n;
        const prepared: Array<{
          productId: string;
          productName: string;
          qty: number;
          unitPrice: bigint;
          unitCost: bigint;
          lineTotal: bigint;
        }> = [];

        for (const line of dto.lines) {
          if (!Number.isInteger(line.qty) || line.qty <= 0) {
            throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.badQty);
          }
          const product = byId.get(line.productId);
          if (!product) {
            throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
          }
          const unitPrice = resolveUnitPrice(product.price, line.unitPrice);
          const unitCost = asCop(product.avgCost);
          const lineTotal = mulCop(unitPrice, line.qty);
          saleTotal = addCop(saleTotal, lineTotal);
          prepared.push({
            productId: product.id,
            productName: product.name,
            qty: line.qty,
            unitPrice,
            unitCost,
            lineTotal,
          });
        }

        const { credit } = assertPaymentMath(
          dto.paymentKind,
          saleTotal,
          amountReceived,
        );

        const saleId = randomUUID();
        await tx.sale.create({
          data: {
            id: saleId,
            businessId: ctx.businessId,
            customerId: dto.customerId ?? null,
            paymentKind: dto.paymentKind,
            method,
            saleTotal,
            amountReceived,
            credit,
            requestId,
            note: dto.note,
            occurredOn,
            createdAt: now,
          },
        });

        for (const line of prepared) {
          await tx.saleLine.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              saleId,
              productId: line.productId,
              productName: line.productName,
              qty: line.qty,
              unitPrice: line.unitPrice,
              unitCost: line.unitCost,
              lineTotal: line.lineTotal,
            },
          });

          const decremented = await tx.$executeRaw`
            UPDATE products
            SET stock = stock - ${line.qty},
                updated_at = NOW()
            WHERE id = ${line.productId}::uuid
              AND business_id = ${ctx.businessId}::uuid
              AND stock >= ${line.qty}
              AND archived_at IS NULL
          `;
          if (Number(decremented) !== 1) {
            throw new AppError(
              ERROR_CODES.INSUFFICIENT_STOCK,
              MESSAGES.insufficientStock,
            );
          }

          await tx.stockMove.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              productId: line.productId,
              delta: -line.qty,
              reason: "sale",
              unitCost: line.unitCost,
              refType: "sale",
              refId: saleId,
              occurredOn,
              createdAt: now,
            },
          });
        }

        if (amountReceived > 0n && method) {
          const open = await tx.cashSession.findFirst({
            where: {
              businessId: ctx.businessId,
              localDate: occurredOn,
              closedAt: null,
            },
          });
          await tx.cashMove.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              amount: amountReceived,
              direction: "in",
              method,
              kind: "sale",
              sessionId: open?.id ?? null,
              refType: "sale",
              refId: saleId,
              occurredOn,
              createdAt: now,
            },
          });
        }

        if (credit > 0n && dto.customerId) {
          await tx.customer.update({
            where: { id: dto.customerId },
            data: { debt: { increment: credit } },
          });
        }

        return tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: { lines: true },
        });
      });

      return saleJson(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.sale.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
          include: { lines: true },
        });
        if (again) return saleJson(again);
      }
      throw e;
    }
  }

  async list(ctx: BusinessContext, from?: string, to?: string) {
    const where: Prisma.SaleWhereInput = { businessId: ctx.businessId };
    if (from || to) {
      where.occurredOn = {};
      if (from) where.occurredOn.gte = new Date(`${from}T00:00:00.000Z`);
      if (to) where.occurredOn.lte = new Date(`${to}T00:00:00.000Z`);
    }
    const rows = await this.prisma.sale.findMany({
      where,
      include: { lines: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(saleJson);
  }

  async get(ctx: BusinessContext, id: string) {
    const s = await this.prisma.sale.findFirst({
      where: { id, businessId: ctx.businessId },
      include: { lines: true },
    });
    if (!s) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    return saleJson(s);
  }

  async listReturns(ctx: BusinessContext, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, businessId: ctx.businessId },
    });
    if (!sale) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const rows = await this.prisma.saleReturn.findMany({
      where: { businessId: ctx.businessId, saleId },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(returnJson);
  }

  async createReturn(
    ctx: BusinessContext,
    saleId: string,
    dto: CreateReturnDto,
    requestId: string,
  ) {
    const existing = await this.prisma.saleReturn.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
      include: { lines: true },
    });
    if (existing) return returnJson(existing);

    if (!dto.lines?.length) {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.returnEmpty);
    }

    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);

        const sale = await tx.sale.findFirst({
          where: { id: saleId, businessId: ctx.businessId },
          include: { lines: true },
        });
        if (!sale) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);

        const lineById = new Map(sale.lines.map((l) => [l.id, l]));
        const prior = await tx.saleReturn.findMany({
          where: { businessId: ctx.businessId, saleId },
          include: { lines: true },
        });
        const alreadyReturned = new Map<string, number>();
        let alreadyDebtReduced = 0n;
        for (const r of prior) {
          alreadyDebtReduced = addCop(alreadyDebtReduced, r.debtReduced);
          for (const rl of r.lines) {
            alreadyReturned.set(
              rl.saleLineId,
              (alreadyReturned.get(rl.saleLineId) ?? 0) + rl.qty,
            );
          }
        }

        const prepared: Array<{
          saleLineId: string;
          productId: string;
          qty: number;
          unitPrice: bigint;
          unitCost: bigint;
        }> = [];
        let returnValue = 0n;

        for (const row of dto.lines) {
          if (!Number.isInteger(row.qty) || row.qty <= 0) {
            throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.badQty);
          }
          const line = lineById.get(row.saleLineId);
          if (!line) {
            throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.returnLineNotFound);
          }
          const used = alreadyReturned.get(row.saleLineId) ?? 0;
          if (used + row.qty > line.qty) {
            throw new AppError(ERROR_CODES.RETURN_EXCEEDS, MESSAGES.returnExceeds);
          }
          alreadyReturned.set(row.saleLineId, used + row.qty);
          prepared.push({
            saleLineId: line.id,
            productId: line.productId,
            qty: row.qty,
            unitPrice: line.unitPrice,
            unitCost: line.unitCost,
          });
          returnValue = addCop(returnValue, mulCop(line.unitPrice, row.qty));
        }

        if (prepared.length === 0) {
          throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.returnEmpty);
        }

        let customerDebt = 0n;
        if (sale.customerId) {
          const customer = await tx.customer.findFirst({
            where: { id: sale.customerId, businessId: ctx.businessId },
          });
          if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
          customerDebt = customer.debt;
        }

        const { debtReduced, refundAmount } = splitReturnSettlement({
          returnValue,
          saleCredit: sale.credit,
          alreadyDebtReduced,
          customerDebt,
        });

        let method: "Efectivo" | "Nequi" | null = null;
        if (refundAmount > 0n) {
          method =
            sale.method === "Nequi" || sale.method === "Efectivo"
              ? sale.method
              : "Efectivo";
        }

        const returnId = randomUUID();
        await tx.saleReturn.create({
          data: {
            id: returnId,
            businessId: ctx.businessId,
            saleId,
            refundAmount,
            debtReduced,
            method,
            requestId,
            note: dto.note,
            occurredOn,
            createdAt: now,
          },
        });

        for (const row of prepared) {
          await tx.saleReturnLine.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              returnId,
              saleLineId: row.saleLineId,
              productId: row.productId,
              qty: row.qty,
              unitPrice: row.unitPrice,
              unitCost: row.unitCost,
            },
          });

          await tx.$executeRaw`
            UPDATE products
            SET stock = stock + ${row.qty},
                updated_at = NOW()
            WHERE id = ${row.productId}::uuid
              AND business_id = ${ctx.businessId}::uuid
          `;

          await tx.stockMove.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              productId: row.productId,
              delta: row.qty,
              reason: "devolucion",
              unitCost: row.unitCost,
              refType: "saleReturn",
              refId: returnId,
              occurredOn,
              createdAt: now,
            },
          });
        }

        if (refundAmount > 0n && method) {
          const open = await tx.cashSession.findFirst({
            where: {
              businessId: ctx.businessId,
              localDate: occurredOn,
              closedAt: null,
            },
          });
          await tx.cashMove.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              amount: refundAmount,
              direction: "out",
              method,
              kind: "devolucion",
              sessionId: open?.id ?? null,
              refType: "saleReturn",
              refId: returnId,
              occurredOn,
              createdAt: now,
            },
          });
        }

        if (debtReduced > 0n) {
          if (!sale.customerId) {
            throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
          }
          const decremented = await tx.$executeRaw`
            UPDATE customers
            SET debt = debt - ${debtReduced},
                updated_at = NOW()
            WHERE id = ${sale.customerId}::uuid
              AND business_id = ${ctx.businessId}::uuid
              AND debt >= ${debtReduced}
          `;
          if (Number(decremented) !== 1) {
            throw new AppError(ERROR_CODES.VALIDATION, "debt must be ≥ 0");
          }
        }

        return tx.saleReturn.findUniqueOrThrow({
          where: { id: returnId },
          include: { lines: true },
        });
      });

      return returnJson(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.saleReturn.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
          include: { lines: true },
        });
        if (again) return returnJson(again);
      }
      throw e;
    }
  }
}
