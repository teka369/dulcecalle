import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { DebtService } from "./debt.service";
import { ApplyCreditDto, RefundCreditDto } from "./debt.dto";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { resolveIdempotencyKey } from "../shared/idempotency";
import { UuidParam } from "../shared/http/params";
import { Roles } from "../shared/http/decorators";

/** C04 — saldo a favor, adjusted-payment review and balance check. */
@Controller()
export class DebtController {
  constructor(private readonly debt: DebtService) {}

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("customers/:id/credit/apply")
  applyCredit(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Body() dto: ApplyCreditDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.debt.applyCredit(ctx, id, dto, resolveIdempotencyKey(key, dto.requestId));
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles("owner")
  @Post("customers/:id/credit/refund")
  refundCredit(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Body() dto: RefundCreditDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.debt.refundCredit(ctx, id, dto, resolveIdempotencyKey(key, dto.requestId));
  }

  @Roles("owner")
  @Post("customers/:id/payments/:paymentId/review")
  review(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Param("paymentId", UuidParam) paymentId: string,
  ) {
    return this.debt.reviewAdjustedPayment(ctx, id, paymentId);
  }

  @Roles("owner")
  @Get("customers/:id/balance-check")
  balanceCheck(@CurrentBusiness() ctx: BusinessContext, @Param("id", UuidParam) id: string) {
    return this.debt.balanceCheck(ctx, id);
  }
}
