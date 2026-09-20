import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { CustomerAuth } from "../identity/auth.types";

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerAuth => {
    return ctx.switchToHttp().getRequest<{ customerAuth: CustomerAuth }>()
      .customerAuth;
  },
);
