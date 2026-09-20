import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import type {
  CreateCustomerDto,
  CreateInitialDebtDto,
  CreateProductDto,
  CreateSupplierDto,
  PatchCustomerDto,
  PatchProductDto,
  PatchSupplierDto,
  ShrinkDto,
  SurtirDto,
} from "./catalog.dto";
import { reconcileSurtirCost, weightedAvgCost } from "../shared/inventory";
import { asCop, copToJson, mulCop } from "../shared/money";
import { occurredOnDate, dateKey } from "../shared/clock";
import { assertDayEditable, lockAndAssertDayEditable } from "../shared/day-guard";
import type { BusinessContext } from "../identity/auth.types";
import { nextCodeFromExisting } from "../shared/customer-code";

function productJson(p: {
  id: string;
  name: string;
  category: string;
  price: bigint;
  avgCost: bigint;
  stock: number;
  lowStockAt: number;
  archivedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: copToJson(p.price),
    avgCost: copToJson(p.avgCost),
    stock: p.stock,
    lowStockAt: p.lowStockAt,
    archivedAt: p.archivedAt,
    createdAt: p.createdAt,
  };
}

function customerJson(c: {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  debt: bigint;
  archivedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    phone: c.phone,
    debt: copToJson(c.debt),
    archivedAt: c.archivedAt,
    createdAt: c.createdAt,
  };
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(
    ctx: BusinessContext,
    dto: CreateProductDto,
    requestId: string,
  ) {
    const existing = await this.prisma.product.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return productJson(existing);

    const name = dto.name.trim();
    if (!name) throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.emptyName);
    const stock = dto.stock ?? 0;
    const gifted = Boolean(dto.gifted);
    const avgCost = gifted ? 0n : asCop(dto.avgCost ?? 0);
    if (stock > 0 && avgCost <= 0n && !gifted) {
      throw new AppError(ERROR_CODES.NEED_COST, MESSAGES.needCost);
    }
    const price = asCop(dto.price);
    const id = randomUUID();
    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            id,
            businessId: ctx.businessId,
            name,
            category: "General",
            price,
            avgCost,
            stock,
            lowStockAt: dto.lowStockAt ?? 5,
            requestId,
          },
        });
        if (stock > 0) {
          await tx.stockMove.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              productId: id,
              delta: stock,
              reason: "inicial",
              unitCost: avgCost,
              refType: "product",
              refId: id,
              note: gifted ? MESSAGES.giftedNote : null,
              requestId,
              occurredOn,
              createdAt: now,
            },
          });
        }
        return product;
      });
      return productJson(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.product.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) return productJson(again);
      }
      throw e;
    }
  }

  async listProducts(ctx: BusinessContext) {
    const rows = await this.prisma.product.findMany({
      where: { businessId: ctx.businessId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(productJson);
  }

  async getProduct(ctx: BusinessContext, id: string) {
    const p = await this.prisma.product.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!p) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    return productJson(p);
  }

  async listProductMoves(ctx: BusinessContext, productId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, businessId: ctx.businessId },
    });
    if (!p) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const rows = await this.prisma.stockMove.findMany({
      where: { businessId: ctx.businessId, productId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((m) => this.stockMoveJson(m));
  }

  async patchProduct(ctx: BusinessContext, id: string, dto: PatchProductDto) {
    const p = await this.prisma.product.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!p) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    if (dto.stock !== undefined || dto.avgCost !== undefined) {
      throw new AppError(ERROR_CODES.STOCK_VIA_MOVES, MESSAGES.stockViaMoves);
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.price != null ? { price: asCop(dto.price) } : {}),
        ...(dto.lowStockAt != null ? { lowStockAt: dto.lowStockAt } : {}),
      },
    });
    return productJson(updated);
  }

  async archiveProduct(ctx: BusinessContext, id: string) {
    const p = await this.prisma.product.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!p) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return productJson(updated);
  }

  async createCustomer(
    ctx: BusinessContext,
    dto: CreateCustomerDto,
    requestId: string,
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return customerJson(existing);

    const name = dto.name.trim();
    if (!name) throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.emptyName);

    try {
      const c = await this.prisma.$transaction(async (tx) => {
        const existingCodes = await tx.customer.findMany({
          where: { businessId: ctx.businessId },
          select: { code: true },
        });
        const code = nextCodeFromExisting(existingCodes.map((row) => row.code));
        return tx.customer.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            code,
            name,
            phone: dto.phone,
            debt: 0n,
            requestId,
          },
        });
      });
      return customerJson(c);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.customer.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) return customerJson(again);
      }
      throw e;
    }
  }

  async listCustomers(ctx: BusinessContext) {
    const rows = await this.prisma.customer.findMany({
      where: { businessId: ctx.businessId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(customerJson);
  }

  async getCustomer(ctx: BusinessContext, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!c) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    return customerJson(c);
  }

  async customerLedger(ctx: BusinessContext, customerId: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId: ctx.businessId },
    });
    if (!c) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);

    const [initials, sales, payments] = await Promise.all([
      this.prisma.initialDebt.findMany({
        where: { businessId: ctx.businessId, customerId },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.sale.findMany({
        where: { businessId: ctx.businessId, customerId },
        include: { lines: true, returns: { include: { lines: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.customerPayment.findMany({
        where: { businessId: ctx.businessId, customerId },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return {
      customer: customerJson(c),
      initials: initials.map((d) => ({
        id: d.id,
        customerId: d.customerId,
        amount: copToJson(d.amount),
        note: d.note,
        occurredOn: dateKey(d.occurredOn),
        createdAt: d.createdAt,
      })),
      sales: sales.map((s) => ({
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
        lines: s.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          productName: l.productName,
          qty: l.qty,
          unitPrice: copToJson(l.unitPrice),
          unitCost: copToJson(l.unitCost),
          lineTotal: copToJson(l.lineTotal),
        })),
        returns: s.returns.map((r) => ({
          id: r.id,
          saleId: r.saleId,
          refundAmount: copToJson(r.refundAmount),
          debtReduced: copToJson(r.debtReduced),
          method: r.method,
          note: r.note,
          occurredOn: dateKey(r.occurredOn),
          createdAt: r.createdAt,
          lines: r.lines.map((l) => ({
            id: l.id,
            saleLineId: l.saleLineId,
            productId: l.productId,
            qty: l.qty,
            unitPrice: copToJson(l.unitPrice),
            unitCost: copToJson(l.unitCost),
          })),
        })),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        customerId: p.customerId,
        amount: copToJson(p.amount),
        method: p.method,
        occurredOn: dateKey(p.occurredOn),
        createdAt: p.createdAt,
      })),
    };
  }

  async patchCustomer(ctx: BusinessContext, id: string, dto: PatchCustomerDto) {
    const c = await this.prisma.customer.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!c) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    if (dto.debt !== undefined) {
      throw new AppError(ERROR_CODES.VALIDATION, "La deuda no se edita a mano.");
    }
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      },
    });
    return customerJson(updated);
  }

  async recordInitialDebt(
    ctx: BusinessContext,
    customerId: string,
    dto: CreateInitialDebtDto,
    requestId: string,
  ) {
    const existing = await this.prisma.initialDebt.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) {
      return {
        id: existing.id,
        customerId: existing.customerId,
        amount: copToJson(existing.amount),
        note: existing.note,
        occurredOn: dateKey(existing.occurredOn),
        createdAt: existing.createdAt,
      };
    }

    const amount = asCop(dto.amount);
    if (amount <= 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "La deuda tiene que ser mayor a 0.");
    }
    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, businessId: ctx.businessId },
        });
        if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
        const id = randomUUID();
        const created = await tx.initialDebt.create({
          data: {
            id,
            businessId: ctx.businessId,
            customerId,
            amount,
            note: dto.note,
            requestId,
            occurredOn,
            createdAt: now,
          },
        });
        await tx.customer.update({
          where: { id: customerId },
          data: { debt: { increment: amount } },
        });
        return created;
      });
      return {
        id: row.id,
        customerId: row.customerId,
        amount: copToJson(row.amount),
        note: row.note,
        occurredOn: dateKey(row.occurredOn),
        createdAt: row.createdAt,
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.initialDebt.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) {
          return {
            id: again.id,
            customerId: again.customerId,
            amount: copToJson(again.amount),
            note: again.note,
            occurredOn: dateKey(again.occurredOn),
            createdAt: again.createdAt,
          };
        }
      }
      throw e;
    }
  }

  async surtir(
    ctx: BusinessContext,
    productId: string,
    dto: SurtirDto,
    requestId: string,
  ) {
    const existing = await this.prisma.stockMove.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return this.stockMoveJson(existing);

    if (!Number.isInteger(dto.qty) || dto.qty <= 0) {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.badQty);
    }
    if (dto.method !== "Efectivo" && dto.method !== "Nequi") {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.noMethod);
    }
    const rawUnit = asCop(dto.unitCost);
    const rawTotal = asCop(dto.totalCost);
    if (rawUnit < 0n || rawTotal < 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "Revisa el costo.");
    }
    const { unitCost, totalCost } = reconcileSurtirCost(dto.qty, rawUnit, rawTotal);

    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    try {
      const move = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);
        if (dto.supplierId) {
          const supplier = await tx.supplier.findFirst({
            where: { id: dto.supplierId, businessId: ctx.businessId },
          });
          if (!supplier) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
        }
        const product = await tx.product.findFirst({
          where: { id: productId, businessId: ctx.businessId, archivedAt: null },
        });
        if (!product) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);

        const nextAvg = weightedAvgCost(
          product.stock,
          product.avgCost,
          dto.qty,
          unitCost,
        );
        const nextStock = product.stock + dto.qty;
        await tx.product.update({
          where: { id: productId },
          data: { stock: nextStock, avgCost: nextAvg },
        });

        const id = randomUUID();
        const created = await tx.stockMove.create({
          data: {
            id,
            businessId: ctx.businessId,
            productId,
            delta: dto.qty,
            reason: "surtir",
            unitCost,
            supplierId: dto.supplierId ?? null,
            refType: "purchase",
            note: dto.note,
            requestId,
            occurredOn,
            createdAt: now,
          },
        });

        if (totalCost > 0n) {
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
              amount: totalCost,
              direction: "out",
              method: dto.method,
              kind: "compra",
              sessionId: open?.id ?? null,
              refType: "stockMove",
              refId: id,
              note: dto.note,
              occurredOn,
              createdAt: now,
            },
          });
        }
        return created;
      });
      return this.stockMoveJson(move);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.stockMove.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) return this.stockMoveJson(again);
      }
      throw e;
    }
  }

  async shrink(
    ctx: BusinessContext,
    productId: string,
    dto: ShrinkDto,
    requestId: string,
  ) {
    const existing = await this.prisma.stockMove.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return this.stockMoveJson(existing);

    if (!Number.isInteger(dto.qty) || dto.qty <= 0) {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.badQty);
    }

    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    try {
      const move = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);
        const product = await tx.product.findFirst({
          where: { id: productId, businessId: ctx.businessId, archivedAt: null },
        });
        if (!product) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);

        const decremented = await tx.$executeRaw`
          UPDATE products
          SET stock = stock - ${dto.qty},
              updated_at = NOW()
          WHERE id = ${productId}::uuid
            AND business_id = ${ctx.businessId}::uuid
            AND stock >= ${dto.qty}
            AND archived_at IS NULL
        `;
        if (Number(decremented) !== 1) {
          throw new AppError(
            ERROR_CODES.INSUFFICIENT_STOCK,
            MESSAGES.insufficientStock,
          );
        }

        return tx.stockMove.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            productId,
            delta: -dto.qty,
            reason: dto.reason,
            unitCost: product.avgCost,
            refType: "shrink",
            note: dto.note,
            requestId,
            occurredOn,
            createdAt: now,
          },
        });
      });
      return this.stockMoveJson(move);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.stockMove.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) return this.stockMoveJson(again);
      }
      throw e;
    }
  }

  private stockMoveJson(m: {
    id: string;
    productId: string;
    delta: number;
    reason: string;
    unitCost: bigint;
    supplierId: string | null;
    note: string | null;
    occurredOn: Date;
    createdAt: Date;
  }) {
    return {
      id: m.id,
      productId: m.productId,
      delta: m.delta,
      reason: m.reason,
      unitCost: copToJson(m.unitCost),
      supplierId: m.supplierId,
      note: m.note,
      occurredOn: dateKey(m.occurredOn),
      createdAt: m.createdAt,
    };
  }

  async listSuppliers(ctx: BusinessContext) {
    const rows = await this.prisma.supplier.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => this.supplierJson(row));
  }

  async getSupplier(ctx: BusinessContext, id: string) {
    const s = await this.prisma.supplier.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!s) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    return this.supplierJson(s);
  }

  async listSupplierSurtidas(ctx: BusinessContext, supplierId: string) {
    const s = await this.prisma.supplier.findFirst({
      where: { id: supplierId, businessId: ctx.businessId },
    });
    if (!s) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const moves = await this.prisma.stockMove.findMany({
      where: {
        businessId: ctx.businessId,
        supplierId,
        reason: "surtir",
      },
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const compras = await this.prisma.cashMove.findMany({
      where: {
        businessId: ctx.businessId,
        kind: "compra",
        refId: { in: moves.map((m) => m.id) },
      },
    });
    const compraByRef = new Map(compras.map((row) => [row.refId, row]));
    return moves.map((m) => {
      const cash = compraByRef.get(m.id);
      return {
        moveId: m.id,
        createdAt: m.createdAt,
        productId: m.productId,
        productName: m.product.name,
        qty: m.delta,
        unitCost: copToJson(m.unitCost),
        totalCost: cash
          ? copToJson(cash.amount)
          : copToJson(mulCop(m.unitCost, m.delta)),
        method: cash?.method ?? null,
      };
    });
  }

  async createSupplier(
    ctx: BusinessContext,
    dto: CreateSupplierDto,
    requestId: string,
  ) {
    const existing = await this.prisma.supplier.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return this.supplierJson(existing);

    const name = dto.name.trim();
    if (!name) throw new AppError(ERROR_CODES.VALIDATION, "Ponle un nombre al proveedor.");

    try {
      const s = await this.prisma.supplier.create({
        data: {
          id: randomUUID(),
          businessId: ctx.businessId,
          name,
          phone: dto.phone?.trim() || null,
          notes: dto.notes?.trim() || null,
          requestId,
        },
      });
      return this.supplierJson(s);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.supplier.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) return this.supplierJson(again);
      }
      throw e;
    }
  }

  async patchSupplier(ctx: BusinessContext, id: string, dto: PatchSupplierDto) {
    const s = await this.prisma.supplier.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!s) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    if (dto.name !== undefined && !dto.name.trim()) {
      throw new AppError(ERROR_CODES.VALIDATION, "Ponle un nombre al proveedor.");
    }
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    return this.supplierJson(updated);
  }

  private supplierJson(s: {
    id: string;
    name: string;
    phone: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      notes: s.notes,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
