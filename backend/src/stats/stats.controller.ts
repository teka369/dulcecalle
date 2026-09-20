import { Controller, Get, Query } from "@nestjs/common";
import { StatsService } from "./stats.service";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { AppError, ERROR_CODES } from "../shared/errors";

@Controller("stats")
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get(
    @CurrentBusiness() ctx: BusinessContext,
    @Query("period") period?: string,
  ) {
    const p = period ?? "hoy";
    if (p !== "hoy" && p !== "semana" && p !== "mes") {
      throw new AppError(ERROR_CODES.VALIDATION, "Período inválido.");
    }
    return this.stats.forPeriod(ctx, p);
  }
}
