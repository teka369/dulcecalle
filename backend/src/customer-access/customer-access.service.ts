import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { CatalogService } from "../catalog/catalog.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { AuthSessionService } from "../identity/auth-sessions";
import { normalizeCustomerCode } from "../shared/customer-code";
import type { CustomerAuth } from "../identity/auth.types";
import { copToJson } from "../shared/money";
import { PortalLoginThrottle } from "./portal-throttle";

const IDENTIFY_FAIL = "No pudimos identificarte.";
const PIN_RE = /^\d{6}$/;

let dummyPinHash: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyPinHash ??= bcrypt.hash("portal-pin-dummy", 12);
  return dummyPinHash;
}

@Injectable()
export class CustomerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly catalog: CatalogService,
    private readonly sessions: AuthSessionService,
    private readonly throttle: PortalLoginThrottle,
  ) {}

  private tokens(customerId: string, businessId: string) {
    return this.sessions.issue({
      kind: "customer",
      subjectId: customerId,
      businessId,
      refreshClaims: { sub: customerId, businessId, typ: "customer_refresh" },
      accessClaims: { sub: customerId, businessId, typ: "customer" },
      accessExpiresIn: "15m",
    });
  }

  async login(codeRaw: string, pinRaw: string, businessIdRaw?: string) {
    const code = normalizeCustomerCode(codeRaw);
    const pin = pinRaw.trim();
    const businessId = businessIdRaw?.trim() || undefined;
    if (!code || !PIN_RE.test(pin) || (businessId && !/^[0-9a-f-]{36}$/i.test(businessId))) {
      await bcrypt.compare(pin || "000000", await dummyHash());
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }

    const where = businessId
      ? { code, businessId, archivedAt: null, pinHash: { not: null } }
      : { code, archivedAt: null, pinHash: { not: null } };
    const rows = await this.prisma.customer.findMany({
      where,
      include: { business: { select: { timezone: true } } },
    });
    const gateKey = rows.length === 1 ? `customer:${rows[0].id}` : `code:${code}:${businessId ?? "*"}`;
    if ((await this.throttle.take(gateKey)) === "cooled") {
      await bcrypt.compare(pin, await dummyHash());
      throw new AppError(
        ERROR_CODES.RATE_LIMIT,
        "Demasiados intentos. Espera un momento.",
      );
    }

    const dummy = await dummyHash();
    const hashes = rows.length > 0 ? rows.map((row) => row.pinHash as string) : [dummy];
    const matches: typeof rows = [];
    for (let i = 0; i < hashes.length; i += 1) {
      const ok = await bcrypt.compare(pin, hashes[i]);
      if (ok && rows[i]) matches.push(rows[i]);
    }
    if (matches.length !== 1) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }
    const customer = matches[0];
    await this.throttle.reset(`customer:${customer.id}`);
    const issued = await this.tokens(customer.id, customer.businessId);
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
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    const { session, payload } = await this.sessions.verify(
      refreshToken,
      "customer_refresh",
    );
    if (!payload.businessId) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: payload.sub, businessId: payload.businessId },
    });
    if (
      !customer ||
      customer.archivedAt ||
      customer.id !== session.subjectId ||
      customer.businessId !== session.businessId
    ) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }
    const accessToken = this.jwt.sign(
      { sub: customer.id, businessId: customer.businessId, typ: "customer" },
      { expiresIn: "15m" },
    );
    await this.sessions.touch(session.id);
    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        debt: copToJson(customer.debt),
      },
      accessToken,
      refreshToken: refreshToken.trim(),
    };
  }

  async logout(auth: CustomerAuth, refreshToken?: string) {
    if (!refreshToken?.trim()) return { ok: true as const };
    const result = await this.sessions.revokeOwned(
      refreshToken,
      { kind: "customer", subjectId: auth.customerId },
      "customer_refresh",
    );
    if (result === "foreign") {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    return { ok: true as const };
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
      where: { businessId: auth.businessId, archivedAt: null, sellable: true },
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
        productId: l.productId,
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
