import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import {
  CreateCustomerDto,
  CreateProductDto,
  PatchCustomerDto,
  PatchProductDto,
} from "./catalog.dto";
import { CurrentBusiness } from "../tenancy/business.decorator";
import { Roles } from "../shared/http/decorators";
import type { BusinessContext } from "../identity/auth.types";
import { resolveIdempotencyKey } from "../shared/idempotency";

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("products")
  listProducts(@CurrentBusiness() ctx: BusinessContext) {
    return this.catalog.listProducts(ctx);
  }

  @Get("products/:id")
  getProduct(@CurrentBusiness() ctx: BusinessContext, @Param("id") id: string) {
    return this.catalog.getProduct(ctx, id);
  }

  @Post("products")
  createProduct(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: CreateProductDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.catalog.createProduct(
      ctx,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Patch("products/:id")
  patchProduct(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: PatchProductDto,
  ) {
    return this.catalog.patchProduct(ctx, id, dto);
  }

  @Roles("owner")
  @Post("products/:id/archive")
  archiveProduct(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
  ) {
    return this.catalog.archiveProduct(ctx, id);
  }

  @Get("customers")
  listCustomers(@CurrentBusiness() ctx: BusinessContext) {
    return this.catalog.listCustomers(ctx);
  }

  @Get("customers/:id")
  getCustomer(@CurrentBusiness() ctx: BusinessContext, @Param("id") id: string) {
    return this.catalog.getCustomer(ctx, id);
  }

  @Post("customers")
  createCustomer(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.catalog.createCustomer(ctx, dto);
  }

  @Patch("customers/:id")
  patchCustomer(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: PatchCustomerDto,
  ) {
    return this.catalog.patchCustomer(ctx, id, dto);
  }
}
