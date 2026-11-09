import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../shared/http/decorators";
import { UuidParam } from "../shared/http/params";
import type { CustomerAuth } from "../identity/auth.types";
import { ReceiptsService } from "../receipts/receipts.service";
import { CurrentCustomer } from "./customer.decorator";
import { CustomerJwtGuard } from "./customer.guard";
import { ReceiptAckDto } from "./portal-receipts.dto";

/**
 * C09-PR4 — receipts in the existing customer portal (same code + PIN login,
 * same customer token). Business and customer come only from the token
 * (I-C4); anything else is 404.
 */
@Public()
@UseGuards(CustomerJwtGuard)
@Controller("customer/me/receipts")
export class PortalReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  list(@CurrentCustomer() customer: CustomerAuth) {
    return this.receipts.portalList(customer);
  }

  @Get(":id")
  get(@CurrentCustomer() customer: CustomerAuth, @Param("id", UuidParam) id: string) {
    return this.receipts.portalGet(customer, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(":id/ack")
  async ack(
    @CurrentCustomer() customer: CustomerAuth,
    @Param("id", UuidParam) id: string,
    @Body() dto: ReceiptAckDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.receipts.portalAck(customer, id, dto);
    res.status(r.created ? 201 : 200);
    return r.body;
  }
}
