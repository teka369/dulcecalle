import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SalesService } from "./sales.service";
import { CreateReturnDto, CreateSaleDto } from "./sales.dto";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { resolveIdempotencyKey } from "../shared/idempotency";
import { UuidParam, optionalDateQuery } from "../shared/http/params";

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(
    @CurrentBusiness() ctx: BusinessContext,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.sales.list(ctx, optionalDateQuery(from, "from"), optionalDateQuery(to, "to"), { limit, cursor });
  }

  @Get(":id/returns")
  listReturns(@CurrentBusiness() ctx: BusinessContext, @Param("id", UuidParam) id: string) {
    return this.sales.listReturns(ctx, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post(":id/returns")
  createReturn(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Body() dto: CreateReturnDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.sales.createReturn(
      ctx,
      id,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Get(":id")
  get(@CurrentBusiness() ctx: BusinessContext, @Param("id", UuidParam) id: string) {
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