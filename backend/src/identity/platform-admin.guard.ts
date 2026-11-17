import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import type { AuthedUser } from "./auth.types";
import { isPlatformAdminEmail } from "./platform-admin";

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthedUser }>();
    const current = req.user;
    if (!current) throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    if (!isPlatformAdminEmail(current.email)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, MESSAGES.forbidden);
    }
    const row = await this.prisma.user.findUnique({ where: { id: current.id } });
    if (!row || row.email.toLowerCase() !== current.email.toLowerCase()) {
      throw new AppError(ERROR_CODES.FORBIDDEN, MESSAGES.forbidden);
    }
    return true;
  }
}
