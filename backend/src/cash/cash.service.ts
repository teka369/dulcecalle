import { assertSamePayload, payloadHash } from "../shared/payload-hash";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { parseOccurredAt } from "../shared/occurred-at";
import { addCop, asCop, copToJson, subCop } from "../shared/money";
import { dateKey, occurredOnDate } from "../shared/clock";
import { linkForNewMove } from "./session-link";
import { sessionExpected } from "./carry-rules";
import { assertDayEditable, lockAndAssertDayEditable } from "../shared/day-guard";
import type { BusinessContext } from "../identity/auth.types";
import type { CreatePaymentDto } from "../sales/sales.dto";
import {
  insertAllocations,
  loadObligations,
  moveCustomerBalances,
  parseOverflow,
  parseTarget,
  planLinesJson,
  planOrThrow,
  resolveTarget,
  targetHashFields,
  type AllocationJson,
  type PaymentTarget,
} from "../shared/debt-allocations";
import { afterCursor, NEWEST_FIRST, paged, pageProbe, type PageQuery } from "../shared/http/paging";
import type { CashOwnerMoveDto, CreateExpenseDto } from "./cash.dto";

export function isOneOpenConstraint(error: { message?: string; meta?: unknown }): boolean {
  const blob = `${error.message ?? ""} ${JSON.stringify(error.meta ?? {})}`;
  return blob.includes("cash_sessions_one_open_per_business");
}

function sessionJson(s: {
  id: string;
  localDate: Date;
  openedAt: Date;
  closedAt: Date | null;
  openingFloat: bigint;
  closingCount: bigint | null;
  expectedEfectivo: bigint | null;
  expectedNequi: bigint | null;
  difference: bigint | null;
  unresolvedCount?: number | null;
  unresolvedAmount?: bigint | null;
}) {
  return {
    id: s.id,
    localDate: dateKey(s.localDate),
    unresolvedCount: s.unresolvedCount ?? null,
    unresolvedAmount: s.unresolvedAmount == null ? null : copToJson(s.unresolvedAmount),
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    openingFloat: copToJson(s.openingFloat),
    closingCount: s.closingCount == null ? null : copToJson(s.closingCount),
    expectedEfectivo:
      s.expectedEfectivo == null ? null : copToJson(s.expectedEfectivo),
    expectedNequi: s.expectedNequi == null ? null : copToJson(s.expectedNequi),
    difference: s.difference == null ? null : copToJson(s.difference),
  };
}

function cashMoveJson(m: {
  id: string;
  amount: bigint;
  direction: string;
  method: string;
  kind: string;
  refType: string | null;
  refId: string | null;
  note: string | null;
  occurredOn: Date;
  createdAt: Date;
}) {
  return {
    id: m.id,
    amount: copToJson(m.amount),
    direction: m.direction,
    method: m.method,
    kind: m.kind,
    refType: m.refType,
    refId: m.refId,
    note: m.note,
    occurredOn: dateKey(m.occurredOn),
    createdAt: m.createdAt,
  };
}

function expenseJson(e: {
  id: string;
  amount: bigint;
  category: string;
  method: string;
  note: string | null;
  occurredOn: Date;
  createdAt: Date;
}) {
  return {
    id: e.id,
    amount: copToJson(e.amount),
    category: e.category,
    method: e.method,
    note: e.note,
    occurredOn: dateKey(e.occurredOn),
    createdAt: e.createdAt,
  };
}

type StoredAllocationResult = {
  allocations: AllocationJson[];
  debtBefore: number;
  debtAfter: number;
  creditBalanceAfter: number;
  adjusted: boolean;
};

type PaymentRow = {
  id: string;
  businessId: string;
  customerId: string;
  amount: bigint;
  method: string;
  note: string | null;
  occurredOn: Date;
  occurredAt: Date | null;
  syncedAt: Date | null;
  needsReview: boolean;
  createdAt: Date;
  requestedTarget: Prisma.JsonValue | null;
  allocationResult: Prisma.JsonValue | null;
  allocationAdjusted: boolean;
  adjustedReviewedAt: Date | null;
};

