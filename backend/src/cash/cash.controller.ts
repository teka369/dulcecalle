import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CashService } from "./cash.service";
import {
  CashOwnerMoveDto,
  CloseSessionDto,
  CreateExpenseDto,
  OpenSessionDto,
} from "./cash.dto";
import { CreatePaymentDto } from "../sales/sales.dto";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { resolveIdempotencyKey } from "../shared/idempotency";

@Controller()
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("cash/sessions")
  open(@CurrentBusiness() ctx: BusinessContext, @Body() dto: OpenSessionDto) {
    return this.cash.open(ctx, dto.openingFloat);
  }

  @Post("cash/sessions/:id/close")
  close(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.cash.close(ctx, id, dto.countedEfectivo);
  }

  @Get("cash/today")
  today(@CurrentBusiness() ctx: BusinessContext) {
    return this.cash.today(ctx);
  }

  @Get("cash/moves")
  moves(
    @CurrentBusiness() ctx: BusinessContext,
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.cash.listMoves(ctx, date, from, to);
  }

  @Get("expenses")
  expenses(
    @CurrentBusiness() ctx: BusinessContext,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.cash.listExpenses(ctx, from, to);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("cash/aportes")
  aporte(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: CashOwnerMoveDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.cash.ownerAporte(
      ctx,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("cash/retiros")
  retiro(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: CashOwnerMoveDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.cash.ownerRetiro(
      ctx,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("expenses")
  expense(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: CreateExpenseDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.cash.recordExpense(
      ctx,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("customers/:id/payments")
  pay(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: CreatePaymentDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.cash.recordPayment(
      ctx,
      id,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }
}
