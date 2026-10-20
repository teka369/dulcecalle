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
import { CashManagerService } from "./cash-manager.service";
import {
  CashOwnerMoveDto,
  AssignMoveDto,
  CarrySessionDto,
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
  constructor(
    private readonly cash: CashService,
    private readonly manager: CashManagerService,
  ) {}

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("cash/sessions")
  open(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: OpenSessionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.cash.open(ctx, dto.openingFloat, resolveIdempotencyKey(key, dto.requestId));
  }

  @Post("cash/sessions/:id/close")
  close(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: CloseSessionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.cash.close(ctx, id, dto.countedEfectivo, resolveIdempotencyKey(key, dto.requestId));
  }

  @Get("cash/today")
  today(@CurrentBusiness() ctx: BusinessContext) {
    return this.cash.today(ctx);
  }

  @Get("cash/sessions")
  list(@CurrentBusiness() ctx: BusinessContext, @Query("status") status?: string) {
    return this.manager.list(ctx, status);
  }

  @Get("cash/sessions/:id")
  detail(@CurrentBusiness() ctx: BusinessContext, @Param("id") id: string) {
    return this.manager.detail(ctx, id);
  }

  @Get("cash/unassigned-moves")
  unassigned(@CurrentBusiness() ctx: BusinessContext) {
    return this.manager.unassigned(ctx);
  }

  @Post("cash/moves/:id/assign")
  assign(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: AssignMoveDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.manager.assign(ctx, id, dto.sessionId, resolveIdempotencyKey(key, dto.requestId));
  }

  @Post("cash/sessions/:id/carry")
  carry(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: CarrySessionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.manager.carry(
      ctx,
      id,
      dto.mode,
      dto.countedEfectivo,
      resolveIdempotencyKey(key, dto.requestId),
    );
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
