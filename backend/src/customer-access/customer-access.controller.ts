import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CustomerAccessService } from "./customer-access.service";
import { CustomerLoginDto, CustomerRefreshDto } from "./customer-access.dto";
import { CustomerJwtGuard } from "./customer.guard";
import { CurrentCustomer } from "./customer.decorator";
import { Public } from "../shared/http/decorators";
import type { CustomerAuth } from "../identity/auth.types";

@Controller()
export class CustomerAccessController {
  constructor(private readonly access: CustomerAccessService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("customer-access/login")
  login(@Body() dto: CustomerLoginDto) {
    return this.access.login(dto.code, dto.name);
  }

  @Public()
  @Post("customer-access/refresh")
  refresh(@Body() dto: CustomerRefreshDto) {
    return this.access.refresh(dto.refreshToken);
  }

  @Public()
  @UseGuards(CustomerJwtGuard)
  @Post("customer-access/logout")
  logout() {
    return { ok: true as const };
  }

  @Public()
  @UseGuards(CustomerJwtGuard)
  @Get("customer/me")
  me(@CurrentCustomer() customer: CustomerAuth) {
    return this.access.me(customer);
  }

  @Public()
  @UseGuards(CustomerJwtGuard)
  @Get("customer/me/ledger")
  ledger(@CurrentCustomer() customer: CustomerAuth) {
    return this.access.ledger(customer);
  }
}
