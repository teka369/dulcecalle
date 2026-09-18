import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { BusinessContext } from "../identity/auth.types";

export const CurrentBusiness = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BusinessContext => {
    return ctx.switchToHttp().getRequest<{ business: BusinessContext }>()
      .business;
  },
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user;
  },
);