/** Stored requested_target → canonical target + overflow (null for pre-C04 rows). */
function storedTarget(raw: Prisma.JsonValue | null): { target: PaymentTarget; overflow: "fifo" | "credit" } | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { overflow, ...target } = raw as Record<string, unknown>;
  try {
    const t = parseTarget(target);
    return { target: t, overflow: t.mode === "fifo" ? "fifo" : parseOverflow(overflow) };
  } catch {
    return null;
  }
}

function paymentJson(p: {
  id: string;
  customerId: string;
  amount: bigint;
  method: string;
  note: string | null;
  occurredOn: Date;
  occurredAt?: Date | null;
  syncedAt?: Date | null;
  needsReview?: boolean;
  createdAt: Date;
}) {
  return {
    id: p.id,
    customerId: p.customerId,
    amount: copToJson(p.amount),
    method: p.method,
    note: p.note,
    occurredOn: dateKey(p.occurredOn),
    occurredAt: p.occurredAt ?? p.createdAt,
    syncedAt: p.syncedAt ?? p.createdAt,
    needsReview: p.needsReview ?? false,
    createdAt: p.createdAt,
  };
}

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  async expectedBuckets(
    businessId: string,
    localDate: Date,
    db: {
      cashSession: PrismaService["cashSession"];
      cashMove: PrismaService["cashMove"];
    } = this.prisma,
  ) {
    const session = await db.cashSession.findUnique({
      where: { businessId_localDate: { businessId, localDate } },
    });
    if (!session) return { efectivo: 0n, nequi: 0n, total: 0n };
    return this.expectedForSession(session, db);
  }

  async expectedForSession(
    session: { id: string; businessId: string; openingFloat: bigint; carriedEfectivo?: bigint },
    db: {
      cashMove: PrismaService["cashMove"];
    } = this.prisma,
  ) {
    const moves = await db.cashMove.findMany({
      where: {
        businessId: session.businessId,
        OR: [
          { sessionId: session.id },
          { sessionId: null, pendingForSessionId: session.id },
        ],
      },
    });
    const expected = sessionExpected({
      sessionId: session.id,
      openingFloat: asCop(session.openingFloat),
      carriedEfectivo: asCop(session.carriedEfectivo ?? 0n),
      moves,
    });
    return { ...expected, total: addCop(expected.efectivo, expected.nequi) };
  }

  async open(ctx: BusinessContext, openingFloat: number, requestId: string = randomUUID()) {
    const float = asCop(openingFloat);
    if (float < 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "El monto no puede ser negativo.");
    }
    const localDate = occurredOnDate(ctx.timezone);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
      const existingByRequest = await tx.cashSession.findUnique({
        where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
      });
      if (existingByRequest) return sessionJson(existingByRequest);
      const today = await tx.cashSession.findUnique({
        where: { businessId_localDate: { businessId: ctx.businessId, localDate } },
      });
      if (today) return sessionJson(today);
      const otherOpen = await tx.cashSession.findFirst({
        where: { businessId: ctx.businessId, closedAt: null },
      });
      if (otherOpen) {
        throw new AppError(ERROR_CODES.PENDING_SESSION, MESSAGES.pendingSession);
      }
      try {
        const created = await tx.cashSession.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            localDate,
            openedAt: new Date(),
            closedAt: null,
            openingFloat: float,
            requestId,
          },
        });
        return sessionJson(created);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const again = await tx.cashSession.findUnique({
            where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
          });
          if (again) return sessionJson(again);
          if (isOneOpenConstraint(e)) {
            throw new AppError(ERROR_CODES.PENDING_SESSION, MESSAGES.pendingSession);
          }
          const raced = await tx.cashSession.findUnique({
            where: { businessId_localDate: { businessId: ctx.businessId, localDate } },
          });
          if (raced) return sessionJson(raced);
          throw e;
        }
        throw e;
      }
    });
  }

  async close(
    ctx: BusinessContext,
    sessionId: string,
    countedEfectivo: number,
    requestId: string = randomUUID(),
    mark: { unresolvedCount?: number; unresolvedAmount?: number } = {},
  ) {
    const existingByRequest = await this.prisma.cashSession.findUnique({
      where: { businessId_closeRequestId: { businessId: ctx.businessId, closeRequestId: requestId } },
    });
    if (existingByRequest) return sessionJson(existingByRequest);

    const counted = asCop(countedEfectivo);
    if (counted < 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "Revisa el monto contado.");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
      const session = await tx.cashSession.findFirst({
        where: { id: sessionId, businessId: ctx.businessId },
      });
      if (!session) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
      if (session.closedAt) {
        throw new AppError(
          ERROR_CODES.SESSION_ALREADY_CLOSED,
          MESSAGES.sessionAlreadyClosed,
        );
      }
      const stamped = await tx.cashMove.count({
        where: {
          businessId: ctx.businessId,
          sessionId: null,
          pendingForSessionId: session.id,
        },
      });
      if (stamped > 0) {
        throw new AppError(ERROR_CODES.CARRY_REQUIRED, MESSAGES.carryRequired);
      }
      const expected = await this.expectedBuckets(
        ctx.businessId,
        session.localDate,
        tx,
      );
      const difference = subCop(counted, expected.efectivo);
      const updated = await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          closedAt: new Date(),
          closeMode: "counted",
          closingCount: counted,
          expectedEfectivo: expected.efectivo,
          expectedNequi: expected.nequi,
          difference,
          closeRequestId: requestId,
          ...(mark.unresolvedCount && mark.unresolvedCount > 0
            ? {
                unresolvedCount: mark.unresolvedCount,
                unresolvedAmount: asCop(mark.unresolvedAmount ?? 0),
              }
            : {}),
        },
      });
      return sessionJson(updated);
    });
  }

  async today(ctx: BusinessContext) {
    const localDate = occurredOnDate(ctx.timezone);
    const session = await this.prisma.cashSession.findUnique({
      where: { businessId_localDate: { businessId: ctx.businessId, localDate } },
    });
    const expected = await this.expectedBuckets(ctx.businessId, localDate);
    const moves = await this.prisma.cashMove.findMany({
      where: { businessId: ctx.businessId, occurredOn: localDate },
      orderBy: { createdAt: "asc" },
    });
    const opens = await this.prisma.cashSession.findMany({
      where: { businessId: ctx.businessId, closedAt: null },
      orderBy: { localDate: "asc" },
    });
    const pending = opens.filter((row) => dateKey(row.localDate) < dateKey(localDate) || opens.length > 1);
    const needsReviewCount = await this.prisma.cashMove.count({
      where: { businessId: ctx.businessId, sessionId: null, pendingForSessionId: null },
    });
    return {
      localDate: dateKey(localDate),
      session: session ? sessionJson(session) : null,
      // C07 / QA M14.I6 — same computation as the cierre (sessionExpected):
      // opening + carried + Σ Efectivo in − Σ Efectivo out; Nequi never counts.
      expectedEfectivo: copToJson(expected.efectivo),
      expectedNequi: copToJson(expected.nequi),
      expected: {
        efectivo: copToJson(expected.efectivo),
        nequi: copToJson(expected.nequi),
        total: copToJson(expected.total),
      },
      closed: session?.closedAt != null,
      pendingCount: pending.length,
      pendingSessions: pending.map((row) => ({
        id: row.id,
        localDate: dateKey(row.localDate),
        openedAt: row.openedAt,
        openingFloat: copToJson(row.openingFloat),
      })),
      needsReviewCount,
      conflict: false,
      canOpen: opens.length === 0 && session?.closedAt == null,
      canCountClose: pending.length === 1 && pending[0] != null,
      carryMode: needsReviewCount > 0 ? "assumed" : "counted",
      moves: moves.map((m) => ({
        id: m.id,
        amount: copToJson(m.amount),
        direction: m.direction,
        method: m.method,
        kind: m.kind,
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        occurredOn: dateKey(m.occurredOn),
        createdAt: m.createdAt,
      })),
    };
  }

  async listMoves(
    ctx: BusinessContext,
    date?: string,
    from?: string,
    to?: string,
  ) {
    const where: Prisma.CashMoveWhereInput = { businessId: ctx.businessId };
    if (from || to) {
      where.occurredOn = {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
      };
    } else {
      where.occurredOn = date
        ? new Date(`${date}T00:00:00.000Z`)
        : occurredOnDate(ctx.timezone);
    }
    const moves = await this.prisma.cashMove.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return moves.map(cashMoveJson);
  }

  async listExpenses(ctx: BusinessContext, from?: string, to?: string, page: PageQuery = {}) {
    const where: Prisma.ExpenseWhereInput = { businessId: ctx.businessId };
    if (from || to) {
      where.occurredOn = {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
      };
    }
    const after = await afterCursor(page.cursor, (id) =>
      this.prisma.expense.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true, createdAt: true } }),
    );
    const rows = await this.prisma.expense.findMany({
      where: after ? { AND: [where, after] } : where,
      orderBy: NEWEST_FIRST,
      take: pageProbe(page.limit),
    });
    return paged(rows, page.limit, expenseJson);
  }

  /**
   * C02 / DC-13 — the key is bound to (customer, amount, method, note) and,
   * since C04, to a non-default target/overflow (T14). C03: never occurredAt.
   */
  paymentHash(customerId: string, dto: Pick<CreatePaymentDto, "amount" | "method" | "note" | "target" | "overflow">) {
    // C04 §6.1 — canonical target/overflow (malformed → 400 before any write).
    const target = parseTarget(dto.target);
    const overflow = target.mode === "fifo" ? "fifo" : parseOverflow(dto.overflow);
    const hash = payloadHash({
      customerId,
      amount: String(dto.amount),
      method: dto.method,
      note: dto.note ?? null,
      ...targetHashFields(target, overflow),
    });
    return { target, overflow, hash };
  }

  async recordPayment(
    ctx: BusinessContext,
    customerId: string,
    dto: CreatePaymentDto,
    requestId: string,
  ) {
    const { target, overflow, hash } = this.paymentHash(customerId, dto);
    const existing = await this.prisma.customerPayment.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    const replay = async (row: NonNullable<typeof existing>) => {
      if (row.payloadHash != null) {
        assertSamePayload(row.payloadHash, hash);
      } else {
        // C02.1 legacy NULL hash. Rows without requested_target are pre-C04:
        // rebuild the 4-field hash; newer rows add their stored target.
        const stored = storedTarget(row.requestedTarget);
        const reconstructed = payloadHash({
          customerId: row.customerId,
          amount: String(row.amount),
          method: row.method,
          note: row.note ?? null,
          ...(stored ? targetHashFields(stored.target, stored.overflow) : {}),
        });
        assertSamePayload(reconstructed, hash);
        await this.prisma.customerPayment.update({
          where: { id: row.id },
          data: { payloadHash: hash },
        });
      }
      // §6.4 — identical response: stored allocations, never recalculated.
      return this.paymentWithAllocations(row);
    };
    if (existing) {
      return replay(existing);
    }

    this.assertPaymentInput(dto);
    const now = new Date();
    const occurredAt = parseOccurredAt(dto.occurredAt, now);

    try {
      const pay = await this.prisma.$transaction(async (tx) => {
        // C01 / DC-01 — decision 1: an abono is money already received. It is
        // never rejected for a closed day: it goes to the open operating day,
        // or stays «recibido sin aplicar / requiere revisión» (unassigned).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
        return this.createPaymentInTx(tx, ctx, customerId, {
          id: randomUUID(),
          dto,
          target,
          overflow,
          hash,
          requestId,
          now,
          occurredAt,
        });
      });
      return this.paymentWithAllocations(pay);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.customerPayment.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) {
          return replay(again);
        }
      }
      throw e;
    }
  }

  assertPaymentInput(dto: Pick<CreatePaymentDto, "amount" | "method">) {
    const amount = asCop(dto.amount);
    if (amount <= 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "El abono tiene que ser mayor a 0.");
    }
    if (dto.method !== "Efectivo" && dto.method !== "Nequi") {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.noMethod);
    }
  }

  /**
   * One abono inside the caller's transaction, after the per-business
   * advisory lock (R8): allocation rows, balances and exactly one
   * debt_collect. Shared by POST payments and C07 «corregir abono».
   */
  async createPaymentInTx(
    tx: Prisma.TransactionClient,
    ctx: BusinessContext,
    customerId: string,
    args: {
      id: string;
      dto: Pick<CreatePaymentDto, "amount" | "method" | "note">;
      target: PaymentTarget;
      overflow: "fifo" | "credit";
      hash: string;
      requestId: string;
      now: Date;
      occurredAt: Date;
      /** C07 «corregir» (decision 21). */
      replacesPaymentId?: string | null;
    },
  ) {
    const { id, dto, target, overflow, hash, requestId, now } = args;
    const amount = asCop(dto.amount);
    const occurredOn = occurredOnDate(ctx.timezone, now);
    const customer = await tx.customer.findFirst({
      where: { id: customerId, businessId: ctx.businessId },
    });
    if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);

    // C04 — allocation (R1–R4, §6.3). Inside the lock (R8 / T11).
    const loaded = await loadObligations(tx, ctx.businessId, customerId);
    const resolved = await resolveTarget(tx, ctx.businessId, customerId, target, loaded);
    const plan = planOrThrow({
      amount,
      obligations: resolved.obligations,
      target: resolved.input,
      overflow,
      cap: customer.debt,
    });
    const debtAfter = customer.debt - plan.toObligations;
    const creditAfter = customer.creditBalance + plan.toCredit;
    const allocationResult = {
      allocations: planLinesJson(plan),
      debtBefore: copToJson(customer.debt),
      debtAfter: copToJson(debtAfter),
      creditBalanceAfter: copToJson(creditAfter),
      adjusted: plan.adjusted,
    };

    const opens = await tx.cashSession.findMany({
      where: { businessId: ctx.businessId, closedAt: null },
    });
    const link = linkForNewMove(opens, occurredOn);
    const needsReview = link.sessionId == null && link.pendingForSessionId == null;
    const payment = await tx.customerPayment.create({
      data: {
        id,
        businessId: ctx.businessId,
        customerId,
        amount,
        method: dto.method,
        note: dto.note ?? null,
        requestId,
        occurredOn,
        occurredAt: args.occurredAt,
        syncedAt: now,
        needsReview,
        payloadHash: hash,
        requestedTarget: { ...target, overflow } as Prisma.InputJsonValue,
        allocationResult: allocationResult as Prisma.InputJsonValue,
        allocationAdjusted: plan.adjusted,
        replacesPaymentId: args.replacesPaymentId ?? null,
        createdAt: now,
      },
    });
    await insertAllocations(
      tx,
      plan.lines.map((l) => ({
        businessId: ctx.businessId,
        customerId,
        sourceType: "payment",
        sourceId: id,
        targetType: l.targetType,
        saleId: l.targetType === "sale" ? l.id : null,
        initialDebtId: l.targetType === "initial_debt" ? l.id : null,
        amount: l.amount,
        mode: l.mode,
        groupId: id,
        createdAt: now,
        createdBy: ctx.userId,
      })),
    );
    // R4 — no more 409 ABONO_EXCEEDS_DEBT: the surplus is saldo a favor.
    await moveCustomerBalances(tx, ctx.businessId, customerId, {
      debt: -plan.toObligations,
      credit: plan.toCredit,
    });
    // §3.3 — allocation never creates or edits cash moves; the money in is
    // still exactly one debt_collect for the full amount (I-A6).
    await tx.cashMove.create({
      data: {
        id: randomUUID(),
        businessId: ctx.businessId,
        amount,
        direction: "in",
        method: dto.method,
        kind: "debt_collect",
        sessionId: link.sessionId,
        pendingForSessionId: link.pendingForSessionId,
        needsReview,
        refType: "payment",
        refId: id,
        requestId,
        occurredOn,
        createdAt: now,
      },
    });
    return payment;
  }

  /** Payment JSON + C04 allocation snapshot (stored at creation time). */
  async paymentWithAllocations(row: PaymentRow) {
    const base = paymentJson(row);
    const stored = row.allocationResult as StoredAllocationResult | null;
    if (stored && typeof stored === "object" && Array.isArray(stored.allocations)) {
      return {
        ...base,
        requestedTarget: row.requestedTarget ?? null,
        allocations: stored.allocations,
        debtBefore: stored.debtBefore,
        debtAfter: stored.debtAfter,
        creditBalanceAfter: stored.creditBalanceAfter,
        adjusted: row.allocationAdjusted,
        adjustedReviewedAt: row.adjustedReviewedAt ?? null,
      };
    }
    // Pre-C04 row: rows written by the backfill, if any; no snapshot.
    const rows = await this.prisma.debtAllocation.findMany({
      where: { businessId: row.businessId, sourceType: "payment", sourceId: row.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return {
      ...base,
      requestedTarget: row.requestedTarget ?? null,
      allocations: rows.map((r) => ({
        targetType: r.targetType,
        saleId: r.saleId,
        initialDebtId: r.initialDebtId,
        amount: copToJson(r.amount),
        openBefore: null,
        openAfter: null,
      })),
      debtBefore: null,
      debtAfter: null,
      creditBalanceAfter: null,
      adjusted: row.allocationAdjusted,
      adjustedReviewedAt: row.adjustedReviewedAt ?? null,
    };
  }

  async ownerAporte(
    ctx: BusinessContext,
    dto: CashOwnerMoveDto,
    requestId: string,
  ) {
    return this.recordOwnerMove(ctx, "aporte", "in", dto, requestId);
  }

  async ownerRetiro(
    ctx: BusinessContext,
    dto: CashOwnerMoveDto,
    requestId: string,
  ) {
    return this.recordOwnerMove(ctx, "retiro", "out", dto, requestId);
  }

  async recordExpense(
    ctx: BusinessContext,
    dto: CreateExpenseDto,
    requestId: string,
  ) {
    const existing = await this.prisma.expense.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return expenseJson(existing);

    const amount = asCop(dto.amount);
    if (amount <= 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "El monto tiene que ser mayor a 0.");
    }
    if (dto.method !== "Efectivo" && dto.method !== "Nequi") {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.noMethod);
    }
    const category = dto.category.trim();
    if (!category) {
      throw new AppError(ERROR_CODES.VALIDATION, "Di en qué se gastó.");
    }

    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);
        const id = randomUUID();
        const expense = await tx.expense.create({
          data: {
            id,
            businessId: ctx.businessId,
            amount,
            category,
            note: dto.note,
            method: dto.method,
            requestId,
            occurredOn,
            createdAt: now,
          },
        });
        const opens = await tx.cashSession.findMany({
          where: { businessId: ctx.businessId, closedAt: null },
        });
        const link = linkForNewMove(opens, occurredOn);
                // requestId lives on expenses only. cash_moves.request_id is UUID and
        // reserved for aporte/retiro; Dexie `expense-${id}` is not a UUID.
        await tx.cashMove.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            amount,
            direction: "out",
            method: dto.method,
            kind: "expense",
            sessionId: link.sessionId,
            pendingForSessionId: link.pendingForSessionId,
            refType: "expense",
            refId: id,
            note: category,
            occurredOn,
            createdAt: now,
          },
        });
        return expense;
      });
      return expenseJson(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.expense.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) return expenseJson(again);
      }
      throw e;
    }
  }

  private async recordOwnerMove(
    ctx: BusinessContext,
    kind: "aporte" | "retiro",
    direction: "in" | "out",
    dto: CashOwnerMoveDto,
    requestId: string,
  ) {
    const existing = await this.prisma.cashMove.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return cashMoveJson(existing);

    const amount = asCop(dto.amount);
    if (amount <= 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "El monto tiene que ser mayor a 0.");
    }
    if (dto.method !== "Efectivo" && dto.method !== "Nequi") {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.noMethod);
    }

    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    try {
      const move = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);
        const opens = await tx.cashSession.findMany({
          where: { businessId: ctx.businessId, closedAt: null },
        });
        const link = linkForNewMove(opens, occurredOn);
                return tx.cashMove.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            amount,
            direction,
            method: dto.method,
            kind,
            sessionId: link.sessionId,
            pendingForSessionId: link.pendingForSessionId,
            note: dto.note,
            requestId,
            occurredOn,
            createdAt: now,
          },
        });
      });
      return cashMoveJson(move);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.cashMove.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) return cashMoveJson(again);
      }
      throw e;
    }
  }
}
