import { Body, Controller, Get, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { Roles } from "../shared/http/decorators";
import { AuditService } from "./audit.service";
import { ClientOpEventDto } from "./audit.dto";

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Any member of the business may report (staff devices sync too). */
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post("audit/client-events")
  record(@CurrentBusiness() ctx: BusinessContext, @Body() dto: ClientOpEventDto) {
    return this.audit.record(ctx, dto);
  }

  /** Only the owner reads the trace (Pendientes → Historial). */
  @Roles("owner")
  @Get("audit/client-events")
  list(@CurrentBusiness() ctx: BusinessContext) {
    return this.audit.list(ctx);
  }
}
