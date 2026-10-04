import { Body, Controller, Get, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IdentityService } from "./identity.service";
import { CreateBusinessDto, LoginDto, LogoutDto, RefreshDto } from "./dto";
import { Public, SkipBusiness } from "../shared/http/decorators";
import { CurrentUser } from "../tenancy/business.decorator";
import type { AuthedUser } from "./auth.types";

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("auth/login")
  login(@Body() dto: LoginDto) {
    return this.identity.login(dto.email, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("auth/refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.identity.refresh(dto.refreshToken);
  }

  @SkipBusiness()
  @Post("auth/logout")
  logout(@CurrentUser() user: AuthedUser, @Body() dto: LogoutDto) {
    return this.identity.logout(user.id, dto.refreshToken);
  }

  @SkipBusiness()
  @Get("me")
  me(@CurrentUser() user: AuthedUser) {
    return this.identity.me(user.id);
  }

  @SkipBusiness()
  @Get("businesses")
  list(@CurrentUser() user: AuthedUser) {
    return this.identity.listBusinesses(user.id);
  }

  @SkipBusiness()
  @Post("businesses")
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateBusinessDto) {
    return this.identity.createBusiness(user.id, dto.name);
  }
}
