import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import { ROLES_KEY } from "../shared/http/decorators";
import type { BusinessContext } from "../identity/auth.types";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Array<"owner" | "staff">>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!roles || roles.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<{ business?: BusinessContext }>();
    if (!req.business || !roles.includes(req.business.role)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, MESSAGES.forbidden);
    }
    return true;
  }
}
