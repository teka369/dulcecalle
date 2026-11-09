import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { IDEMPOTENCY_MISMATCH_MESSAGE } from "../shared/payload-hash";
import { asCop, copToJson } from "../shared/money";
import { dateKey, occurredOnDate } from "../shared/clock";
import { assertDayEditable, lockAndAssertDayEditable } from "../shared/day-guard";
import { linkForNewMove } from "./session-link";
import {
  allocationRowJson,
  applyCreditToObligations,
  insertAllocations,
  loadObligations,
  moveCustomerBalances,
  parseTarget,
  planLinesJson,
  planOrThrow,
  resolveTarget,
} from "../shared/debt-allocations";
import { CashService } from "./cash.service";
import type { BusinessContext } from "../identity/auth.types";
import type { ApplyCreditDto, RefundCreditDto } from "./debt.dto";

function mismatch(): never {
  throw new AppError(ERROR_CODES.IDEMPOTENCY_MISMATCH, IDEMPOTENCY_MISMATCH_MESSAGE);
}

/**
 * C04 — saldo a favor (R5 apply, R5b refund), adjusted-payment review (T32)
 * and the read-only balance check (§5 I-A3/I-A4).
 */
@Injectable()
export class DebtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
  ) {}

  private async applyReplay(ctx: BusinessContext, customerId: string, groupId: string, amount?: number) {
    const rows = await this.prisma.debtAllocation.findMany({
      where: { businessId: ctx.businessId, groupId, mode: "credit_apply" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (rows.length === 0) return null;
    if (rows.some((r) => r.customerId !== customerId)) mismatch();
    const applied = rows.filter((r) => r.targetType !== "credit").reduce((a, r) => a + r.amount, 0n);
    if (amount != null && asCop(amount) !== applied) mismatch();
    const customer = await this.prisma.customer.findFirstOrThrow({ where: { id: customerId, businessId: ctx.businessId } });
    return {
      groupId,
      customerId,
      creditApplied: copToJson(applied),
      allocations: rows.filter((r) => r.targetType !== "credit").map((r) => ({
        targetType: r.targetType,
        saleId: r.saleId,
        initialDebtId: r.initialDebtId,
        amount: copToJson(r.amount),
      })),
      debtAfter: copToJson(customer.debt),
      creditBalanceAfter: copToJson(customer.creditBalance),
    };
  }

  /** R5 — apply saldo a favor to open obligations. No cash moves. */
  async applyCredit(ctx: BusinessContext, customerId: string, dto: ApplyCreditDto, requestId: string) {
    const target = parseTarget(dto.target, false);
    const prior = await this.applyReplay(ctx, customerId, requestId, dto.amount);
    if (prior) return prior;
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
      const again = await tx.debtAllocation.count({ where: { businessId: ctx.businessId, groupId: requestId } });
      if (again > 0) return null;
      const customer = await tx.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId } });
      if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
      const wanted = dto.amount != null ? asCop(dto.amount) : customer.creditBalance < customer.debt ? customer.creditBalance : customer.debt;
      if (customer.creditBalance <= 0n || wanted > customer.creditBalance) {
        throw new AppError(ERROR_CODES.CREDIT_INSUFFICIENT, MESSAGES.creditInsufficient);
      }
      if (wanted <= 0n) {
        throw new AppError(ERROR_CODES.ALLOCATION_INVALID, "No hay compras pendientes para aplicar el saldo a favor.");
      }
      const loaded = await loadObligations(tx, ctx.businessId, customerId);
      const resolved = await resolveTarget(tx, ctx.businessId, customerId, target, loaded);
      const plan = planOrThrow({ amount: wanted, obligations: resolved.obligations, target: resolved.input, overflow: "credit", cap: customer.debt });
      if (plan.adjusted || plan.toObligations <= 0n) {
        throw new AppError(ERROR_CODES.ALLOCATION_INVALID, "Esa compra ya está saldada.");
      }
      if (dto.amount != null && plan.toCredit > 0n) {
        throw new AppError(ERROR_CODES.ALLOCATION_INVALID, "Es más de lo que se debe en esas compras.");
      }
      const applied = await applyCreditToObligations(tx, {
        businessId: ctx.businessId,
        customerId,
        plan,
        groupId: requestId,
        createdBy: ctx.userId,
        now,
      });
      return {
        groupId: requestId,
        customerId,
        creditApplied: copToJson(applied),
        allocations: planLinesJson(plan).filter((l) => l.targetType !== "credit"),
        debtBefore: copToJson(customer.debt),
        debtAfter: copToJson(customer.debt - applied),
        creditBalanceAfter: copToJson(customer.creditBalance - applied),
      };
    });
    if (result) return result;
    const raced = await this.applyReplay(ctx, customerId, requestId, dto.amount);
    if (!raced) mismatch();
    return raced;
  }

  private refundJson(m: { id: string; amount: bigint; method: string; kind: string; refId: string | null; occurredOn: Date; createdAt: Date; sessionId: string | null }) {
    return {
      id: m.id,
      customerId: m.refId,
      amount: copToJson(m.amount),
      method: m.method,
      kind: m.kind,
      direction: "out" as const,
      sessionId: m.sessionId,
      occurredOn: dateKey(m.occurredOn),
      createdAt: m.createdAt,
    };
  }

  /** R5b — owner pays saldo a favor back in money. Needs today's caja open. */
  async refundCredit(ctx: BusinessContext, customerId: string, dto: RefundCreditDto, requestId: string) {
    const existing = await this.prisma.cashMove.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    const replay = (m: NonNullable<typeof existing>) => {
      if (m.kind !== "reembolso_saldo" || m.refId !== customerId || m.amount !== asCop(dto.amount) || m.method !== dto.method) {
        mismatch();
      }
      return this.refundJson(m);
    };
    if (existing) return replay(existing);
    const amount = asCop(dto.amount);
    if (amount <= 0n) throw new AppError(ERROR_CODES.VALIDATION, "El monto tiene que ser mayor a 0.");
    if (dto.method !== "Efectivo" && dto.method !== "Nequi") {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.noMethod);
    }
    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);
    try {
      const move = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);
        const today = await tx.cashSession.findUnique({
          where: { businessId_localDate: { businessId: ctx.businessId, localDate: occurredOn } },
        });
        if (!today || today.closedAt) {
          throw new AppError(ERROR_CODES.CLOSED_DAY, MESSAGES.refundNeedsOpenCaja);
        }
        const customer = await tx.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId } });
        if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
        if (customer.creditBalance < amount) {
          throw new AppError(ERROR_CODES.CREDIT_INSUFFICIENT, MESSAGES.creditInsufficient);
        }
        const opens = await tx.cashSession.findMany({ where: { businessId: ctx.businessId, closedAt: null } });
        const link = linkForNewMove(opens, occurredOn);
        const id = randomUUID();
        const created = await tx.cashMove.create({
          data: {
            id,
            businessId: ctx.businessId,
            amount,
            direction: "out",
            method: dto.method,
            kind: "reembolso_saldo",
            sessionId: link.sessionId,
            pendingForSessionId: link.pendingForSessionId,
            refType: "customer",
            refId: customerId,
            requestId,
            note: "Devolución de saldo a favor",
            occurredOn,
            createdAt: now,
          },
        });
        await insertAllocations(tx, [
          {
            businessId: ctx.businessId,
            customerId,
            sourceType: "credit_refund",
            sourceId: id,
            targetType: "credit",
            amount: -amount,
            mode: "explicit",
            groupId: id,
            createdAt: now,
            createdBy: ctx.userId,
          },
        ]);
        await moveCustomerBalances(tx, ctx.businessId, customerId, { debt: 0n, credit: -amount });
        return created;
      });
      return this.refundJson(move);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.cashMove.findUnique({
          where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
        });
        if (again) return replay(again);
      }
      throw e;
    }
  }

  /** T32 / decision 20 — owner marks an adjusted payment as reviewed (one tap). */
  async reviewAdjustedPayment(ctx: BusinessContext, customerId: string, paymentId: string) {
    const row = await this.prisma.customerPayment.findFirst({
      where: { id: paymentId, customerId, businessId: ctx.businessId },
    });
    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    if (!row.allocationAdjusted) {
      throw new AppError(ERROR_CODES.VALIDATION, "Este abono no necesita revisión.");
    }
    if (row.adjustedReviewedAt) return this.cash.paymentWithAllocations(row);
    const updated = await this.prisma.customerPayment.update({
      where: { id: row.id },
      data: { adjustedReviewedAt: new Date(), adjustedReviewedBy: ctx.userId },
    });
    return { ...(await this.cash.paymentWithAllocations(updated)), adjustedReviewedBy: updated.adjustedReviewedBy };
  }

  /** §5 I-A3 / I-A4 for one customer. Read-only. */
  async balanceCheck(ctx: BusinessContext, customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId } });
    if (!c) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const [debtRow] = await this.prisma.$queryRaw<Array<{ reconstructed: bigint | null }>>`
      WITH obl AS (
        SELECT s.business_id, s.customer_id, s.id, s.credit AS orig FROM sales s
          WHERE s.credit > 0 AND s.business_id = ${ctx.businessId}::uuid AND s.customer_id = ${customerId}::uuid
        UNION ALL SELECT d.business_id, d.customer_id, d.id, d.amount FROM initial_debts d
          WHERE d.business_id = ${ctx.businessId}::uuid AND d.customer_id = ${customerId}::uuid),
      alloc AS (
        SELECT business_id, COALESCE(sale_id, initial_debt_id) oid, SUM(amount) a
        FROM debt_allocations
        WHERE target_type <> 'credit' AND business_id = ${ctx.businessId}::uuid AND customer_id = ${customerId}::uuid
        GROUP BY 1, 2)
      SELECT COALESCE(SUM(o.orig - COALESCE(a.a, 0)), 0)::bigint AS reconstructed
      FROM obl o LEFT JOIN alloc a ON a.oid = o.id AND a.business_id = o.business_id
    `;
    const [creditRow] = await this.prisma.$queryRaw<Array<{ credit: bigint | null }>>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS credit FROM debt_allocations
      WHERE business_id = ${ctx.businessId}::uuid AND customer_id = ${customerId}::uuid AND target_type = 'credit'
    `;
    const reconstructedDebt = debtRow?.reconstructed ?? 0n;
    const reconstructedCredit = creditRow?.credit ?? 0n;
    return {
      customerId,
      stored: { debt: copToJson(c.debt), creditBalance: copToJson(c.creditBalance) },
      reconstructed: { debt: copToJson(reconstructedDebt), creditBalance: copToJson(reconstructedCredit) },
      ok: reconstructedDebt === c.debt && reconstructedCredit === c.creditBalance && c.creditBalance >= 0n,
    };
  }

  /** Stored allocation rows of one customer (ledger helper). */
  async rowsForCustomer(businessId: string, customerId: string) {
    const rows = await this.prisma.debtAllocation.findMany({
      where: { businessId, customerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => allocationRowJson(r, true));
  }
}
