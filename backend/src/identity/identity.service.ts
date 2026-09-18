import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { DEFAULT_TZ } from "../shared/clock";
import type { RegisterDto } from "./dto";

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private tokens(userId: string, email: string) {
    const accessToken = this.jwt.sign({ sub: userId, email });
    const refreshToken = this.jwt.sign(
      { sub: userId, email, typ: "refresh" },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: "7d" },
    );
    return { accessToken, refreshToken };
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

    return {
      user: { id: userId, email },
      business: { id: businessId, name, timezone: DEFAULT_TZ },
      ...this.tokens(userId, email),
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
    return {
      user: { id: user.id, email: user.email },
      ...this.tokens(user.id, user.email),
    };
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
