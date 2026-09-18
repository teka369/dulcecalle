import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { asCop, copToJson } from "../shared/money";
import { occurredOnDate } from "../shared/clock";
import type { BusinessContext } from "../identity/auth.types";
import type { CreateCustomerDto, CreateProductDto, PatchCustomerDto, PatchProductDto } from "./catalog.dto";

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
  name: string;
  phone: string | null;
  debt: bigint;
  archivedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: c.id,
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

  async createCustomer(ctx: BusinessContext, dto: CreateCustomerDto) {
    const name = dto.name.trim();
    if (!name) throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.emptyName);
    const c = await this.prisma.customer.create({
      data: {
        id: randomUUID(),
        businessId: ctx.businessId,
        name,
        phone: dto.phone,
        debt: 0n,
      },
    });
    return customerJson(c);
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
}
