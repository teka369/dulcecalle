import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES, type ErrorCode } from "../shared/errors";
import { assertSamePayload, IDEMPOTENCY_MISMATCH_MESSAGE, payloadHash } from "../shared/payload-hash";
import { copToJson, mulCop } from "../shared/money";
import { dateKey, occurredOnDate } from "../shared/clock";
import { resolveIdempotencyKey } from "../shared/idempotency";
import { loadObligations, moveCustomerBalances } from "../shared/debt-allocations";
import type { Obligation } from "../shared/allocation";
import {
  planPaymentReversal,
  planSaleVoid,
  ReversalPlanError,
  type AllocRow,
  type ReversalLine,
} from "../shared/reversal-plan";
import { afterCursor, NEWEST_FIRST, paged, pageProbe, type PageQuery } from "../shared/http/paging";
import type { BusinessContext } from "../identity/auth.types";
import { CashService } from "./cash.service";
import type { CorrectPaymentDto, ReverseDto } from "./reversals.dto";

type Tx = Prisma.TransactionClient;
type Blocker = "CLOSED_DAY" | "CONFIRM_OLD_REQUIRED" | "CASH_SESSION_REQUIRED";
type Method = "Efectivo" | "Nequi";

const BLOCKER_MESSAGE: Record<Blocker, string> = {
  CLOSED_DAY: MESSAGES.closedDayReversal,
  CONFIRM_OLD_REQUIRED: MESSAGES.confirmOldRequired,
  CASH_SESSION_REQUIRED: MESSAGES.cashSessionRequired,
};
/** Order of the error a real call answers when several blockers apply. */
const BLOCKER_ORDER: Blocker[] = ["CLOSED_DAY", "CONFIRM_OLD_REQUIRED", "CASH_SESSION_REQUIRED"];

const OLD_DAYS = 30;

type Snapshot = {
  customerId: string | null;
  debt: number | null;
  creditBalance: number | null;
  openBalances: Array<{ targetType: string; id: string; open: number }>;
  stock: Array<{ productId: string; stock: number }>;
  cash: { sessionId: string | null; expectedEfectivo: number | null; expectedNequi: number | null };
};

type Effects = {
  target: {
    type: "sale" | "customer_payment";
    id: string;
    customerId: string | null;
    amount: number;
    method: string | null;
    occurredOn: string;
  };
  cashMoves: Array<{ direction: "out"; kind: "reverso"; method: Method; amount: number; sessionId: string | null }>;
  stockMoves: Array<{ productId: string; delta: number; unitCost: number; reason: "anulacion" }>;
  allocations: Array<{
    kind: ReversalLine["kind"];
    targetType: string;
    saleId: string | null;
    initialDebtId: string | null;
    amount: number;
    originSourceType: string | null;
    originSourceId: string | null;
  }>;
  debtBefore: number | null;
  debtAfter: number | null;
  creditBefore: number | null;
  creditAfter: number | null;
  /** Money released from the target and re-imputed (FIFO / saldo a favor). */
  released: number;
  cashOut: number;
  /** Sale void only: value and margin of what was voided (stats on the reversal day). */
  voidedValue: number;
  voidedMargin: number;
};

type Prepared = {
  targetType: "sale" | "customer_payment";
  targetId: string;
  customerId: string | null;
  lines: ReversalLine[];
  debtDelta: bigint;
  creditDelta: bigint;
  cash: { amount: bigint; method: Method } | null;
  stock: Array<{ productId: string; qty: number; unitCost: bigint }>;
  before: Snapshot;
  after: Snapshot;
  effects: Effects;
  warnings: string[];
  blockers: Blocker[];
  todaySessionId: string | null;
  today: Date;
  oldConfirmed: boolean;
};

function fail(code: ErrorCode, message: string): never {
  throw new AppError(code, message);
}

