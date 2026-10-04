import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { requireJwtSecrets } from "./jwt-secrets";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionKind = "owner" | "customer";

type RefreshClaims = Record<string, string>;

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async issue(input: {
    kind: SessionKind;
    subjectId: string;
    businessId: string | null;
    refreshClaims: RefreshClaims;
    accessClaims: RefreshClaims;
    accessExpiresIn?: "15m";
  }): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
    const sessionId = randomUUID();
    const { refresh } = requireJwtSecrets();
    const refreshToken = this.jwt.sign(
      { ...input.refreshClaims, sid: sessionId },
      { secret: refresh, expiresIn: "7d" },
    );
    const accessToken = input.accessExpiresIn
      ? this.jwt.sign(input.accessClaims, { expiresIn: input.accessExpiresIn })
      : this.jwt.sign(input.accessClaims);
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        kind: input.kind,
        subjectId: input.subjectId,
        businessId: input.businessId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
      },
    });
    return { accessToken, refreshToken, sessionId };
  }

  async verify(token: string, expectedTyp: "refresh" | "customer_refresh") {
    const payload = this.read(token, expectedTyp);
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
    });
    if (
      !session ||
      session.kind !== (expectedTyp === "refresh" ? "owner" : "customer") ||
      session.subjectId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      !sameHash(session.tokenHash, sha256(token))
    ) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    if (
      expectedTyp === "customer_refresh" &&
      session.businessId !== payload.businessId
    ) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    return { session, payload };
  }

  async touch(sessionId: string) {
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Revoke only the presented session. A token for someone else is rejected
   * and left active. Garbage and already-revoked tokens are a no-op.
   */
  async revokeOwned(
    token: string,
    owner: { kind: SessionKind; subjectId: string },
    expectedTyp: "refresh" | "customer_refresh",
  ): Promise<"revoked" | "absent" | "foreign"> {
    let payload: { sub: string; sid: string };
    try {
      payload = this.read(token, expectedTyp);
    } catch {
      return "absent";
    }
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
    });
    if (!session || !sameHash(session.tokenHash, sha256(token))) return "absent";
    if (session.subjectId !== owner.subjectId || session.kind !== owner.kind) {
      return "foreign";
    }
    if (!session.revokedAt) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }
    return "revoked";
  }

  private read(token: string, expectedTyp: "refresh" | "customer_refresh") {
    const raw = token.trim();
    if (!raw) throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    const { refresh } = requireJwtSecrets();
    try {
      const payload = this.jwt.verify<{
        sub?: string;
        sid?: string;
        email?: string;
        businessId?: string;
        typ?: string;
      }>(raw, { secret: refresh });
      if (
        payload.typ !== expectedTyp ||
        !payload.sub ||
        !payload.sid
      ) {
        throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
      }
      return {
        sub: payload.sub,
        sid: payload.sid,
        email: payload.email,
        businessId: payload.businessId,
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
