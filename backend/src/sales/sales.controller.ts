import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SalesService } from "./sales.service";
import { CreateSaleDto } from "./sales.dto";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { resolveIdempotencyKey } from "../shared/idempotency";

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(
    @CurrentBusiness() ctx: BusinessContext,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.sales.list(ctx, from, to);
  }

  @Get(":id")
  get(@CurrentBusiness() ctx: BusinessContext, @Param("id") id: string) {
    return this.sales.get(ctx, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post()
  create(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: CreateSaleDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.sales.create(
      ctx,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }
}
