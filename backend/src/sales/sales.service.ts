import { assertSamePayload, IDEMPOTENCY_MISMATCH_MESSAGE, payloadHash } from "../shared/payload-hash";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { addCop, asCop, copToJson, mulCop } from "../shared/money";
import { occurredOnDate, dateKey } from "../shared/clock";
import { parseOccurredAt } from "../shared/occurred-at";
import { linkForNewMove } from "../cash/session-link";
import { assertDayEditable, lockAndAssertDayEditable } from "../shared/day-guard";
import { assertPaymentMath, resolveUnitPrice } from "../shared/sale-math";
import { splitReturnSettlement } from "../shared/returns";
import {
  applyCreditToObligations,
  insertAllocations,
  loadObligations,
  moveCustomerBalances,
  planOrThrow,
} from "../shared/debt-allocations";
import type { BusinessContext } from "../identity/auth.types";
import { afterCursor, NEWEST_FIRST, paged, pageProbe, type PageQuery } from "../shared/http/paging";
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
  occurredAt?: Date | null;
  syncedAt?: Date | null;
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
    occurredAt: s.occurredAt ?? s.createdAt,
    syncedAt: s.syncedAt ?? s.createdAt,
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

function saleStoredPayloadMatches(
  stored: {
    paymentKind: string;
    customerId: string | null;
    amountReceived: bigint;
    method: string | null;
    note: string | null;
    lines?: Array<{ productId: string; qty: number; unitPrice: bigint }>;
  },
  dto: CreateSaleDto,
): boolean {
  // Cannot verify a legacy row without its lines — never replay as 201.
  if (!stored.lines) return false;
  const incoming = dto.lines ?? [];
  if (incoming.length !== stored.lines.length) return false;
  const unused = stored.lines.slice();
  for (const line of incoming) {
    const idx = unused.findIndex((s) => {
      if (s.productId !== line.productId || s.qty !== line.qty) return false;
      // create() hashes `unitPrice ?? null`; omitted price means the catalog
      // value that was stored on the line.
      if (line.unitPrice == null) return true;
      return s.unitPrice === asCop(line.unitPrice);
    });
    if (idx < 0) return false;
    unused.splice(idx, 1);
  }
  return (
    unused.length === 0 &&
    stored.paymentKind === dto.paymentKind &&
    (stored.customerId ?? null) === (dto.customerId ?? null) &&
    stored.amountReceived === asCop(dto.amountReceived) &&
    (stored.method ?? null) === (dto.method ?? null) &&
    (stored.note ?? null) === (dto.note ?? null)
  );
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ctx: BusinessContext, dto: CreateSaleDto, requestId: string) {
    // C02 / DC-13 — the key is bound to the sale payload (lines in order).
    const hash = payloadHash({
      lines: (dto.lines ?? []).map((l) => [l.productId, l.qty, l.unitPrice ?? null]),
      paymentKind: dto.paymentKind,
      customerId: dto.customerId ?? null,
      amountReceived: String(dto.amountReceived),
      method: dto.method ?? null,
      note: dto.note ?? null,
      // C04 R5 — only when confirmed, so older rows/clients keep their hash.
      ...(dto.applyCredit === true ? { applyCredit: true } : {}),
    });
    const existing = await this.prisma.sale.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
      include: { lines: true },
    });
    const replaySale = async (row: NonNullable<typeof existing>) => {
      if (row.payloadHash != null) {
        assertSamePayload(row.payloadHash, hash);
      } else {
        if (!saleStoredPayloadMatches(row, dto)) {
          throw new AppError(
            ERROR_CODES.IDEMPOTENCY_MISMATCH,
            IDEMPOTENCY_MISMATCH_MESSAGE,
          );
        }
        await this.prisma.sale.update({
          where: { id: row.id },
          data: { payloadHash: hash },
        });
      }
      return this.saleCreditJson(ctx.businessId, row);
    };

    if (existing) {
      return replaySale(existing);
    }

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
    const occurredAt = parseOccurredAt(dto.occurredAt, now);
    const syncedAt = now;
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    const productIds = [...new Set(dto.lines.map((l) => l.productId))].sort();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);

        let creditBalance = 0n;
        if (dto.customerId) {
          const customer = await tx.customer.findFirst({
            where: { id: dto.customerId, businessId: ctx.businessId },
          });
          if (!customer) {
            throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
          }
          creditBalance = customer.creditBalance;
        }
        // C04 R5 — saldo a favor only with the explicit flag and a customer.
        const useCredit = dto.applyCredit === true && !!dto.customerId && creditBalance > 0n;

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
          id?: string;
          productId: string;
          productName: string;
          qty: number;
          unitPrice: bigint;
          unitCost: bigint;
          lineTotal: bigint;
        }> = [];
        const seenLineIds = new Set<string>();

        for (const line of dto.lines) {
          if (!Number.isInteger(line.qty) || line.qty <= 0) {
            throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.badQty);
          }
          if (line.id) {
            if (seenLineIds.has(line.id)) {
              throw new AppError(ERROR_CODES.VALIDATION, "Hay dos líneas con el mismo id.");
            }
            seenLineIds.add(line.id);
          }
          const product = byId.get(line.productId);
          if (!product) {
            throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
          }
          if (product.sellable === false || product.kind === "combo") {
            throw new AppError(
              ERROR_CODES.VALIDATION,
              `El producto "${product.name}" es un insumo y no se puede vender.`,
            );
          }
          const unitPrice = resolveUnitPrice(product.price, line.unitPrice);
          const unitCost = asCop(product.avgCost);
          const lineTotal = mulCop(unitPrice, line.qty);
          saleTotal = addCop(saleTotal, lineTotal);
          prepared.push({
            id: line.id,
            productId: product.id,
            productName: product.name,
            qty: line.qty,
            unitPrice,
            unitCost,
            lineTotal,
          });
        }

        // C04 T27 — a «paid» sale may be covered partly by saldo a favor:
        // the uncovered part is recorded as this sale's credit and settled at
        // once by a credit_apply pair (no cash for it).
        // DB CHECKs keep «paid ⇒ credit = 0» and «received + credit = total»,
        // so it is stored as partial (or credit when nothing was received).
        let credit: bigint;
        let creditToApply = 0n;
        let storedKind: "paid" | "partial" | "credit" = dto.paymentKind;
        if (dto.paymentKind === "paid" && useCredit && amountReceived < saleTotal) {
          const shortfall = saleTotal - amountReceived;
          if (amountReceived < 0n || shortfall > creditBalance) {
            throw new AppError(ERROR_CODES.CREDIT_INSUFFICIENT, MESSAGES.creditInsufficient);
          }
          credit = shortfall;
          creditToApply = shortfall;
          storedKind = amountReceived > 0n ? "partial" : "credit";
        } else {
          credit = assertPaymentMath(dto.paymentKind, saleTotal, amountReceived).credit;
          if (useCredit && credit > 0n) {
            creditToApply = credit < creditBalance ? credit : creditBalance;
          }
        }

        const saleId = randomUUID();
        await tx.sale.create({
          data: {
            id: saleId,
            businessId: ctx.businessId,
            customerId: dto.customerId ?? null,
            paymentKind: storedKind,
            method,
            saleTotal,
            amountReceived,
            credit,
            requestId,
            payloadHash: hash,
            note: dto.note,
            occurredOn,
            occurredAt,
            syncedAt,
            createdAt: now,
          },
        });

        for (const line of prepared) {
          await tx.saleLine.create({
            data: {
              id: line.id ?? randomUUID(),
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
          const opens = await tx.cashSession.findMany({
            where: { businessId: ctx.businessId, closedAt: null },
          });
          const link = linkForNewMove(opens, occurredOn);
          await tx.cashMove.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              amount: amountReceived,
              direction: "in",
              method,
              kind: "sale",
              sessionId: link.sessionId,
              pendingForSessionId: link.pendingForSessionId,
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

        if (creditToApply > 0n && dto.customerId) {
          const obligations = await loadObligations(tx, ctx.businessId, dto.customerId);
          const plan = planOrThrow({
            amount: creditToApply,
            obligations,
            target: { mode: "sale", saleId },
            overflow: "credit",
          });
          await applyCreditToObligations(tx, {
            businessId: ctx.businessId,
            customerId: dto.customerId,
            plan,
            groupId: saleId,
            createdBy: ctx.userId,
            now,
          });
        }

        return tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: { lines: true },
        });
      });

      return this.saleCreditJson(ctx.businessId, created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.sale.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
          include: { lines: true },
        });
        if (again) {
          return replaySale(again);
        }
      }
      throw e;
    }
  }

  /**
   * C04 R5 — create/replay response: the sale + saldo a favor used in it
   * (from the stored credit_apply rows, never recalculated) and, when none
   * was used, what the customer has available (T28).
   */
  private async saleCreditJson(businessId: string, row: Parameters<typeof saleJson>[0]) {
    const base = saleJson(row);
    const rows = await this.prisma.debtAllocation.findMany({
      where: { businessId, groupId: row.id, mode: "credit_apply", targetType: "sale" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const applied = rows.reduce((a, r) => a + r.amount, 0n);
    const customer = row.customerId
      ? await this.prisma.customer.findFirst({ where: { id: row.customerId, businessId }, select: { creditBalance: true } })
      : null;
    return {
      ...base,
      creditApplied: copToJson(applied),
      allocations: rows.map((r) => ({
        targetType: r.targetType,
        saleId: r.saleId,
        initialDebtId: r.initialDebtId,
        amount: copToJson(r.amount),
      })),
      creditAvailable: customer ? copToJson(customer.creditBalance) : null,
    };
  }

  async list(ctx: BusinessContext, from?: string, to?: string, page: PageQuery = {}) {
    const where: Prisma.SaleWhereInput = { businessId: ctx.businessId };
    if (from || to) {
      where.occurredOn = {};
      if (from) where.occurredOn.gte = new Date(`${from}T00:00:00.000Z`);
      if (to) where.occurredOn.lte = new Date(`${to}T00:00:00.000Z`);
    }
    const after = await afterCursor(page.cursor, (id) =>
      this.prisma.sale.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true, createdAt: true } }),
    );
    const rows = await this.prisma.sale.findMany({
      where: after ? { AND: [where, after] } : where,
      include: { lines: true },
      orderBy: NEWEST_FIRST,
      take: pageProbe(page.limit),
    });
    return paged(rows, page.limit, saleJson);
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

  /** C04 — return JSON + its allocations (stored rows, never recalculated). */
  private async returnWithAllocations(
    businessId: string,
    r: Parameters<typeof returnJson>[0] & { needsReview?: boolean; remainderMode?: string | null },
  ) {
    const rows = await this.prisma.debtAllocation.findMany({
      where: { businessId, sourceType: "sale_return", sourceId: r.id, mode: { not: "credit_apply" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // Same order as written: obligations (own sale first, then FIFO), credit last.
    const saleIdOf = (r as { saleId?: string }).saleId;
    const rank = (x: (typeof rows)[number]) =>
      x.targetType === "credit" ? 2 : x.saleId != null && x.saleId === saleIdOf ? 0 : 1;
    rows.sort((a, b) => rank(a) - rank(b));
    const toCredit = rows.filter((x) => x.targetType === "credit").reduce((a, x) => a + x.amount, 0n);
    return {
      ...returnJson(r),
      toCredit: copToJson(toCredit),
      remainderMode: r.remainderMode ?? null,
      needsReview: r.needsReview ?? false,
      allocations: rows.map((x) => ({
        targetType: x.targetType,
        saleId: x.saleId,
        initialDebtId: x.initialDebtId,
        amount: copToJson(x.amount),
      })),
    };
  }

  async createReturn(
    ctx: BusinessContext,
    saleId: string,
    dto: CreateReturnDto,
    requestId: string,
    offlineReplay = false,
  ) {
    const existing = await this.prisma.saleReturn.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
      include: { lines: true },
    });
    if (existing) return this.returnWithAllocations(ctx.businessId, existing);

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

        // C04 / decision 6 (R6, §4.1): own sale first, then FIFO; the rest is
        // refund or saldo a favor as chosen. Offline replay without a choice
        // (decision 15) → saldo a favor + needs_review, never cash on its own.
        const obligations = sale.customerId
          ? await loadObligations(tx, ctx.businessId, sale.customerId)
          : [];
        const offlineDefault = offlineReplay && !dto.remainder && !!sale.customerId;
        const settlement = splitReturnSettlement({
          returnValue,
          saleCredit: sale.credit,
          alreadyDebtReduced,
          customerDebt,
          saleId,
          obligations,
          hasCustomer: !!sale.customerId,
          remainder: dto.remainder ?? (offlineDefault ? "credit" : null),
        });
        if (settlement.remainderRequired) {
          throw new AppError(
            ERROR_CODES.REMAINDER_CHOICE_REQUIRED,
            MESSAGES.remainderChoiceRequired,
          );
        }
        const { debtReduced, refundAmount, toCredit } = settlement;
        const remainderMode =
          settlement.rest > 0n ? (toCredit > 0n ? "credit" : "refund") : null;
        const needsReview = offlineDefault && toCredit > 0n;

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
            needsReview,
            remainderMode,
          },
        });
        if (sale.customerId) {
          await insertAllocations(tx, [
            ...settlement.lines.map((l) => ({
              businessId: ctx.businessId,
              customerId: sale.customerId!,
              sourceType: "sale_return" as const,
              sourceId: returnId,
              targetType: l.kind,
              saleId: l.kind === "sale" ? l.id : null,
              initialDebtId: l.kind === "initial_debt" ? l.id : null,
              amount: l.amount,
              mode: l.kind === "sale" && l.id === saleId ? ("explicit" as const) : ("fifo" as const),
              groupId: returnId,
              createdAt: now,
              createdBy: ctx.userId,
            })),
            ...(toCredit > 0n
              ? [
                  {
                    businessId: ctx.businessId,
                    customerId: sale.customerId,
                    sourceType: "sale_return" as const,
                    sourceId: returnId,
                    targetType: "credit" as const,
                    amount: toCredit,
                    mode: "explicit" as const,
                    groupId: returnId,
                    createdAt: now,
                    createdBy: ctx.userId,
                  },
                ]
              : []),
          ]);
        }

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
          const opens = await tx.cashSession.findMany({
            where: { businessId: ctx.businessId, closedAt: null },
          });
          const link = linkForNewMove(opens, occurredOn);
          await tx.cashMove.create({
            data: {
              id: randomUUID(),
              businessId: ctx.businessId,
              amount: refundAmount,
              direction: "out",
              method,
              kind: "devolucion",
              sessionId: link.sessionId,
              pendingForSessionId: link.pendingForSessionId,
              refType: "saleReturn",
              refId: returnId,
              occurredOn,
              createdAt: now,
            },
          });
        }

        if (debtReduced > 0n || toCredit > 0n) {
          if (!sale.customerId) {
            throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
          }
          await moveCustomerBalances(tx, ctx.businessId, sale.customerId, {
            debt: -debtReduced,
            credit: toCredit,
          });
        }

        return tx.saleReturn.findUniqueOrThrow({
          where: { id: returnId },
          include: { lines: true },
        });
      });

      return this.returnWithAllocations(ctx.businessId, created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.saleReturn.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
          include: { lines: true },
        });
        if (again) return this.returnWithAllocations(ctx.businessId, again);
      }
      throw e;
    }
  }
}
