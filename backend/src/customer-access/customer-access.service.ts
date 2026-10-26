import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { CatalogService } from "../catalog/catalog.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { AuthSessionService } from "../identity/auth-sessions";
import { normalizeCustomerCode } from "../shared/customer-code";
import type { CustomerAuth, PortalLedgerScope } from "../identity/auth.types";
import { DEFAULT_TZ } from "../shared/clock";
import { copToJson } from "../shared/money";
import {
  CUSTOMER_SOFT_CAP,
  IP_CODE_POLICY,
  IP_POLICY,
  isPrivateOrUnknownIp,
  PortalLoginThrottle,
  softCapAlert,
  softDelayMs,
} from "./portal-throttle";

const IDENTIFY_FAIL = "No pudimos identificarte.";
const PIN_RE = /^\d{6}$/;

/** Lowercase, no accents, single spaces. Null when empty. */
function normalizeStore(raw: string | undefined): string | null {
  const v = (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return v ? v : null;
}

/** Store short name (normalized, exact) or store code (first 8 hex of its id). */
function storeMatches(store: string, businessId: string, name: string): boolean {
  if (/^[0-9a-f]{8}$/.test(store) && businessId.toLowerCase().startsWith(store)) return true;
  return normalizeStore(name) === store;
}

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

  private readonly logger = new Logger("CustomerAccess");
  /** Overridable in tests. */
  private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

  /**
   * loop/v1 portal hardening:
   * - Exactly ONE bcrypt compare per attempt, whatever the number of stores.
   *   Without businessId the code must resolve to a single customer; zero or
   *   several candidates do one dummy compare and fail the same way (no O(n)
   *   bcrypt, no timing signal about how many stores use the code).
   * - Guess limits are per client IP + code (and per IP across codes), never
   *   per customer: anonymous attempts from someone else cannot lock the real
   *   customer out of their own phone.
   * - If `req.ip` looks private (trust proxy misconfigured → every client is the
   *   proxy), the per-IP-across-codes bucket is skipped (it would throttle
   *   everyone) and the per-IP+code bucket degrades to per-code — the previous
   *   behaviour, never weaker against guessing.
   */
  async login(codeRaw: string, pinRaw: string, businessIdRaw?: string, clientIp?: string, storeRaw?: string) {
    const code = normalizeCustomerCode(codeRaw);
    const pin = pinRaw.trim();
    const businessId = businessIdRaw?.trim() || undefined;
    if (!code || !PIN_RE.test(pin) || (businessId && !/^[0-9a-f-]{36}$/i.test(businessId))) {
      await bcrypt.compare(pin || "000000", await dummyHash());
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }

    const ip = clientIp?.replace(/^::ffff:/i, "") || "unknown";
    const shared = isPrivateOrUnknownIp(ip);
    const ipCodeKey = `ipcode:${shared ? "shared" : ip}:${businessId ?? "*"}:${code}`;
    const cooled =
      (await this.throttle.take(ipCodeKey, IP_CODE_POLICY)) === "cooled" ||
      (!shared && (await this.throttle.take(`ip:${ip}`, IP_POLICY)) === "cooled");
    if (cooled) {
      await bcrypt.compare(pin, await dummyHash());
      throw new AppError(
        ERROR_CODES.RATE_LIMIT,
        "Demasiados intentos. Espera un momento.",
      );
    }

    const store = businessId ? null : normalizeStore(storeRaw);
    const where = businessId
      ? { code, businessId, archivedAt: null, pinHash: { not: null } }
      : { code, archivedAt: null, pinHash: { not: null } };
    // Without a store hint we only need to know whether the code is
    // unambiguous (2 rows). With one, read a bounded set and pick by store.
    const rows = await this.prisma.customer.findMany({
      where,
      include: { business: { select: { timezone: true, name: true } } },
      orderBy: { id: "asc" },
      take: store ? 50 : 2,
    });
    const pool = store ? rows.filter((r) => storeMatches(store, r.businessId, r.business.name)) : rows;
    const candidate = pool.length === 1 ? pool[0] : null;
    // Soft cap (never a block), counted by the TYPED code before any lookup,
    // so an unknown code gets exactly the same schedule as a real one:
    // - progressive delay ONLY per IP+code and per store+code (when the
    //   store is given via businessId or the store field). A flood on a
    //   shared code (DC-0001) from one IP never slows other IPs.
    //   A private/unknown IP (trust proxy wrong) skips the IP key, as above.
    // - global per code: counted for the alert log only, no delay.
    const storeKey = businessId ?? (store ? `name:${store}` : null);
    const softKeys = [
      ...(shared ? [] : [`softip:${ip}:${code}`]),
      ...(storeKey ? [`softstore:${storeKey}:${code}`] : []),
    ];
    const globalKey = `code:${code}`;
    const priors = await Promise.all(softKeys.map((k) => this.throttle.peek(k, CUSTOMER_SOFT_CAP.windowMs)));
    const wait = Math.max(0, ...priors.map(softDelayMs));
    if (wait > 0) await this.sleep(wait);
    // Exactly one bcrypt compare in every branch (real hash or dummy).
    const ok = await bcrypt.compare(pin, candidate ? (candidate.pinHash as string) : await dummyHash());
    if (!candidate || !ok) {
      await Promise.all([...softKeys, globalKey].map((k) => this.throttle.bump(k, CUSTOMER_SOFT_CAP.windowMs)));
      const total = (await this.throttle.peek(globalKey, CUSTOMER_SOFT_CAP.windowMs));
      if (softCapAlert(total)) {
        this.logger.warn(
          `portal: many failed PINs for one customer code (${total} in the last hour, any IP/store); alert only, per-IP/per-store delays apply. code=${code}${candidate ? ` customer=${candidate.id} business=${candidate.businessId}` : " (no single match)"}`,
        );
      }
    }
    // Same code in 2+ stores without a store hint: no candidate, so the SAME
    // generic 401 as a wrong PIN or unknown code (no enumeration). The client
    // then offers the optional store field.
    if (!candidate || !ok) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }
    const matches = [candidate];
    const customer = matches[0];
    await this.throttle.reset(ipCodeKey);
    await Promise.all(softKeys.map((k) => this.throttle.reset(k)));
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
      where: { businessId: auth.businessId, archivedAt: null, sellable: true, kind: "standard" },
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
    const raw = await this.catalog.portalCustomerLedger(
      portalLedgerScope(auth),
    );
    return publicCustomerLedger(raw);
  }
}

/** J-B1: portal keeps the fixed Bogota zone. */
export function portalLedgerScope(auth: CustomerAuth): PortalLedgerScope {
  return {
    kind: "portal",
    customerId: auth.customerId,
    businessId: auth.businessId,
    timezone: DEFAULT_TZ,
  };
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
