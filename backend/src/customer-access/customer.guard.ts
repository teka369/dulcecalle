import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import type { CustomerAuth } from "../identity/auth.types";

const IDENTIFY_FAIL = "No pudimos identificarte.";

@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      headers: { authorization?: string };
      customerAuth?: CustomerAuth;
    }>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    let payload: { sub?: string; typ?: string; businessId?: string };
    try {
      payload = this.jwt.verify<{
        sub?: string;
        typ?: string;
        businessId?: string;
      }>(token);
    } catch {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }
    if (
      payload.typ !== "customer" ||
      !payload.sub ||
      !payload.businessId
    ) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, MESSAGES.unauthorized);
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: payload.sub, businessId: payload.businessId },
      select: { id: true, businessId: true, archivedAt: true },
    });
    if (!customer || customer.archivedAt) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, IDENTIFY_FAIL);
    }

    req.customerAuth = {
      customerId: customer.id,
      businessId: customer.businessId,
    };
    return true;
  }
}
