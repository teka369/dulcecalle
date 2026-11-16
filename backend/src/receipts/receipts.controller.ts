import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { UuidParam, optionalDateQuery, optionalUuidQuery } from "../shared/http/params";
import { Roles } from "../shared/http/decorators";
import { AppError, ERROR_CODES } from "../shared/errors";
import { ReceiptsService } from "./receipts.service";

/**
 * C09-PR2 — comprobantes (SPEC-C09 §7). Owner and staff read; no route
 * writes a receipt (they are emitted inside sale/payment/return
 * transactions and are insert-only).
 */
@Roles("owner", "staff")
@Controller("receipts")
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  list(
    @CurrentBusiness() ctx: BusinessContext,
    @Query("customerId") customerId?: string,
    @Query("kind") kind?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    let take: number | undefined;
    if (limit !== undefined && limit !== "") {
      take = Number(limit);
      if (!Number.isInteger(take) || take < 1 || take > 500) {
        throw new AppError(ERROR_CODES.VALIDATION, "Parámetro limit inválido.");
      }
    }
    return this.receipts.list(ctx, {
      customerId: optionalUuidQuery(customerId, "customerId"),
      kind: kind === "" ? undefined : kind,
      from: optionalDateQuery(from, "from"),
      to: optionalDateQuery(to, "to"),
      limit: take,
    });
  }

  @Get(":id")
  get(@CurrentBusiness() ctx: BusinessContext, @Param("id", UuidParam) id: string) {
    return this.receipts.get(ctx, id);
  }
}
