import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Prisma, ReversalTarget } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { BusinessContext } from "../identity/auth.types";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { isoInZone } from "../shared/canonical";
import type { CustomerAuth } from "../identity/auth.types";
import { ackStates, type AckState } from "./receipt-acks";

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

  private summary(r: Row, status: ReceiptStatus, ackState: AckState = "pending") {
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
      ackState,
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
    const acks = await ackStates(this.prisma, ctx.businessId, rows.map((r) => r.id));
    return rows.map((r) => this.summary(r, st.get(r.id)!, acks.get(r.id)));
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
    const acks = await this.prisma.receiptAcknowledgement.findMany({
      where: { businessId: ctx.businessId, receiptId: r.id },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });
    const ackState = (await ackStates(this.prisma, ctx.businessId, [r.id])).get(r.id);
    return {
      ...this.summary(r, st.get(r.id)!, ackState),
      related,
      // C09-PR4 — the customer's confirmations (owner: recibido/confirmado/reportado).
      acks: acks.map((a) => ({ id: a.id, kind: a.kind, receiptHash: a.receiptHash, note: a.note, channel: a.channel, claimId: a.claimId, at: a.at })),
      prevReceiptId: r.prevReceiptId,
      snapshot: r.snapshot,
      contentHash: r.contentHash,
    };
  }

  // ---- C09-PR4 — portal (customer token: business + customer from the token) ----

  /** The customer's own receipts only; internal receipts (no customer) never match (T5/T11). */
  private portalWhere(auth: CustomerAuth) {
    return { businessId: auth.businessId, customerId: auth.customerId };
  }

  private portalSummary(r: Row, status: ReceiptStatus, ackState: AckState) {
    return {
      id: r.id,
      kind: r.kind,
      number: r.number,
      status,
      ackState,
      verifyCode: r.verifyCode,
      hashPrefix: r.contentHash.slice(0, 8),
      // T27 — exact date and time, portal zone (decision J-B1: Bogota).
      issuedAt: isoInZone(r.createdAt, "America/Bogota"),
    };
  }

  async portalList(auth: CustomerAuth) {
    const rows = await this.prisma.receipt.findMany({
      where: this.portalWhere(auth),
      orderBy: [{ createdAt: "desc" }, { number: "desc" }],
      take: 200,
    });
    const st = await this.statuses(auth.businessId, rows);
    const acks = await ackStates(this.prisma, auth.businessId, rows.map((r) => r.id));
    return rows.map((r) => this.portalSummary(r, st.get(r.id)!, acks.get(r.id)!));
  }

  private async portalFind(auth: CustomerAuth, id: string) {
    const r = await this.prisma.receipt.findFirst({ where: { id, ...this.portalWhere(auth) } });
    if (!r) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    return r;
  }

  async portalGet(auth: CustomerAuth, id: string) {
    const r = await this.portalFind(auth, id);
    const st = await this.statuses(auth.businessId, [r]);
    const related = await this.prisma.receipt.findMany({
      where: { ...this.portalWhere(auth), sourceId: r.sourceId, id: { not: r.id } },
      orderBy: [{ number: "asc" }],
      select: { id: true, kind: true, number: true },
    });
    const acks = await this.prisma.receiptAcknowledgement.findMany({
      where: { businessId: auth.businessId, customerId: auth.customerId, receiptId: r.id },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });
    const ackState = (await ackStates(this.prisma, auth.businessId, [r.id])).get(r.id)!;
    return {
      ...this.portalSummary(r, st.get(r.id)!, ackState),
      snapshot: r.snapshot,
      contentHash: r.contentHash,
      related,
      acks: acks.map((a) => ({ kind: a.kind, receiptHash: a.receiptHash, note: a.note, at: a.at })),
    };
  }

  /**
   * §3.3 / §5 — «Reconozco esto» / «Hay un error». Evidence only (I-C5):
   * one insert, no balance, caja or stock write. The hash must be the one
   * of the receipt (T15). «Reconozco esto» is idempotent per receipt and
   * hash. «Hay un error» needs a note; the C08 claim (claimId) is linked
   * once C08-PR3 exists.
   */
  async portalAck(
    auth: CustomerAuth,
    id: string,
    dto: { kind: "acknowledged" | "reported_issue"; receiptHash: string; note?: string },
  ): Promise<{ created: boolean; body: Record<string, unknown> }> {
    const r = await this.portalFind(auth, id);
    if (dto.receiptHash !== r.contentHash) {
      throw new AppError(ERROR_CODES.RECEIPT_HASH_MISMATCH, "Este comprobante cambió. Vuelve a abrirlo antes de confirmar.");
    }
    const note = dto.note?.trim() ? dto.note.trim() : null;
    if (dto.kind === "reported_issue" && (note == null || note.length < 5)) {
      throw new AppError(ERROR_CODES.VALIDATION, "Cuéntanos qué está mal (mínimo 5 caracteres).");
    }
    const json = (a: Prisma.ReceiptAcknowledgementGetPayload<object>) => ({
      id: a.id,
      receiptId: a.receiptId,
      kind: a.kind,
      receiptHash: a.receiptHash,
      channel: a.channel,
      note: a.note,
      claimId: a.claimId,
      at: a.at,
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${r.id}))`;
      if (dto.kind === "acknowledged") {
        const existing = await tx.receiptAcknowledgement.findFirst({
          where: { businessId: auth.businessId, customerId: auth.customerId, receiptId: r.id, kind: "acknowledged", receiptHash: r.contentHash },
          orderBy: [{ at: "asc" }, { id: "asc" }],
        });
        if (existing) return { created: false, body: json(existing) };
      }
      const created = await tx.receiptAcknowledgement.create({
        data: {
          id: randomUUID(),
          businessId: auth.businessId,
          customerId: auth.customerId,
          receiptId: r.id,
          receiptHash: r.contentHash,
          kind: dto.kind,
          channel: "portal",
          note,
        },
      });
      return { created: true, body: json(created) };
    });
  }
}
