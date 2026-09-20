import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { addCop, asCop, copToJson, subCop } from "../shared/money";
import { dateKey, occurredOnDate } from "../shared/clock";
import { assertDayEditable, lockAndAssertDayEditable } from "../shared/day-guard";
import type { BusinessContext } from "../identity/auth.types";
import type { CreatePaymentDto } from "../sales/sales.dto";
import type { CashOwnerMoveDto, CreateExpenseDto } from "./cash.dto";

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
}) {
  return {
    id: s.id,
    localDate: dateKey(s.localDate),
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
    let efectivo = session ? asCop(session.openingFloat) : 0n;
    let nequi = 0n;
    const moves = await db.cashMove.findMany({
      where: { businessId, occurredOn: localDate },
    });
    for (const m of moves) {
      const delta = m.direction === "in" ? m.amount : -m.amount;
      if (m.method === "Efectivo") efectivo = addCop(efectivo, delta);
      else if (m.method === "Nequi") nequi = addCop(nequi, delta);
    }
    return { efectivo, nequi, total: addCop(efectivo, nequi) };
  }

  async open(ctx: BusinessContext, openingFloat: number, requestId: string = randomUUID()) {
    const float = asCop(openingFloat);
    if (float < 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "El monto no puede ser negativo.");
    }
    const localDate = occurredOnDate(ctx.timezone);
    const existingByRequest = await this.prisma.cashSession.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existingByRequest) return sessionJson(existingByRequest);
    const existing = await this.prisma.cashSession.findUnique({
      where: { businessId_localDate: { businessId: ctx.businessId, localDate } },
    });
    if (existing) {
      return sessionJson(existing);
    }
    try {
      const created = await this.prisma.cashSession.create({
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
        const again = await this.prisma.cashSession.findUnique({
          where: {
            businessId_localDate: { businessId: ctx.businessId, localDate },
          },
        });
        if (again) return sessionJson(again);
      }
      throw e;
    }
  }

  async close(ctx: BusinessContext, sessionId: string, countedEfectivo: number, requestId: string = randomUUID()) {
    const existingByRequest = await this.prisma.cashSession.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
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
          closingCount: counted,
          expectedEfectivo: expected.efectivo,
          expectedNequi: expected.nequi,
          difference,
          requestId,
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
    return {
      localDate: dateKey(localDate),
      session: session ? sessionJson(session) : null,
      expected: {
        efectivo: copToJson(expected.efectivo),
        nequi: copToJson(expected.nequi),
        total: copToJson(expected.total),
      },
      closed: session?.closedAt != null,
      moves: moves.map((m) => ({
        id: m.id,
        amount: copToJson(m.amount),
        direction: m.direction,
        method: m.method,
        kind: m.kind,
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

  async listExpenses(ctx: BusinessContext, from?: string, to?: string) {
    const where: Prisma.ExpenseWhereInput = { businessId: ctx.businessId };
    if (from || to) {
      where.occurredOn = {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
      };
    }
    const rows = await this.prisma.expense.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(expenseJson);
  }

  async recordPayment(
    ctx: BusinessContext,
    customerId: string,
    dto: CreatePaymentDto,
    requestId: string,
  ) {
    const existing = await this.prisma.customerPayment.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) {
      return {
        id: existing.id,
        customerId: existing.customerId,
        amount: copToJson(existing.amount),
        method: existing.method,
        note: existing.note,
        occurredOn: dateKey(existing.occurredOn),
        createdAt: existing.createdAt,
      };
    }

    const amount = asCop(dto.amount);
    if (amount <= 0n) {
      throw new AppError(ERROR_CODES.VALIDATION, "El abono tiene que ser mayor a 0.");
    }
    if (dto.method !== "Efectivo" && dto.method !== "Nequi") {
      throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.noMethod);
    }

    const now = new Date();
    const occurredOn = occurredOnDate(ctx.timezone, now);
    await assertDayEditable(this.prisma, ctx.businessId, occurredOn);

    try {
      const pay = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertDayEditable(tx, ctx.businessId, occurredOn);
        const customer = await tx.customer.findFirst({
          where: { id: customerId, businessId: ctx.businessId },
        });
        if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
        const id = randomUUID();
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
            createdAt: now,
          },
        });
        const decremented = await tx.$executeRaw`
          UPDATE customers
          SET debt = debt - ${amount},
              updated_at = NOW()
          WHERE id = ${customerId}::uuid
            AND business_id = ${ctx.businessId}::uuid
            AND debt >= ${amount}
        `;
        if (Number(decremented) !== 1) {
          throw new AppError(
            ERROR_CODES.ABONO_EXCEEDS_DEBT,
            MESSAGES.abonoExceeds,
          );
        }
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
            amount,
            direction: "in",
            method: dto.method,
            kind: "debt_collect",
            sessionId: open?.id ?? null,
            refType: "payment",
            refId: id,
            requestId,
            occurredOn,
            createdAt: now,
          },
        });
        return payment;
      });
      return {
        id: pay.id,
        customerId: pay.customerId,
        amount: copToJson(pay.amount),
        method: pay.method,
        note: pay.note,
        occurredOn: dateKey(pay.occurredOn),
        createdAt: pay.createdAt,
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.customerPayment.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId },
          },
        });
        if (again) {
          return {
            id: again.id,
            customerId: again.customerId,
            amount: copToJson(again.amount),
            method: again.method,
            note: again.note,
            occurredOn: dateKey(again.occurredOn),
            createdAt: again.createdAt,
          };
        }
      }
      throw e;
    }
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
        const open = await tx.cashSession.findFirst({
          where: {
            businessId: ctx.businessId,
            localDate: occurredOn,
            closedAt: null,
          },
        });
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
            sessionId: open?.id ?? null,
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
        const open = await tx.cashSession.findFirst({
          where: {
            businessId: ctx.businessId,
            localDate: occurredOn,
            closedAt: null,
          },
        });
        return tx.cashMove.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            amount,
            direction,
            method: dto.method,
            kind,
            sessionId: open?.id ?? null,
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
