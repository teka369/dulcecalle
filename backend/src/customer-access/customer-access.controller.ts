import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CustomerAccessService } from "./customer-access.service";
import { CustomerLinkLoginDto, CustomerLoginDto, CustomerLogoutDto, CustomerRefreshDto } from "./customer-access.dto";
import { CustomerJwtGuard } from "./customer.guard";
import { CurrentCustomer } from "./customer.decorator";
import { Public } from "../shared/http/decorators";
import { ClientIp } from "../shared/http/client-ip";
import type { CustomerAuth } from "../identity/auth.types";

@Controller()
export class CustomerAccessController {
  constructor(private readonly access: CustomerAccessService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("customer-access/login")
  login(@Body() dto: CustomerLoginDto, @ClientIp() ip: string) {
    // C09-PR5.1 — the real client IP (CF-Connecting-IP via Render), see shared/http/client-ip.
    return this.access.login(dto.code, dto.pin, dto.businessId, ip, dto.store);
  }

  /** C09-PR5 — same HTTP throttle as login; the PIN check reuses login's counters. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("customer-access/link-login")
  linkLogin(@Body() dto: CustomerLinkLoginDto, @ClientIp() ip: string) {
    return this.access.linkLogin(dto.token, dto.pin, ip);
  }

  @Public()
  @Post("customer-access/refresh")
  refresh(@Body() dto: CustomerRefreshDto) {
    return this.access.refresh(dto.refreshToken);
  }

  @Public()
  @UseGuards(CustomerJwtGuard)
  @Post("customer-access/logout")
  logout(@CurrentCustomer() customer: CustomerAuth, @Body() dto: CustomerLogoutDto) {
    return this.access.logout(customer, dto.refreshToken);
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

  @Public()
  @UseGuards(CustomerJwtGuard)
  @Get("customer/products")
  products(@CurrentCustomer() customer: CustomerAuth) {
    return this.access.products(customer);
  }
}
