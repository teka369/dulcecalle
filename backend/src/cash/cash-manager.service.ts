import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { asCop, copToJson, subCop } from "../shared/money";
import { dateKey, occurredOnDate } from "../shared/clock";
import type { BusinessContext } from "../identity/auth.types";
import { ASSUMED_CLOSE_NOTE } from "./session-link";
import { carryModeAllowed, sessionExpected } from "./carry-rules";
import { CashService } from "./cash.service";

const ASSUMED_NOTE = ASSUMED_CLOSE_NOTE;

function ageDays(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

@Injectable()
export class CashManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
  ) {}

  async list(ctx: BusinessContext, status?: string) {
    const where: Prisma.CashSessionWhereInput = { businessId: ctx.businessId };
    if (status === "open") where.closedAt = null;
    if (status === "closed") where.closedAt = { not: null };
    const sessions = await this.prisma.cashSession.findMany({
      where,
      orderBy: { localDate: "desc" },
    });
    return Promise.all(sessions.map((session) => this.summary(ctx, session)));
  }

  async detail(ctx: BusinessContext, id: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: { id, businessId: ctx.businessId },
    });
    if (!session) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const summary = await this.summary(ctx, session);
    const moves = await this.prisma.cashMove.findMany({
      where: { businessId: ctx.businessId, sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    const stamped = await this.prisma.cashMove.findMany({
      where: {
        businessId: ctx.businessId,
        sessionId: null,
        pendingForSessionId: session.id,
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      ...summary,
      moves: moves.map(moveJson),
      stampedMoves: stamped.map(moveJson),
    };
  }

  async unassigned(ctx: BusinessContext) {
    const moves = await this.prisma.cashMove.findMany({
      where: {
        businessId: ctx.businessId,
        sessionId: null,
        pendingForSessionId: null,
      },
      orderBy: { createdAt: "desc" },
    });
    return moves.map(moveJson);
  }

  async assign(ctx: BusinessContext, moveId: string, sessionId: string, requestId: string) {
    const existing = await this.prisma.cashCarry.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return this.carryResult(ctx, existing);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
      const again = await tx.cashCarry.findUnique({
        where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
      });
      if (again) return this.carryResult(ctx, again);
      const session = await tx.cashSession.findFirst({
        where: { id: sessionId, businessId: ctx.businessId, closedAt: null },
      });
      if (!session) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
      const move = await tx.cashMove.findFirst({
        where: {
          id: moveId,
          businessId: ctx.businessId,
          sessionId: null,
          pendingForSessionId: null,
        },
      });
      if (!move) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
      await tx.cashMove.update({
        where: { id: move.id },
        data: { sessionId: session.id, pendingForSessionId: null },
      });
      const row = await tx.cashCarry.create({
        data: {
          id: randomUUID(),
          businessId: ctx.businessId,
          requestId,
          previousSessionId: null,
          currentSessionId: session.id,
          mode: "assign",
          countedEfectivo: null,
          openingFloat: session.openingFloat,
          reassignedCount: 1,
          reassignedIds: [move.id],
        },
      });
      return this.carryResult(ctx, row);
    });
  }

  async carry(
    ctx: BusinessContext,
    sessionId: string,
    mode: "counted" | "assumed",
    countedEfectivo: number | undefined,
    requestId: string,
  ) {
    const existing = await this.prisma.cashCarry.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (existing) return this.carryResult(ctx, existing);
    const today = occurredOnDate(ctx.timezone);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
      const again = await tx.cashCarry.findUnique({
        where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
      });
      if (again) return this.carryResult(ctx, again);
      const previous = await tx.cashSession.findFirst({
        where: { id: sessionId, businessId: ctx.businessId },
      });
      if (!previous) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
      if (previous.closedAt) {
        const done = await tx.cashCarry.findFirst({
          where: { businessId: ctx.businessId, previousSessionId: previous.id },
          orderBy: { createdAt: "desc" },
        });
        if (done) return this.carryResult(ctx, done);
        throw new AppError(ERROR_CODES.ALREADY_CARRIED, MESSAGES.alreadyCarried);
      }
      const todaySession = await tx.cashSession.findUnique({
        where: {
          businessId_localDate: { businessId: ctx.businessId, localDate: today },
        },
      });
      const stamped = await tx.cashMove.findMany({
        where: {
          businessId: ctx.businessId,
          sessionId: null,
          pendingForSessionId: previous.id,
          occurredOn: { gt: previous.localDate, lte: today },
        },
      });
      const allowed = carryModeAllowed(mode, stamped.length);
      if (!allowed.ok) {
        throw new AppError(ERROR_CODES.ASSUMED_REQUIRED, MESSAGES.assumedRequired);
      }
      const ownedMoves = await tx.cashMove.findMany({
        where: { businessId: ctx.businessId, sessionId: previous.id },
      });
      const owned = sessionExpected({
        sessionId: previous.id,
        openingFloat: previous.openingFloat,
        carriedEfectivo: previous.carriedEfectivo,
        moves: ownedMoves,
      });
      const pending = sessionExpected({
        sessionId: previous.id,
        openingFloat: 0n,
        carriedEfectivo: 0n,
        moves: stamped.map((move) => ({ ...move, sessionId: null, pendingForSessionId: previous.id })),
      });
      const expected = {
        efectivo: owned.efectivo + pending.efectivo,
        nequi: owned.nequi + pending.nequi,
      };
      const counted = mode === "counted" ? asCop(countedEfectivo ?? 0) : expected.efectivo;
      if (mode === "counted" && counted < 0n) {
        throw new AppError(ERROR_CODES.VALIDATION, "Revisa el monto contado.");
      }
      const opens = await tx.cashSession.findMany({
        where: { businessId: ctx.businessId, closedAt: null, id: { not: previous.id } },
        orderBy: { localDate: "asc" },
      });
      const destination = opens[0] ?? null;
      if (!destination && todaySession?.closedAt) {
        throw new AppError(ERROR_CODES.TODAY_ALREADY_CLOSED, MESSAGES.todayAlreadyClosed);
      }
      await tx.cashSession.update({
        where: { id: previous.id },
        data: {
          closedAt: new Date(),
          closeMode: mode,
          closingCount: counted,
          expectedEfectivo: expected.efectivo,
          expectedNequi: expected.nequi,
          difference: mode === "assumed" ? 0n : subCop(counted, expected.efectivo),
          note: mode === "assumed" ? ASSUMED_NOTE : previous.note,
        },
      });
      let current = destination;
      if (!current) {
        const float = mode === "counted" ? counted : owned.efectivo;
        current = await tx.cashSession.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            localDate: today,
            openedAt: new Date(),
            closedAt: null,
            openingFloat: float,
            carriedEfectivo: 0n,
            closeMode: null,
          },
        });
      } else {
        const continuity = mode === "counted" ? counted : owned.efectivo;
        await tx.cashSession.update({
          where: { id: current.id },
          data: { carriedEfectivo: current.carriedEfectivo + continuity },
        });
        current = { ...current, carriedEfectivo: current.carriedEfectivo + continuity };
      }
      if (stamped.length) {
        await tx.cashMove.updateMany({
          where: { id: { in: stamped.map((move) => move.id) } },
          data: { sessionId: current.id, pendingForSessionId: null },
        });
      }
      const row = await tx.cashCarry.create({
        data: {
          id: randomUUID(),
          businessId: ctx.businessId,
          requestId,
          previousSessionId: previous.id,
          currentSessionId: current.id,
          mode,
          countedEfectivo: mode === "counted" ? counted : null,
          openingFloat: current.openingFloat,
          reassignedCount: stamped.length,
          reassignedIds: stamped.map((move) => move.id),
        },
      });
      return this.carryResult(ctx, row);
    });
  }

  private async summary(
    ctx: BusinessContext,
    session: {
      id: string;
      businessId: string;
      localDate: Date;
      openedAt: Date;
      closedAt: Date | null;
      openingFloat: bigint;
      closingCount: bigint | null;
      expectedEfectivo: bigint | null;
      expectedNequi: bigint | null;
      difference: bigint | null;
      closeMode: string | null;
      note: string | null;
    },
  ) {
    const today = occurredOnDate(ctx.timezone);
    const expected = session.closedAt
      ? {
          efectivo: session.expectedEfectivo ?? 0n,
          nequi: session.expectedNequi ?? 0n,
        }
      : await this.cash.expectedForSession({ ...session, businessId: ctx.businessId });
    const moveCount = await this.prisma.cashMove.count({
      where: { businessId: ctx.businessId, sessionId: session.id },
    });
    const last = await this.prisma.cashMove.findFirst({
      where: { businessId: ctx.businessId, sessionId: session.id },
      orderBy: { createdAt: "desc" },
    });
    const stamped = await this.prisma.cashMove.count({
      where: {
        businessId: ctx.businessId,
        sessionId: null,
        pendingForSessionId: session.id,
      },
    });
    const laterOpen = await this.prisma.cashSession.count({
      where: {
        businessId: ctx.businessId,
        closedAt: null,
        localDate: { gt: session.localDate },
      },
    });
    return {
      id: session.id,
      localDate: dateKey(session.localDate),
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openingFloat: copToJson(session.openingFloat),
      expectedEfectivo: copToJson(expected.efectivo),
      expectedNequi: copToJson(expected.nequi),
      closingCount: session.closingCount == null ? null : copToJson(session.closingCount),
      difference: session.difference == null ? null : copToJson(session.difference),
      closeMode: session.closeMode,
      note: session.note,
      moveCount,
      lastMoveAt: last?.createdAt ?? null,
      laterActivity: stamped > 0,
      ageDays: ageDays(session.localDate, today),
      canCountClose: session.closedAt == null && stamped === 0,
      requiresCarry: session.closedAt == null && stamped > 0,
      hasLaterOpenSession: laterOpen > 0,
      regularized: session.closedAt != null,
    };
  }

  private async carryResult(
    ctx: BusinessContext,
    row: {
      previousSessionId: string | null;
      currentSessionId: string;
      reassignedIds: string[];
      mode: string;
    },
  ) {
    const current = await this.prisma.cashSession.findFirst({
      where: { id: row.currentSessionId, businessId: ctx.businessId },
    });
    const previous = row.previousSessionId
      ? await this.prisma.cashSession.findFirst({
          where: { id: row.previousSessionId, businessId: ctx.businessId },
        })
      : null;
    return {
      mode: row.mode,
      previous: previous ? sessionBrief(previous) : null,
      current: current ? sessionBrief(current) : null,
      reassignedMoveIds: row.reassignedIds,
    };
  }
}

function sessionBrief(session: {
  id: string;
  localDate: Date;
  openedAt: Date;
  closedAt: Date | null;
  openingFloat: bigint;
  closeMode: string | null;
  note: string | null;
  closingCount: bigint | null;
  difference: bigint | null;
}) {
  return {
    id: session.id,
    localDate: dateKey(session.localDate),
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    openingFloat: copToJson(session.openingFloat),
    closeMode: session.closeMode,
    note: session.note,
    closingCount: session.closingCount == null ? null : copToJson(session.closingCount),
    difference: session.difference == null ? null : copToJson(session.difference),
  };
}

function moveJson(move: {
  id: string;
  amount: bigint;
  direction: string;
  method: string;
  kind: string;
  sessionId: string | null;
  pendingForSessionId: string | null;
  occurredOn: Date;
  createdAt: Date;
  note: string | null;
}) {
  return {
    id: move.id,
    amount: copToJson(move.amount),
    direction: move.direction,
    method: move.method,
    kind: move.kind,
    sessionId: move.sessionId,
    pendingForSessionId: move.pendingForSessionId,
    occurredOn: dateKey(move.occurredOn),
    createdAt: move.createdAt,
    note: move.note,
  };
}
