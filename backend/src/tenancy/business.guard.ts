import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { IS_PUBLIC, SKIP_BUSINESS } from "../shared/http/decorators";
import type { AuthedUser, BusinessContext } from "../identity/auth.types";

@Injectable()
export class BusinessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_BUSINESS, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthedUser;
      business?: BusinessContext;
    }>();
    if (!req.user) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    const raw =
      req.headers["x-business-id"] ?? req.headers["X-Business-Id"];
    const businessId = Array.isArray(raw) ? raw[0] : raw;
    if (!businessId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, MESSAGES.forbidden);
    }

    const membership = await this.prisma.businessMembership.findUnique({
      where: {
        businessId_userId: { businessId, userId: req.user.id },
      },
      include: { business: true },
    });
    if (!membership) {
      throw new AppError(ERROR_CODES.FORBIDDEN, MESSAGES.forbidden);
    }

    req.business = {
      userId: req.user.id,
      businessId,
      role: membership.role,
      timezone: membership.business.timezone,
    };
    return true;
  }
}
