import { Injectable } from "@nestjs/common";
import { Prisma, type ReceiptLink } from "@prisma/client";
import { createHash, createHmac, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { BusinessContext } from "../identity/auth.types";
import { requireJwtSecrets } from "../identity/jwt-secrets";
import { PROD_ORIGIN } from "../http-setup";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { assertSamePayload, payloadHash } from "../shared/payload-hash";

/** SPEC-C09 §3.4: a link lives 48 h from its creation. */
export const LINK_TTL_MS = 48 * 60 * 60 * 1000;
export const LINK_PATH = "/cliente/comprobante/";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** WIRES W3 copy. */
export const LINK_GONE = {
  expired: "Este enlace venció. Pide uno nuevo a la tienda.",
  used: "Este enlace ya se usó. Entra con tu PIN en Mis compras.",
  revoked: "La tienda desactivó este enlace.",
} as const;

export type LinkState = "active" | "used" | "expired" | "revoked";

export function linkState(l: Pick<ReceiptLink, "usedAt" | "revokedAt" | "expiresAt">, now = new Date()): LinkState {
  if (l.revokedAt) return "revoked";
  if (l.usedAt) return "used";
  if (l.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The token is 32 bytes (base64url, 43 chars) derived with HMAC-SHA256 from
 * a server secret and the link id, so an Idempotency-Key replay can return
 * the SAME url while the database keeps only sha256(token). Without the
 * server secret the token is as unguessable as 32 random bytes.
 */
function linkToken(linkId: string): string {
  const secret = process.env.RECEIPT_LINK_SECRET?.trim() || requireJwtSecrets().access;
  return createHmac("sha256", secret).update(`dulcecalle:receipt-link:v1:${linkId}`).digest("base64url");
}

function portalOrigin(): string {
  return (process.env.PORTAL_ORIGIN?.trim() || PROD_ORIGIN).replace(/\/+$/, "");
}

@Injectable()
export class ReceiptLinksService {
  constructor(private readonly prisma: PrismaService) {}

  private view(l: ReceiptLink) {
    const path = `${LINK_PATH}${linkToken(l.id)}`;
    return { id: l.id, url: `${portalOrigin()}${path}`, path, expiresAt: l.expiresAt.toISOString() };
  }

  /** POST /v1/receipts/:id/links (owner/staff). Internal receipts cannot be shared (T5). */
  async create(ctx: BusinessContext, receiptId: string, requestId: string) {
    const hash = payloadHash({ receiptId });
    const prior = await this.prisma.receiptLink.findUnique({
      where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
    });
    if (prior) {
      assertSamePayload(prior.payloadHash, hash);
      return this.view(prior);
    }
    const receipt = await this.prisma.receipt.findFirst({
      where: { id: receiptId, businessId: ctx.businessId },
      select: { id: true, customerId: true },
    });
    if (!receipt) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    if (!receipt.customerId) {
      throw new AppError(ERROR_CODES.RECEIPT_NOT_SHAREABLE, "Este comprobante es interno: no se comparte por enlace.");
    }
    const id = randomUUID();
    const now = new Date();
    try {
      const row = await this.prisma.receiptLink.create({
        data: {
          id,
          businessId: ctx.businessId,
          receiptId,
          tokenHash: tokenHash(linkToken(id)),
          createdAt: now,
          expiresAt: new Date(now.getTime() + LINK_TTL_MS),
          createdBy: ctx.userId,
          requestId,
          payloadHash: hash,
        },
      });
      return this.view(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const raced = await this.prisma.receiptLink.findUnique({
          where: { businessId_requestId: { businessId: ctx.businessId, requestId } },
        });
        if (raced) {
          assertSamePayload(raced.payloadHash, hash);
          return this.view(raced);
        }
      }
      throw e;
    }
  }

  /** POST /v1/receipt-links/:id/revoke (owner). Idempotent: keeps the first revokedAt. */
  async revoke(ctx: BusinessContext, id: string) {
    const link = await this.prisma.receiptLink.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!link) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    if (!link.revokedAt) {
      await this.prisma.receiptLink.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const row = await this.prisma.receiptLink.findUniqueOrThrow({ where: { id } });
    return { id: row.id, state: linkState(row), revokedAt: row.revokedAt!.toISOString() };
  }

  /** Owner detail (W6): state only, never the token or its hash. */
  async forReceipt(businessId: string, receiptId: string) {
    const rows = await this.prisma.receiptLink.findMany({
      where: { businessId, receiptId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const now = new Date();
    return rows.map((l) => ({
      id: l.id,
      state: linkState(l, now),
      createdAt: l.createdAt.toISOString(),
      expiresAt: l.expiresAt.toISOString(),
      usedAt: l.usedAt?.toISOString() ?? null,
      revokedAt: l.revokedAt?.toISOString() ?? null,
    }));
  }

  /** link-login lookup by sha256(token). Malformed or unknown → null (caller answers the generic 401). */
  async findByToken(token: string) {
    if (!TOKEN_RE.test(token)) return null;
    return this.prisma.receiptLink.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { receipt: { select: { id: true, customerId: true } } },
    });
  }

  /** Throws the W3 410 for a link that is no longer usable. */
  assertUsable(l: Pick<ReceiptLink, "usedAt" | "revokedAt" | "expiresAt">) {
    const st = linkState(l);
    if (st === "revoked") throw new AppError(ERROR_CODES.LINK_REVOKED, LINK_GONE.revoked);
    if (st === "used") throw new AppError(ERROR_CODES.LINK_USED, LINK_GONE.used);
    if (st === "expired") throw new AppError(ERROR_CODES.LINK_EXPIRED, LINK_GONE.expired);
  }

  /** Spend the link atomically (single use). False when another login won or it expired/was revoked meanwhile. */
  async claim(id: string): Promise<boolean> {
    const now = new Date();
    const r = await this.prisma.receiptLink.updateMany({
      where: { id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return r.count === 1;
  }
}
