import { Injectable } from "@nestjs/common";
import type { Prisma, ReversalTarget } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { BusinessContext } from "../identity/auth.types";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { isoInZone } from "../shared/canonical";

export const RECEIPT_KINDS = ["sale", "payment", "allocation", "reversal", "adjustment", "return"] as const;
export type ReceiptStatus = "vigente" | "reemplazado" | "anulado";

/** Reversal target type of a receipt source (C07); returns are not reversible. */
const REVERSAL_TARGET: Record<string, ReversalTarget | undefined> = {
  sale: "sale",
  customer_payment: "customer_payment",
};

/** Instant where `day` (YYYY-MM-DD) starts in `timeZone`. */
function dayStart(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00.000Z`);
  const iso = isoInZone(guess, timeZone);
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso)!;
  const offsetMin = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  return new Date(guess.getTime() - offsetMin * 60000);
}

type Row = Prisma.ReceiptGetPayload<object>;

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** C09 §3.2 — status is derived, the receipt row never changes. */
  private async statuses(businessId: string, rows: Row[]): Promise<Map<string, ReceiptStatus>> {
    const ids = rows.map((r) => r.id);
    const replaced = new Set(
      (
        await this.prisma.receipt.findMany({
          where: { businessId, prevReceiptId: { in: ids } },
          select: { prevReceiptId: true },
        })
      ).map((r) => r.prevReceiptId!),
    );
    // An allocation annex shares its source id with the abono/sale it
    // distributes, so it reads «anulado» when that source is reversed.
    const reversible = rows.filter((r) => REVERSAL_TARGET[r.sourceType] || r.sourceType === "allocation");
    const reversed = new Set(
      reversible.length === 0
        ? []
        : (
            await this.prisma.reversal.findMany({
              where: {
                businessId,
                OR: reversible.map((r) =>
                  r.sourceType === "allocation"
                    ? { targetId: r.sourceId, targetType: { in: ["sale", "customer_payment"] as ReversalTarget[] } }
                    : { targetType: REVERSAL_TARGET[r.sourceType]!, targetId: r.sourceId },
                ),
              },
              select: { targetType: true, targetId: true },
            })
          ).flatMap((x) => [`${x.targetType}:${x.targetId}`, `allocation:${x.targetId}`]),
    );
    const out = new Map<string, ReceiptStatus>();
    for (const r of rows) {
      const st: ReceiptStatus = replaced.has(r.id)
        ? "reemplazado"
        : reversed.has(r.sourceType === "allocation" ? `allocation:${r.sourceId}` : `${REVERSAL_TARGET[r.sourceType]}:${r.sourceId}`)
          ? "anulado"
          : "vigente";
      out.set(r.id, st);
    }
    return out;
  }

  private summary(r: Row, status: ReceiptStatus) {
    return {
      id: r.id,
      kind: r.kind,
      number: r.number,
      customerId: r.customerId,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      verifyCode: r.verifyCode,
      hashPrefix: r.contentHash.slice(0, 8),
      status,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(
    ctx: BusinessContext,
    q: { customerId?: string; kind?: string; from?: string; to?: string; limit?: number },
  ) {
    if (q.kind !== undefined && !(RECEIPT_KINDS as readonly string[]).includes(q.kind)) {
      throw new AppError(ERROR_CODES.VALIDATION, "Parámetro kind inválido.");
    }
    const tz = ctx.timezone ?? "America/Bogota";
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = dayStart(q.from, tz);
    if (q.to) {
      const next = new Date(`${q.to}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      createdAt.lt = dayStart(next.toISOString().slice(0, 10), tz);
    }
    const rows = await this.prisma.receipt.findMany({
      where: {
        businessId: ctx.businessId,
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.kind ? { kind: q.kind as (typeof RECEIPT_KINDS)[number] } : {}),
        ...(q.from || q.to ? { createdAt } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit ?? 100,
    });
    const st = await this.statuses(ctx.businessId, rows);
    return rows.map((r) => this.summary(r, st.get(r.id)!));
  }

  async get(ctx: BusinessContext, id: string) {
    const r = await this.prisma.receipt.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!r) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const st = await this.statuses(ctx.businessId, [r]);
    // C09-PR3 — receipts of the same operation (payment ↔ its allocation
    // annex, reversal ↔ its annex), derived from the shared source id.
    const related = await this.prisma.receipt.findMany({
      where: { businessId: ctx.businessId, sourceId: r.sourceId, id: { not: r.id } },
      orderBy: [{ number: "asc" }],
      select: { id: true, kind: true, number: true },
    });
    return {
      ...this.summary(r, st.get(r.id)!),
      related,
      prevReceiptId: r.prevReceiptId,
      snapshot: r.snapshot,
      contentHash: r.contentHash,
    };
  }
}
