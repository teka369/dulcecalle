import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CatalogService } from "./catalog.service";
import {
  CreateCustomerDto,
  CreateInitialDebtDto,
  CreateProductDto,
  CreateSupplierDto,
  PatchCustomerDto,
  PatchProductDto,
  PatchSupplierDto,
  ShrinkDto,
  SurtirDto,
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

  @Get("products/:id/moves")
  listProductMoves(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
  ) {
    return this.catalog.listProductMoves(ctx, id);
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

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("products/:id/surtir")
  surtir(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: SurtirDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.catalog.surtir(
      ctx,
      id,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("products/:id/shrink")
  shrink(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: ShrinkDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.catalog.shrink(
      ctx,
      id,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Get("customers")
  listCustomers(@CurrentBusiness() ctx: BusinessContext) {
    return this.catalog.listCustomers(ctx);
  }

  @Get("customers/:id")
  getCustomer(@CurrentBusiness() ctx: BusinessContext, @Param("id") id: string) {
    return this.catalog.getCustomer(ctx, id);
  }

  @Get("customers/:id/ledger")
  customerLedger(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
  ) {
    return this.catalog.customerLedger(ctx, id);
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

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("customers/:id/initial-debts")
  recordInitialDebt(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: CreateInitialDebtDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.catalog.recordInitialDebt(
      ctx,
      id,
      dto,
      resolveIdempotencyKey(key, dto.requestId),
    );
  }

  @Get("suppliers")
  listSuppliers(@CurrentBusiness() ctx: BusinessContext) {
    return this.catalog.listSuppliers(ctx);
  }

  @Get("suppliers/:id")
  getSupplier(@CurrentBusiness() ctx: BusinessContext, @Param("id") id: string) {
    return this.catalog.getSupplier(ctx, id);
  }

  @Get("suppliers/:id/surtidas")
  supplierSurtidas(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
  ) {
    return this.catalog.listSupplierSurtidas(ctx, id);
  }

  @Post("suppliers")
  createSupplier(
    @CurrentBusiness() ctx: BusinessContext,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.catalog.createSupplier(ctx, dto);
  }

  @Patch("suppliers/:id")
  patchSupplier(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: PatchSupplierDto,
  ) {
    return this.catalog.patchSupplier(ctx, id, dto);
  }
}