/** G2 / decision 14 — reasonText only with «otro» (5–280); trimmed. */
export function normalizeReason(dto: Pick<ReverseDto, "reasonCode" | "reasonText">): {
  reasonCode: ReverseDto["reasonCode"];
  reasonText: string | null;
} {
  if (!dto.reasonCode) fail(ERROR_CODES.VALIDATION, MESSAGES.reasonRequired);
  const text = dto.reasonText?.trim() ? dto.reasonText.trim() : null;
  if (text != null && (text.length < 5 || text.length > 280)) fail(ERROR_CODES.VALIDATION, MESSAGES.reasonTextRequired);
  if (dto.reasonCode === "otro" && text == null) fail(ERROR_CODES.VALIDATION, MESSAGES.reasonTextRequired);
  return { reasonCode: dto.reasonCode, reasonText: text };
}

function rowOf(r: {
  id: string;
  sourceType: string;
  sourceId: string;
  originSourceType: string | null;
  originSourceId: string | null;
  targetType: string;
  saleId: string | null;
  initialDebtId: string | null;
  amount: bigint;
  mode: string;
  createdAt: Date;
}): AllocRow {
  return { ...r, createdAt: r.createdAt.getTime() };
}

function n(v: bigint): number {
  return copToJson(v);
}

/**
 * C07 — anulaciones y reversos compensatorios (SPEC-C07 §4–§8). Owner only,
 * online only. Never UPDATE/DELETE of an original row: a reversal writes the
 * `reversals` row first (after the lock), then compensating cash moves,
 * stock moves, debt_allocations rows and the debt / saldo a favor caches.
 */
