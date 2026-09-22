import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { CatalogService } from "../catalog/catalog.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { requireJwtSecrets } from "../identity/jwt-secrets";
import {
  normalizeCustomerCode,
  normalizePersonName,
} from "../shared/customer-code";
import type { CustomerAuth } from "../identity/auth.types";
import { copToJson } from "../shared/money";

const IDENTIFY_FAIL = "No pudimos identificarte.";

@Injectable()
export class CustomerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly catalog: CatalogService,
  ) {}

  private tokens(customerId: string, businessId: string) {
    const { refresh } = requireJwtSecrets();
    const accessToken = this.jwt.sign(
      { sub: customerId, businessId, typ: "customer" },
      { expiresIn: "15m" },
    );
    const refreshToken = this.jwt.sign(
      { sub: customerId, businessId, typ: "customer_refresh" },
      { secret: refresh, expiresIn: "7d" },
    );
    return { accessToken, refreshToken };
  }

  async login(codeRaw: string, nameRaw: string) {
    const code = normalizeCustomerCode(codeRaw);
    const name = normalizePersonName(nameRaw);
    if (!code || !name) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }

    const rows = await this.prisma.customer.findMany({
      where: { code },
      include: { business: { select: { timezone: true } } },
    });
    const matches = rows.filter(
      (row) =>
        !row.archivedAt && normalizePersonName(row.name) === name,
    );
    if (matches.length !== 1) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }
    const customer = matches[0];
    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        debt: copToJson(customer.debt),
      },
      business: {
        id: customer.businessId,
        timezone: customer.business.timezone,
      },
      ...this.tokens(customer.id, customer.businessId),
    };
  }

  async refresh(refreshToken: string) {
    const token = refreshToken?.trim() ?? "";
    if (!token) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    const { refresh } = requireJwtSecrets();
    try {
      const payload = this.jwt.verify<{
        sub?: string;
        businessId?: string;
        typ?: string;
      }>(token, { secret: refresh });
      if (
        payload.typ !== "customer_refresh" ||
        !payload.sub ||
        !payload.businessId
      ) {
        throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
      }
      const customer = await this.prisma.customer.findFirst({
        where: { id: payload.sub, businessId: payload.businessId },
      });
      if (!customer || customer.archivedAt) {
        throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
      }
      return {
        customer: {
          id: customer.id,
          code: customer.code,
          name: customer.name,
          debt: copToJson(customer.debt),
        },
        ...this.tokens(customer.id, customer.businessId),
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
  }

  async me(auth: CustomerAuth) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: auth.customerId, businessId: auth.businessId },
    });
    if (!customer || customer.archivedAt) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }
    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      debt: copToJson(customer.debt),
      createdAt: customer.createdAt,
    };
  }

  /**
   * Public storefront catalog for the customer portal. Only what a
   * customer may see: no cost, no supplier, no internal ids beyond the
   * product id needed for detail navigation. Business comes from the
   * customer token, never from the client.
   */
  async products(auth: CustomerAuth) {
    const rows = await this.prisma.product.findMany({
      where: { businessId: auth.businessId, archivedAt: null },
      orderBy: { name: "asc" },
      include: { images: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      price: copToJson(p.price),
      available: p.stock > 0,
      images: p.images.map((img) => ({
        id: img.id,
        secureUrl: img.secureUrl,
        position: img.position,
        isPrimary: img.isPrimary,
        altText: img.altText,
      })),
    }));
  }

  async ledger(auth: CustomerAuth) {
    const raw = await this.catalog.customerLedger(
      {
        userId: auth.customerId,
        businessId: auth.businessId,
        role: "staff",
        timezone: "America/Bogota",
      },
      auth.customerId,
    );
    return publicCustomerLedger(raw);
  }
}

type AdminLedger = Awaited<
  ReturnType<CatalogService["customerLedger"]>
>;

export function publicCustomerLedger(raw: AdminLedger) {
  return {
    customer: {
      id: raw.customer.id,
      code: raw.customer.code,
      name: raw.customer.name,
      debt: raw.customer.debt,
      createdAt: raw.customer.createdAt,
    },
    initials: raw.initials.map((d) => ({
      id: d.id,
      amount: d.amount,
      note: d.note,
      occurredOn: d.occurredOn,
      createdAt: d.createdAt,
    })),
    sales: raw.sales.map((s) => ({
      id: s.id,
      paymentKind: s.paymentKind,
      method: s.method,
      saleTotal: s.saleTotal,
      amountReceived: s.amountReceived,
      credit: s.credit,
      note: s.note,
      occurredOn: s.occurredOn,
      createdAt: s.createdAt,
      lines: s.lines.map((l) => ({
        id: l.id,
        productName: l.productName,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
      returns: s.returns.map((r) => ({
        id: r.id,
        refundAmount: r.refundAmount,
        debtReduced: r.debtReduced,
        method: r.method,
        note: r.note,
        occurredOn: r.occurredOn,
        createdAt: r.createdAt,
        lines: r.lines.map((l) => ({
          id: l.id,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      })),
    })),
    payments: raw.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      occurredOn: p.occurredOn,
      createdAt: p.createdAt,
    })),
  };
}

export type PublicCustomerLedger = ReturnType<typeof publicCustomerLedger>;

