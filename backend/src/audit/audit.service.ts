import { Injectable } from "@nestjs/common";
import { Prisma, type ClientOpEvent } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { BusinessContext } from "../identity/auth.types";
import { copToJson } from "../shared/money";
import type { ClientOpEventDto } from "./audit.dto";

function eventJson(e: ClientOpEvent) {
  return {
    id: e.id,
    operationId: e.operationId,
    requestId: e.requestId,
    entity: e.entity,
    operation: e.operation,
    kind: e.kind,
    amount: e.amount == null ? null : copToJson(e.amount),
    customerId: e.customerId,
    rejectionCode: e.rejectionCode,
    lastError: e.lastError,
    replacedBy: e.replacedBy,
    deviceCreatedAt: e.deviceCreatedAt,
    createdAt: e.createdAt,
  };
}

/**
 * C01.1 / C01-INV-04 — append-only server trace of client rejections and
 * discards. Idempotent per (business, operationId, kind): a replay returns
 * the first row unchanged. Scoped to the caller's business.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(ctx: BusinessContext, dto: ClientOpEventDto) {
    const key = {
      businessId_operationId_kind: {
        businessId: ctx.businessId,
        operationId: dto.operationId,
        kind: dto.kind,
      },
    };
    const existing = await this.prisma.clientOpEvent.findUnique({ where: key });
    if (existing) return eventJson(existing);
    try {
      const row = await this.prisma.clientOpEvent.create({
        data: {
          id: randomUUID(),
          businessId: ctx.businessId,
          operationId: dto.operationId,
          requestId: dto.requestId ?? null,
          entity: dto.entity,
          operation: dto.operation,
          kind: dto.kind,
          amount: dto.amount == null ? null : BigInt(dto.amount),
          customerId: dto.customerId ?? null,
          rejectionCode: dto.rejectionCode ?? null,
          lastError: dto.lastError ?? null,
          replacedBy: dto.replacedBy ?? null,
          deviceCreatedAt: dto.deviceCreatedAt ? new Date(dto.deviceCreatedAt) : null,
          createdById: ctx.userId,
        },
      });
      return eventJson(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.clientOpEvent.findUnique({ where: key });
        if (again) return eventJson(again);
      }
      throw e;
    }
  }

  async list(ctx: BusinessContext, limit = 100) {
    const rows = await this.prisma.clientOpEvent.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map(eventJson);
  }
}
