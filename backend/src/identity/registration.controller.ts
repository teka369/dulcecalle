import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { RegistrationStatus } from "@prisma/client";
import { Public, SkipBusiness } from "../shared/http/decorators";
import { AppError, ERROR_CODES } from "../shared/errors";
import { CurrentUser } from "../tenancy/business.decorator";
import type { AuthedUser } from "./auth.types";
import { PlatformAdminGuard } from "./platform-admin.guard";
import {
  RejectRegistrationDto,
  ResendRegistrationDto,
  SubmitRegistrationDto,
  VerifyRegistrationDto,
} from "./registration.dto";
import { RegistrationService } from "./registration.service";

const STATUSES = new Set<RegistrationStatus>([
  "PENDING_EMAIL_VERIFICATION",
  "PENDING_ADMIN_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);

@Controller()
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 900000 } })
  @HttpCode(201)
  @Post("auth/register")
  submit(@Body() dto: SubmitRegistrationDto) {
    return this.registration.submit(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(200)
  @Post("auth/register/verify")
  verify(@Body() dto: VerifyRegistrationDto) {
    return this.registration.verify(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  @HttpCode(200)
  @Post("auth/register/resend")
  resend(@Body() dto: ResendRegistrationDto) {
    return this.registration.resend(dto.email);
  }

  @SkipBusiness()
  @UseGuards(PlatformAdminGuard)
  @Get("admin/registrations")
  list(@Query("status") status?: string) {
    return this.registration.list(parseStatus(status));
  }

  @SkipBusiness()
  @UseGuards(PlatformAdminGuard)
  @Get("admin/registrations/:id")
  get(@Param("id") id: string) {
    return this.registration.get(id);
  }

  @SkipBusiness()
  @UseGuards(PlatformAdminGuard)
  @HttpCode(200)
  @Post("admin/registrations/:id/approve")
  approve(@CurrentUser() user: AuthedUser, @Param("id") id: string) {
    return this.registration.approve(id, user.id);
  }

  @SkipBusiness()
  @UseGuards(PlatformAdminGuard)
  @HttpCode(200)
  @Post("admin/registrations/:id/reject")
  reject(
    @CurrentUser() user: AuthedUser,
    @Param("id") id: string,
    @Body() dto: RejectRegistrationDto,
  ) {
    return this.registration.reject(id, user.id, dto.note);
  }
}

function parseStatus(status?: string): RegistrationStatus | undefined {
  if (!status) return undefined;
  if (!STATUSES.has(status as RegistrationStatus)) {
    throw new AppError(ERROR_CODES.VALIDATION, "Estado desconocido.");
  }
  return status as RegistrationStatus;
}
