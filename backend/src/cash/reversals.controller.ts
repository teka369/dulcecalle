import { Body, Controller, Get, Headers, Param, Post, Query, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { UuidParam, optionalDateQuery } from "../shared/http/params";
import { Roles } from "../shared/http/decorators";
import { AppError, ERROR_CODES } from "../shared/errors";
import { ReversalsService } from "./reversals.service";
import { CorrectPaymentDto, ReverseDto } from "./reversals.dto";

function dryRunFlag(raw: string | undefined): boolean {
  if (raw == null || raw === "" || raw === "false") return false;
  if (raw === "true") return true;
  throw new AppError(ERROR_CODES.VALIDATION, "dryRun inválido.");
}

/**
 * C07 — anulaciones (SPEC-C07 §8). Every route is owner only (G1: staff 403).
 * There is no route that targets a reversal (G8 / T23).
 */
@Roles("owner")
@Controller()
export class ReversalsController {
  constructor(private readonly reversals: ReversalsService) {}

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("sales/:id/void")
  async voidSale(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Body() dto: ReverseDto,
    @Res({ passthrough: true }) res: Response,
    @Query("dryRun") dryRun?: string,
    @Headers("idempotency-key") key?: string,
  ) {
    const dry = dryRunFlag(dryRun);
    if (dry) res.status(200);
    return this.reversals.voidSale(ctx, id, dto, key, dry);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("customers/:id/payments/:paymentId/reverse")
  async reversePayment(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Param("paymentId", UuidParam) paymentId: string,
    @Body() dto: ReverseDto,
    @Res({ passthrough: true }) res: Response,
    @Query("dryRun") dryRun?: string,
    @Headers("idempotency-key") key?: string,
  ) {
    const dry = dryRunFlag(dryRun);
    if (dry) res.status(200);
    return this.reversals.reversePayment(ctx, id, paymentId, dto, key, dry);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("customers/:id/payments/:paymentId/correct")
  async correctPayment(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Param("paymentId", UuidParam) paymentId: string,
    @Body() dto: CorrectPaymentDto,
    @Res({ passthrough: true }) res: Response,
    @Query("dryRun") dryRun?: string,
    @Headers("idempotency-key") key?: string,
  ) {
    const dry = dryRunFlag(dryRun);
    if (dry) res.status(200);
    return this.reversals.correctPayment(ctx, id, paymentId, dto, key, dry);
  }

  @Get("reversals")
  list(
    @CurrentBusiness() ctx: BusinessContext,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.reversals.list(ctx, optionalDateQuery(from, "from"), optionalDateQuery(to, "to"), { limit, cursor });
  }

  @Get("reversals/:id")
  get(@CurrentBusiness() ctx: BusinessContext, @Param("id", UuidParam) id: string) {
    return this.reversals.get(ctx, id);
  }
}
