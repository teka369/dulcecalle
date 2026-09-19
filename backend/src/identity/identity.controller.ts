import { Body, Controller, Get, Post } from "@nestjs/common";
import { IdentityService } from "./identity.service";
import { CreateBusinessDto, LoginDto, RefreshDto, RegisterDto } from "./dto";
import { Public, SkipBusiness } from "../shared/http/decorators";
import { CurrentUser } from "../tenancy/business.decorator";
import type { AuthedUser } from "./auth.types";

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post("auth/register")
  register(@Body() dto: RegisterDto) {
    return this.identity.register(dto);
  }

  @Public()
  @Post("auth/login")
  login(@Body() dto: LoginDto) {
    return this.identity.login(dto.email, dto.password);
  }

  @Public()
  @Post("auth/refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.identity.refresh(dto.refreshToken);
  }

  @SkipBusiness()
  @Post("auth/logout")
  logout() {
    return { ok: true };
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