@Injectable()
export class ReversalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
  ) {}

  voidSale(ctx: BusinessContext, saleId: string, dto: ReverseDto, key: string | undefined, dryRun: boolean) {
    return this.run(ctx, { targetType: "sale", targetId: saleId, dto, key, dryRun }, (tx, forUpdate) =>
      this.prepareSale(tx, ctx, saleId, dto, forUpdate),
    );
  }

  reversePayment(
    ctx: BusinessContext,
    customerId: string,
    paymentId: string,
    dto: ReverseDto,
    key: string | undefined,
    dryRun: boolean,
  ) {
    return this.run(ctx, { targetType: "customer_payment", targetId: paymentId, dto, key, dryRun }, (tx, forUpdate) =>
      this.preparePayment(tx, ctx, customerId, paymentId, dto, forUpdate),
    );
  }

  correctPayment(
    ctx: BusinessContext,
    customerId: string,
    paymentId: string,
    dto: CorrectPaymentDto,
    key: string | undefined,
    dryRun: boolean,
  ) {
    const r = dto.replacement;
    this.cash.assertPaymentInput(r);
    const replacementHash = this.cash.paymentHash(r.customerId, r);
    return this.run(
      ctx,
      {
        targetType: "customer_payment",
        targetId: paymentId,
        dto,
        key,
        dryRun,
        replacement: {
          dto: r,
          ...replacementHash,
          hashFields: {
            customerId: r.customerId,
            amount: String(r.amount),
            method: r.method,
            note: r.note ?? null,
            requestId: r.requestId,
            payment: replacementHash.hash,
          },
        },
      },
      async (tx, forUpdate) => {
        const p = await this.preparePayment(tx, ctx, customerId, paymentId, dto, forUpdate);
        const other = await tx.customer.findFirst({ where: { id: r.customerId, businessId: ctx.businessId }, select: { id: true } });
        if (!other) fail(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
        return p;
      },
    );
  }

  private async run(
    ctx: BusinessContext,
    op: {
      targetType: "sale" | "customer_payment";
      targetId: string;
      dto: ReverseDto;
      key: string | undefined;
      dryRun: boolean;
      replacement?: {
        dto: CorrectPaymentDto["replacement"];
        target: ReturnType<CashService["paymentHash"]>["target"];
        overflow: "fifo" | "credit";
        hash: string;
        hashFields: Record<string, unknown>;
      };
    },
    prepare: (tx: Tx, forUpdate: boolean) => Promise<Prepared>,
  ) {
    const reason = normalizeReason(op.dto);
    if (op.dryRun) {
      // §8 dryRun: same validations, no writes, no sequence, the key is
      // neither read nor registered (T30). Effects = those of the real call.
      const p = await this.prisma.$transaction((tx) => prepare(tx, false));
      return {
        dryRun: true as const,
        targetType: p.targetType,
        targetId: p.targetId,
        reasonCode: reason.reasonCode,
        oldConfirmed: p.oldConfirmed,
        before: p.before,
        after: p.after,
        effects: p.effects,
        warnings: p.warnings,
        blockers: p.blockers,
        ...(op.replacement
          ? {
              replacementPreview: {
                customerId: op.replacement.dto.customerId,
                amount: op.replacement.dto.amount,
                method: op.replacement.dto.method,
              },
            }
          : {}),
      };
    }
    const requestId = resolveIdempotencyKey(op.key, op.dto.requestId);
    if (op.replacement && op.replacement.dto.requestId.toLowerCase() === requestId.toLowerCase()) {
      // Decision 21 — the replacement abono carries a NEW requestId.
      fail(ERROR_CODES.VALIDATION, "El abono nuevo necesita su propio requestId.");
    }
    const hash = payloadHash({
      targetType: op.targetType,
      targetId: op.targetId,
      reasonCode: reason.reasonCode,
      reasonText: reason.reasonText,
      confirmOld: op.dto.confirmOld === true,
      ...(op.replacement ? { replacement: op.replacement.hashFields } : {}),
    });
    const existing = await this.prisma.reversal.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) {
      assertSamePayload(existing.payloadHash, hash);
      return this.respond(ctx.businessId, existing);
    }
    let id: string;
    try {
      id = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
          const again = await tx.reversal.findUnique({
            where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
          });
          if (again) {
            assertSamePayload(again.payloadHash, hash);
            return again.id;
          }
          const p = await prepare(tx, true);
          const blocker = BLOCKER_ORDER.find((b) => p.blockers.includes(b));
          if (blocker) fail(blocker, BLOCKER_MESSAGE[blocker]);
          if (op.replacement) {
            const clash = await tx.customerPayment.findUnique({
              where: { businessId_requestId: { businessId: ctx.businessId, requestId: op.replacement.dto.requestId } },
              select: { id: true },
            });
            if (clash) fail(ERROR_CODES.IDEMPOTENCY_MISMATCH, IDEMPOTENCY_MISMATCH_MESSAGE);
          }
          const now = new Date();
          const reversalId = randomUUID();
          const replacementId = op.replacement ? randomUUID() : null;
          const count = await tx.reversal.count({ where: { businessId: ctx.businessId } });
          const number = `DC-R-${String(count + 1).padStart(6, "0")}`;
          // G5 — the reversals row is the first write after the lock: a retry
          // or a second reversal of the same target hits its unique indexes.
          await tx.reversal.create({
            data: {
              id: reversalId,
              businessId: ctx.businessId,
              number,
              targetType: p.targetType,
              targetId: p.targetId,
              reasonCode: reason.reasonCode,
              reasonText: reason.reasonText,
              oldConfirmed: p.oldConfirmed,
              requestedBy: ctx.userId,
              occurredOn: p.today,
              createdAt: now,
              requestId,
              payloadHash: hash,
              before: p.before as unknown as Prisma.InputJsonValue,
              after: {
                ...p.after,
                effects: p.effects,
                warnings: p.warnings,
                source: op.dto.source ?? "manual",
                ...(op.replacement
                  ? {
                      replacement: {
                        id: replacementId,
                        customerId: op.replacement.dto.customerId,
                        amount: op.replacement.dto.amount,
                        method: op.replacement.dto.method,
                        requestId: op.replacement.dto.requestId,
                      },
                    }
                  : {}),
              } as unknown as Prisma.InputJsonValue,
              replacementId,
            },
          });
          await this.applyEffects(tx, ctx, reversalId, number, p, now);
          if (op.replacement && replacementId) {
            await this.cash.createPaymentInTx(tx, ctx, op.replacement.dto.customerId, {
              id: replacementId,
              dto: op.replacement.dto,
              target: op.replacement.target,
              overflow: op.replacement.overflow,
              hash: op.replacement.hash,
              requestId: op.replacement.dto.requestId,
              now: new Date(now.getTime() + 1),
              occurredAt: now,
              replacesPaymentId: p.targetId,
            });
          }
          return reversalId;
        },
        { timeout: 20000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const byKey = await this.prisma.reversal.findUnique({
          where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
        });
        if (byKey) {
          assertSamePayload(byKey.payloadHash, hash);
          return this.respond(ctx.businessId, byKey);
        }
        fail(ERROR_CODES.ALREADY_REVERSED, MESSAGES.alreadyReversed);
      }
      throw e;
    }
    const row = await this.prisma.reversal.findUniqueOrThrow({ where: { id } });
    return this.respond(ctx.businessId, row);
  }

  private async applyEffects(tx: Tx, ctx: BusinessContext, reversalId: string, number: string, p: Prepared, now: Date) {
    if (p.cash) {
      await tx.cashMove.create({
        data: {
          id: randomUUID(),
          businessId: ctx.businessId,
          amount: p.cash.amount,
          direction: "out",
          method: p.cash.method,
          kind: "reverso",
          // G4 / I-R10 — always today's open caja, never «sin asignar».
          sessionId: p.todaySessionId,
          pendingForSessionId: null,
          refType: "reversal",
          refId: reversalId,
          note: `Reverso ${number}`,
          occurredOn: p.today,
          createdAt: now,
        },
      });
    }
    for (const s of p.stock) {
      await tx.$executeRaw`
        UPDATE products SET stock = stock + ${s.qty}, updated_at = NOW()
        WHERE id = ${s.productId}::uuid AND business_id = ${ctx.businessId}::uuid
      `;
      await tx.stockMove.create({
        data: {
          id: randomUUID(),
          businessId: ctx.businessId,
          productId: s.productId,
          delta: s.qty,
          reason: "anulacion",
          unitCost: s.unitCost,
          refType: "reversal",
          refId: reversalId,
          occurredOn: p.today,
          createdAt: now,
        },
      });
    }
    if (p.customerId && p.lines.length > 0) {
      // debt_allocations stays insert-only: new signed rows, never an update.
      await tx.debtAllocation.createMany({
        data: p.lines.map((l, i) => ({
          id: randomUUID(),
          businessId: ctx.businessId,
          customerId: p.customerId!,
          sourceType: "reversal" as const,
          sourceId: reversalId,
          targetType: l.targetType,
          saleId: l.targetType === "sale" ? l.id : null,
          initialDebtId: l.targetType === "initial_debt" ? l.id : null,
          amount: l.amount,
          mode: "reversal" as const,
          groupId: reversalId,
          createdAt: new Date(now.getTime() + i),
          createdBy: ctx.userId,
          originSourceType: (l.originSourceType ?? null) as Prisma.DebtAllocationCreateManyInput["originSourceType"],
          originSourceId: l.originSourceId,
        })),
      });
    }
    if (p.customerId) {
      await moveCustomerBalances(tx, ctx.businessId, p.customerId, { debt: p.debtDelta, credit: p.creditDelta });
    }
  }

  /** G4 / G4b — today's day, caja and the >30 days confirmation. */
  private async dayAndCaja(
    tx: Tx,
    ctx: BusinessContext,
    args: { originalOccurredOn: Date; cash: { amount: bigint; method: Method } | null; confirmOld: boolean; forUpdate: boolean },
  ) {
    const today = occurredOnDate(ctx.timezone);
    const blockers: Blocker[] = [];
    const warnings: string[] = [];
    const rows = args.forUpdate
      ? ((await tx.$queryRaw`
          SELECT id, closed_at FROM cash_sessions
          WHERE business_id = ${ctx.businessId}::uuid AND local_date = ${today} FOR UPDATE
        `) as Array<{ id: string; closed_at: Date | null }>)
      : ((await tx.$queryRaw`
          SELECT id, closed_at FROM cash_sessions
          WHERE business_id = ${ctx.businessId}::uuid AND local_date = ${today}
        `) as Array<{ id: string; closed_at: Date | null }>);
    const todayRow = rows[0] ?? null;
    if (todayRow?.closed_at) blockers.push("CLOSED_DAY");
    const limit = new Date(today.getTime() - OLD_DAYS * 86_400_000);
    const old = args.originalOccurredOn.getTime() < limit.getTime();
    if (old && !args.confirmOld) blockers.push("CONFIRM_OLD_REQUIRED");
    const openToday = todayRow && !todayRow.closed_at ? todayRow.id : null;
    let cashBefore: Snapshot["cash"] = { sessionId: openToday, expectedEfectivo: null, expectedNequi: null };
    let cashAfter: Snapshot["cash"] = cashBefore;
    if (openToday) {
      const session = await tx.cashSession.findUniqueOrThrow({ where: { id: openToday } });
      const exp = await this.cash.expectedForSession(session, tx as unknown as PrismaService);
      const out = args.cash?.amount ?? 0n;
      const efAfter = args.cash?.method === "Efectivo" ? exp.efectivo - out : exp.efectivo;
      const nqAfter = args.cash?.method === "Nequi" ? exp.nequi - out : exp.nequi;
      cashBefore = { sessionId: openToday, expectedEfectivo: n(exp.efectivo), expectedNequi: n(exp.nequi) };
      cashAfter = { sessionId: openToday, expectedEfectivo: n(efAfter), expectedNequi: n(nqAfter) };
      // Decision 10 — allowed with a warning; the cierre difference shows it.
      if (args.cash?.method === "Efectivo" && efAfter < 0n) warnings.push("EXPECTED_CASH_NEGATIVE");
    }
    if (args.cash && args.cash.amount > 0n && !openToday && !todayRow?.closed_at) blockers.push("CASH_SESSION_REQUIRED");
    return { today, blockers, warnings, todaySessionId: openToday, oldConfirmed: old && args.confirmOld, cashBefore, cashAfter };
  }

  private async assertNotReversed(tx: Tx, businessId: string, targetType: "sale" | "customer_payment", targetId: string) {
    const prior = await tx.reversal.findUnique({
      where: { businessId_targetType_targetId: { businessId, targetType, targetId } },
      select: { id: true },
    });
    if (prior) fail(ERROR_CODES.ALREADY_REVERSED, MESSAGES.alreadyReversed);
  }

  private async customerState(tx: Tx, businessId: string, customerId: string) {
    const [customer, rows, obligations] = await Promise.all([
      tx.customer.findFirstOrThrow({ where: { id: customerId, businessId } }),
      tx.debtAllocation.findMany({ where: { businessId, customerId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      loadObligations(tx, businessId, customerId),
    ]);
    return { customer, rows: rows.map(rowOf), obligations };
  }

  private balances(obligations: Obligation[], lines: ReversalLine[]) {
    const touched = new Set(lines.filter((l) => l.targetType !== "credit").map((l) => `${l.targetType}:${l.id}`));
    const before = obligations
      .filter((o) => touched.has(`${o.kind}:${o.id}`))
      .map((o) => ({ targetType: o.kind as string, id: o.id, open: n(o.open) }));
    const after = before.map((b) => {
      const delta = lines
        .filter((l) => l.targetType === b.targetType && l.id === b.id)
        .reduce((a, l) => a + l.amount, 0n);
      return { ...b, open: n(BigInt(b.open) - delta) };
    });
    return { before, after };
  }

  private allocJson(lines: ReversalLine[]): Effects["allocations"] {
    return lines.map((l) => ({
      kind: l.kind,
      targetType: l.targetType,
      saleId: l.targetType === "sale" ? l.id : null,
      initialDebtId: l.targetType === "initial_debt" ? l.id : null,
      amount: n(l.amount),
      originSourceType: l.originSourceType,
      originSourceId: l.originSourceId,
    }));
  }

  /** §5.1 — void what is left of a sale (I-R11). */
  private async prepareSale(tx: Tx, ctx: BusinessContext, saleId: string, dto: ReverseDto, forUpdate: boolean): Promise<Prepared> {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, businessId: ctx.businessId },
      include: { lines: true, returns: { include: { lines: true } } },
    });
    if (!sale) fail(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    await this.assertNotReversed(tx, ctx.businessId, "sale", saleId);

    const returned = new Map<string, number>();
    let refunded = 0n;
    for (const r of sale.returns) {
      refunded += r.refundAmount;
      for (const rl of r.lines) returned.set(rl.saleLineId, (returned.get(rl.saleLineId) ?? 0) + rl.qty);
    }
    let remainingValue = 0n;
    let voidedMargin = 0n;
    const perProduct = new Map<string, { qty: number; unitCost: bigint }>();
    const stockItems: Prepared["stock"] = [];
    for (const l of sale.lines) {
      const rem = l.qty - (returned.get(l.id) ?? 0);
      if (rem <= 0) continue;
      remainingValue += mulCop(l.unitPrice, rem);
      voidedMargin += mulCop(l.unitPrice - l.unitCost, rem);
      stockItems.push({ productId: l.productId, qty: rem, unitCost: l.unitCost });
      const cur = perProduct.get(l.productId) ?? { qty: 0, unitCost: l.unitCost };
      cur.qty += rem;
      perProduct.set(l.productId, cur);
    }

    const state = sale.customerId ? await this.customerState(tx, ctx.businessId, sale.customerId) : null;
    let plan: ReturnType<typeof planSaleVoid>;
    try {
      plan = planSaleVoid({
        saleId,
        hasCustomer: !!sale.customerId,
        remainingValue,
        cashNet: sale.amountReceived - refunded,
        rows: state?.rows ?? [],
        obligations: state?.obligations ?? [],
        ownReturnIds: new Set(sale.returns.map((r) => r.id)),
      });
    } catch (e) {
      if (e instanceof ReversalPlanError) fail(ERROR_CODES.NOTHING_TO_VOID, e.message);
      throw e;
    }
    const method: Method | null = sale.method === "Nequi" ? "Nequi" : sale.method === "Efectivo" ? "Efectivo" : null;
    const cash = plan.cashOut > 0n ? { amount: plan.cashOut, method: method ?? "Efectivo" } : null;
    const day = await this.dayAndCaja(tx, ctx, {
      originalOccurredOn: sale.occurredOn,
      cash,
      confirmOld: dto.confirmOld === true,
      forUpdate,
    });

    const products = perProduct.size
      ? await tx.product.findMany({ where: { id: { in: [...perProduct.keys()] }, businessId: ctx.businessId }, select: { id: true, stock: true } })
      : [];
    const stockBefore = products.map((p) => ({ productId: p.id, stock: p.stock })).sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const stockAfter = stockBefore.map((s) => ({ productId: s.productId, stock: s.stock + (perProduct.get(s.productId)?.qty ?? 0) }));
    const bal = this.balances(state?.obligations ?? [], plan.lines);
    const c = state?.customer ?? null;
    const before: Snapshot = {
      customerId: sale.customerId,
      debt: c ? n(c.debt) : null,
      creditBalance: c ? n(c.creditBalance) : null,
      openBalances: bal.before,
      stock: stockBefore,
      cash: day.cashBefore,
    };
    const after: Snapshot = {
      customerId: sale.customerId,
      debt: c ? n(c.debt + plan.debtDelta) : null,
      creditBalance: c ? n(c.creditBalance + plan.creditDelta) : null,
      openBalances: bal.after,
      stock: stockAfter,
      cash: day.cashAfter,
    };
    return {
      targetType: "sale",
      targetId: saleId,
      customerId: sale.customerId,
      lines: plan.lines,
      debtDelta: plan.debtDelta,
      creditDelta: plan.creditDelta,
      cash,
      stock: stockItems,
      before,
      after,
      effects: {
        target: {
          type: "sale",
          id: saleId,
          customerId: sale.customerId,
          amount: n(sale.saleTotal),
          method: sale.method,
          occurredOn: dateKey(sale.occurredOn),
        },
        cashMoves: cash ? [{ direction: "out", kind: "reverso", method: cash.method, amount: n(cash.amount), sessionId: day.todaySessionId }] : [],
        stockMoves: stockItems.map((s) => ({ productId: s.productId, delta: s.qty, unitCost: n(s.unitCost), reason: "anulacion" as const })),
        allocations: this.allocJson(plan.lines),
        debtBefore: before.debt,
        debtAfter: after.debt,
        creditBefore: before.creditBalance,
        creditAfter: after.creditBalance,
        released: n(plan.released),
        cashOut: n(plan.cashOut),
        voidedValue: n(remainingValue),
        voidedMargin: n(voidedMargin),
      },
      warnings: day.warnings,
      blockers: day.blockers,
      todaySessionId: day.todaySessionId,
      today: day.today,
      oldConfirmed: day.oldConfirmed,
    };
  }

  /** §5.2 — reverse an abono. */
  private async preparePayment(
    tx: Tx,
    ctx: BusinessContext,
    customerId: string,
    paymentId: string,
    dto: ReverseDto,
    forUpdate: boolean,
  ): Promise<Prepared> {
    const payment = await tx.customerPayment.findFirst({
      where: { id: paymentId, customerId, businessId: ctx.businessId },
    });
    if (!payment) fail(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    await this.assertNotReversed(tx, ctx.businessId, "customer_payment", paymentId);
    const state = await this.customerState(tx, ctx.businessId, customerId);
    let plan: ReturnType<typeof planPaymentReversal>;
    try {
      plan = planPaymentReversal({
        paymentId,
        rows: state.rows,
        obligations: state.obligations,
        creditBalance: state.customer.creditBalance,
      });
    } catch (e) {
      if (e instanceof ReversalPlanError) fail(ERROR_CODES.CREDIT_ALREADY_REFUNDED, e.message);
      throw e;
    }
    const method: Method = payment.method === "Nequi" ? "Nequi" : "Efectivo";
    const cash = { amount: payment.amount, method };
    const day = await this.dayAndCaja(tx, ctx, {
      originalOccurredOn: payment.occurredOn,
      cash,
      confirmOld: dto.confirmOld === true,
      forUpdate,
    });
    const bal = this.balances(state.obligations, plan.lines);
    const c = state.customer;
    const before: Snapshot = {
      customerId,
      debt: n(c.debt),
      creditBalance: n(c.creditBalance),
      openBalances: bal.before,
      stock: [],
      cash: day.cashBefore,
    };
    const after: Snapshot = {
      customerId,
      debt: n(c.debt + plan.debtDelta),
      creditBalance: n(c.creditBalance + plan.creditDelta),
      openBalances: bal.after,
      stock: [],
      cash: day.cashAfter,
    };
    const released = plan.lines.filter((l) => l.amount < 0n && l.kind !== "unapply").reduce((a, l) => a - l.amount, 0n);
    return {
      targetType: "customer_payment",
      targetId: paymentId,
      customerId,
      lines: plan.lines,
      debtDelta: plan.debtDelta,
      creditDelta: plan.creditDelta,
      cash,
      stock: [],
      before,
      after,
      effects: {
        target: {
          type: "customer_payment",
          id: paymentId,
          customerId,
          amount: n(payment.amount),
          method: payment.method,
          occurredOn: dateKey(payment.occurredOn),
        },
        cashMoves: [{ direction: "out", kind: "reverso", method, amount: n(payment.amount), sessionId: day.todaySessionId }],
        stockMoves: [],
        allocations: this.allocJson(plan.lines),
        debtBefore: before.debt,
        debtAfter: after.debt,
        creditBefore: before.creditBalance,
        creditAfter: after.creditBalance,
        released: n(released),
        cashOut: n(payment.amount),
        voidedValue: 0,
        voidedMargin: 0,
      },
      warnings: day.warnings,
      blockers: day.blockers,
      todaySessionId: day.todaySessionId,
      today: day.today,
      oldConfirmed: day.oldConfirmed,
    };
  }

  private summaryJson(r: {
    id: string;
    number: string;
    targetType: string;
    targetId: string;
    reasonCode: string;
    reasonText: string | null;
    oldConfirmed: boolean;
    requestedBy: string;
    occurredOn: Date;
    createdAt: Date;
    replacementId: string | null;
  }) {
    return {
      id: r.id,
      number: r.number,
      targetType: r.targetType,
      targetId: r.targetId,
      reasonCode: r.reasonCode,
      reasonText: r.reasonText,
      oldConfirmed: r.oldConfirmed,
      requestedBy: r.requestedBy,
      occurredOn: dateKey(r.occurredOn),
      createdAt: r.createdAt,
      replacementId: r.replacementId,
    };
  }

  /** 201 body (also the idempotent replay): Reversal + effects + warnings. */
  private async respond(businessId: string, row: Prisma.ReversalGetPayload<object>) {
    const after = (row.after ?? {}) as Record<string, unknown>;
    const { effects, warnings, source, replacement: _replacement, ...afterSnap } = after;
    const replacementPayment = row.replacementId
      ? await this.prisma.customerPayment.findFirst({ where: { id: row.replacementId, businessId } })
      : null;
    return {
      ...this.summaryJson(row),
      source: source ?? "manual",
      before: row.before,
      after: afterSnap,
      effects,
      warnings: warnings ?? [],
      ...(replacementPayment ? { replacementPayment: await this.cash.paymentWithAllocations(replacementPayment) } : {}),
    };
  }

  async list(ctx: BusinessContext, from?: string, to?: string, page: PageQuery = {}) {
    const where: Prisma.ReversalWhereInput = { businessId: ctx.businessId };
    if (from || to) {
      where.occurredOn = {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
      };
    }
    const after = await afterCursor(page.cursor, (id) =>
      this.prisma.reversal.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true, createdAt: true } }),
    );
    const rows = await this.prisma.reversal.findMany({
      where: after ? { AND: [where, after] } : where,
      orderBy: NEWEST_FIRST,
      take: pageProbe(page.limit),
    });
    return paged(rows, page.limit, (r) => {
      const eff = ((r.after as Record<string, unknown>)?.effects ?? {}) as Partial<Effects>;
      return { ...this.summaryJson(r), amount: eff.target?.amount ?? null, cashOut: eff.cashOut ?? 0, method: eff.target?.method ?? null };
    });
  }

  /** §6 — data of the reversal voucher (template in C09). */
  async get(ctx: BusinessContext, id: string) {
    const r = await this.prisma.reversal.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!r) fail(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const body = await this.respond(ctx.businessId, r);
    const eff = (body.effects ?? {}) as Partial<Effects>;
    const voucher = {
      kind: "reversal" as const,
      number: r.number,
      original: { type: r.targetType, id: r.targetId, amount: eff.target?.amount ?? null, method: eff.target?.method ?? null, occurredOn: eff.target?.occurredOn ?? null },
      createdAt: r.createdAt,
      occurredOn: dateKey(r.occurredOn),
      requestedBy: r.requestedBy,
      reasonCode: r.reasonCode,
      reasonText: r.reasonText,
      cashOut: eff.cashOut ?? 0,
      method: eff.cashMoves?.[0]?.method ?? null,
      cashSessionId: eff.cashMoves?.[0]?.sessionId ?? null,
      debtBefore: eff.debtBefore ?? null,
      debtAfter: eff.debtAfter ?? null,
      creditBefore: eff.creditBefore ?? null,
      creditAfter: eff.creditAfter ?? null,
      allocations: eff.allocations ?? [],
      stock: eff.stockMoves ?? [],
    };
    const contentHash = createHash("sha256").update(JSON.stringify(voucher)).digest("hex");
    return { ...body, voucher: { ...voucher, contentHash } };
  }
}
