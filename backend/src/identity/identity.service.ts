import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { DEFAULT_TZ } from "../shared/clock";
import { AuthSessionService } from "./auth-sessions";
import type { RegisterDto } from "./dto";

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: AuthSessionService,
  ) {}

  private tokens(userId: string, email: string) {
    return this.sessions.issue({
      kind: "owner",
      subjectId: userId,
      businessId: null,
      refreshClaims: { sub: userId, email, typ: "refresh" },
      accessClaims: { sub: userId, email },
    });
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) {
      throw new AppError(ERROR_CODES.VALIDATION, "Ese correo ya está registrado.");
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const userId = randomUUID();
    const businessId = randomUUID();
    const membershipId = randomUUID();
    const name = (dto.businessName ?? "DulceCalle").trim() || "DulceCalle";

    await this.prisma.$transaction([
      this.prisma.user.create({
        data: { id: userId, email, passwordHash },
      }),
      this.prisma.business.create({
        data: { id: businessId, name, timezone: DEFAULT_TZ },
      }),
      this.prisma.businessMembership.create({
        data: {
          id: membershipId,
          businessId,
          userId,
          role: "owner",
        },
      }),
    ]);

    const issued = await this.tokens(userId, email);
    return {
      user: { id: userId, email },
      business: { id: businessId, name, timezone: DEFAULT_TZ },
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
    };
  }

  async login(emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Correo o clave incorrectos.");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Correo o clave incorrectos.");
    }
    const issued = await this.tokens(user.id, user.email);
    return {
      user: { id: user.id, email: user.email },
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    const { session, payload } = await this.sessions.verify(
      refreshToken,
      "refresh",
    );
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.id !== session.subjectId) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    await this.sessions.touch(session.id);
    return {
      user: { id: user.id, email: user.email },
      accessToken,
      refreshToken: refreshToken.trim(),
    };
  }

  /**
   * Revokes the presented refresh session only. The access JWT stays valid
   * until its own 15-minute expiry — there is no access-token blacklist.
   * After that expiry the revoked refresh cannot mint a new one.
   */
  async logout(userId: string, refreshToken?: string) {
    if (!refreshToken?.trim()) return { ok: true as const };
    const result = await this.sessions.revokeOwned(
      refreshToken,
      { kind: "owner", subjectId: userId },
      "refresh",
    );
    if (result === "foreign") {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    return { ok: true as const };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { business: true } },
      },
    });
    if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    return {
      id: user.id,
      email: user.email,
      memberships: user.memberships.map((m) => ({
        businessId: m.businessId,
        role: m.role,
        business: {
          id: m.business.id,
          name: m.business.name,
          timezone: m.business.timezone,
        },
      })),
    };
  }

  async listBusinesses(userId: string) {
    const rows = await this.prisma.businessMembership.findMany({
      where: { userId },
      include: { business: true },
    });
    return rows.map((m) => ({
      id: m.business.id,
      name: m.business.name,
      timezone: m.business.timezone,
      role: m.role,
    }));
  }

  async createBusiness(userId: string, name: string) {
    const businessId = randomUUID();
    const trimmed = name.trim();
    if (!trimmed) throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.emptyName);
    await this.prisma.$transaction([
      this.prisma.business.create({
        data: { id: businessId, name: trimmed, timezone: DEFAULT_TZ },
      }),
      this.prisma.businessMembership.create({
        data: {
          id: randomUUID(),
          businessId,
          userId,
          role: "owner",
        },
      }),
    ]);
    return { id: businessId, name: trimmed, timezone: DEFAULT_TZ, role: "owner" as const };
  }
}
